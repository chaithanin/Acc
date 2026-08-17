import {
  EXPENSE_CATEGORY_RULES,
  INCOME_CATEGORY_RULES,
  TOTAL_ROW_LABELS,
  type CanonicalField,
  type ExpenseCategory,
  type IncomeCategory,
} from '@/config/field-synonyms';
import { columnOf } from '@/lib/detect/header-detector';
import { containsPhrase, normalizeKey, normalizeText } from '@/lib/detect/normalize-text';
import type { ProjectResolver } from '@/lib/detect/project-resolver';
import {
  cellText,
  getCell,
  hasExternalReference,
  isErrorCell,
  makeSourceRef,
  parseDateCell,
  parseNumeric,
} from '@/lib/excel/cells';
import type { RawCell, RawSheet, SourceRef } from '@/lib/excel/types';
import type { ImportIssue, SheetDetection } from '@/lib/types';

/**
 * Everything a normalizer needs, plus the issue sink.
 *
 * Normalizers never throw on bad data — they record an issue and skip the
 * value. A single unreadable cell must not fail an import (requirement 28).
 */
export interface NormalizeContext {
  fileName: string;
  sheet: RawSheet;
  detection: SheetDetection;
  resolver: ProjectResolver;
  /** Project inferred for the whole file; a row may override it. */
  defaultProjectId: string | null;
  defaultProjectLabel: string | null;
  reportDate: string;
  addIssue(issue: ImportIssue): void;
}

const TOTAL_KEYS = TOTAL_ROW_LABELS.map(normalizeKey);

/**
 * Reads one spreadsheet row through the column map.
 *
 * All access is by canonical field, never by column index, so the same reader
 * works for every file layout the header detector can map.
 */
export class RowReader {
  private readonly ctx: NormalizeContext;
  readonly rowIndex: number;

  constructor(ctx: NormalizeContext, rowIndex: number) {
    this.ctx = ctx;
    this.rowIndex = rowIndex;
  }

  private cellFor(field: CanonicalField): { cell: RawCell | null; col: number | null } {
    const col = columnOf(this.ctx.detection.columns, field);
    if (col === null) return { cell: null, col: null };
    return { cell: getCell(this.ctx.sheet, this.rowIndex, col), col };
  }

  has(field: CanonicalField): boolean {
    return columnOf(this.ctx.detection.columns, field) !== null;
  }

  /**
   * Numeric value for a field. Returns null (never NaN) and reports a warning
   * when the cell holds text, an Excel error, or an external reference.
   */
  num(field: CanonicalField): number | null {
    const { cell, col } = this.cellFor(field);
    if (col === null || !cell) return null;

    if (isErrorCell(cell)) {
      this.warn('FORMULA_ERROR', `Excel error value "${cellText(cell)}" in ${field}`, col);
      return null;
    }
    if (hasExternalReference(cell)) {
      this.warn(
        'EXTERNAL_REFERENCE',
        `Value depends on another workbook (${cell.f}); the cached result was used and cannot be recalculated`,
        col,
      );
    }

    const parsed = parseNumeric(cell);
    if (parsed.issue === 'text-in-numeric') {
      this.warn('TEXT_IN_NUMERIC', `Expected a number for ${field} but found "${parsed.raw}"`, col);
      return null;
    }
    return parsed.value;
  }

  /** Numeric value defaulting to 0 — for amounts where blank means nothing. */
  amount(field: CanonicalField): number {
    return this.num(field) ?? 0;
  }

  text(field: CanonicalField): string | null {
    const { cell } = this.cellFor(field);
    const text = cellText(cell);
    return text === '' ? null : text;
  }

  date(field: CanonicalField): string | null {
    const { cell } = this.cellFor(field);
    return parseDateCell(cell);
  }

  /** Source pointer at a specific field's cell, falling back to the row. */
  ref(field?: CanonicalField): SourceRef {
    if (field) {
      const col = columnOf(this.ctx.detection.columns, field);
      if (col !== null) {
        return makeSourceRef(this.ctx.fileName, this.ctx.sheet, this.rowIndex, col);
      }
    }
    return makeSourceRef(this.ctx.fileName, this.ctx.sheet, this.rowIndex, null);
  }

  /** True when every mapped cell in this row is blank. */
  isEmpty(): boolean {
    const row = this.ctx.sheet.rows[this.rowIndex];
    if (!row || row.length === 0) return true;
    return !row.some((cell) => cellText(cell) !== '');
  }

  /**
   * True for subtotal/grand-total lines. These are excluded from SUMs so the
   * engine never double-counts, but they are still used for reconciliation.
   */
  isTotalRow(): boolean {
    for (const text of this.labelTexts()) {
      const key = normalizeKey(text);
      if (!key) continue;
      if (TOTAL_KEYS.some((t) => key === t || key.startsWith(t) || key.endsWith(t))) return true;
    }
    return false;
  }

  /** All text-ish cells in the row — used for category and project sniffing. */
  labelTexts(): string[] {
    const row = this.ctx.sheet.rows[this.rowIndex];
    if (!row || row.length === 0) return [];
    const out: string[] = [];
    for (const cell of row) {
      if (!cell) continue;
      if (typeof cell.v === 'number') continue;
      const text = cellText(cell);
      if (text) out.push(text);
    }
    return out;
  }

  /** Resolves this row's project, falling back to the file-level match. */
  project(): { id: string | null; label: string | null } {
    const explicit = this.text('project');
    if (explicit) {
      const hit = this.ctx.resolver.find(explicit, 'column');
      if (hit?.projectId) return { id: hit.projectId, label: explicit };
      // Keep the unrecognised label so the user can map it later.
      return { id: this.ctx.defaultProjectId, label: explicit };
    }
    return { id: this.ctx.defaultProjectId, label: this.ctx.defaultProjectLabel };
  }

  warn(code: string, message: string, col?: number | null) {
    this.ctx.addIssue({
      severity: 'warning',
      code,
      message,
      source: makeSourceRef(this.ctx.fileName, this.ctx.sheet, this.rowIndex, col ?? null),
    });
  }
}

/** Iterates the data rows below the detected header. */
export function* dataRows(ctx: NormalizeContext): Generator<RowReader> {
  const start = (ctx.detection.headerRow ?? -1) + 1;
  for (let r = start; r < ctx.sheet.rowCount; r += 1) {
    const reader = new RowReader(ctx, r);
    if (reader.isEmpty()) continue;
    yield reader;
  }
}

/** Matches a row's text against the income category rules. */
export function detectIncomeCategory(texts: string[]): IncomeCategory | null {
  return bestCategory(texts, INCOME_CATEGORY_RULES);
}

export function detectExpenseCategory(texts: string[]): ExpenseCategory | null {
  return bestCategory(texts, EXPENSE_CATEGORY_RULES);
}

function bestCategory<T extends string>(
  texts: string[],
  rules: { category: T; labels: string[]; priority: number }[],
): T | null {
  let winner: { category: T; priority: number; specificity: number } | null = null;

  for (const text of texts) {
    for (const rule of rules) {
      for (const label of rule.labels) {
        if (!containsPhrase(text, label)) continue;
        const specificity = label.length;
        if (
          !winner ||
          rule.priority > winner.priority ||
          (rule.priority === winner.priority && specificity > winner.specificity)
        ) {
          winner = { category: rule.category, priority: rule.priority, specificity };
        }
      }
    }
  }
  return winner?.category ?? null;
}

/** Header text for a column, used when a category comes from the column itself. */
export function headerTextAt(sheet: RawSheet, headerRow: number | null, col: number): string {
  if (headerRow === null) return '';
  return cellText(getCell(sheet, headerRow, col));
}

/**
 * Builds a stable fingerprint for duplicate-row detection within a sheet.
 * Numbers are rounded so trivial float noise does not hide a true duplicate.
 */
export function rowFingerprint(parts: (string | number | null | undefined)[]): string {
  return parts
    .map((p) => {
      if (p === null || p === undefined) return '';
      if (typeof p === 'number') return p.toFixed(2);
      return normalizeText(p);
    })
    .join('|');
}
