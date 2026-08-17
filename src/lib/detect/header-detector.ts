import { FIELD_SYNONYMS, type CanonicalField } from '@/config/field-synonyms';
import { cellText, getCell } from '@/lib/excel/cells';
import type { RawSheet } from '@/lib/excel/types';
import type { ColumnMapping } from '@/lib/types';
import { normalizeKey, normalizeText } from './normalize-text';

/**
 * Level 2 of the mapping strategy: find the header row, then map each column
 * to a canonical field by matching its label against the synonym dictionary.
 *
 * Cell positions are never assumed — the header row is located by scoring, so
 * a report with two title rows above the table works the same as one without.
 */

/** Header rows sit near the top; scanning further just invites false positives. */
const MAX_HEADER_SCAN_ROWS = 30;

interface FieldCandidate {
  field: CanonicalField;
  score: number;
}

/**
 * Scores one header label against every canonical field.
 * Exact matches dominate; containment is accepted at a discount.
 */
export function scoreHeader(label: string): FieldCandidate[] {
  const text = normalizeText(label);
  const key = normalizeKey(label);
  if (!key) return [];

  const results: FieldCandidate[] = [];

  for (const synonym of FIELD_SYNONYMS) {
    let best = 0;
    for (const candidate of synonym.labels) {
      const candKey = normalizeKey(candidate);
      if (!candKey) continue;

      if (key === candKey) {
        best = Math.max(best, 1);
        continue;
      }
      if (synonym.exact) continue;

      if (key.startsWith(candKey) || key.endsWith(candKey)) {
        best = Math.max(best, 0.8 * (candKey.length / key.length) + 0.15);
        continue;
      }
      if (key.includes(candKey) && candKey.length >= 3) {
        best = Math.max(best, 0.55 * (candKey.length / key.length) + 0.1);
        continue;
      }
      // Word-level overlap catches "Amount Received (THB)" vs "received amount".
      if (!synonym.exact && text.includes(normalizeText(candidate)) && candidate.length >= 4) {
        best = Math.max(best, 0.5);
      }
    }
    if (best > 0) results.push({ field: synonym.field, score: best * (synonym.weight ?? 1) });
  }

  return results.sort((a, b) => b.score - a.score);
}

export interface HeaderDetection {
  headerRow: number | null;
  headers: string[];
  columns: ColumnMapping[];
  /** Sum of the winning column scores — feeds sheet classification. */
  strength: number;
}

/**
 * Locates the header row and builds the column map.
 *
 * A row is judged on how many of its non-empty cells look like known headers,
 * how many distinct fields it explains, and whether numeric data follows it.
 */
export function detectHeaders(sheet: RawSheet): HeaderDetection {
  const scanRows = Math.min(sheet.rowCount, MAX_HEADER_SCAN_ROWS);
  let best: HeaderDetection = { headerRow: null, headers: [], columns: [], strength: 0 };

  for (let r = 0; r < scanRows; r += 1) {
    const row = sheet.rows[r];
    if (!row || row.length === 0) continue;

    const labels: { index: number; text: string }[] = [];
    for (let c = 0; c < sheet.colCount; c += 1) {
      const text = cellText(getCell(sheet, r, c));
      if (text) labels.push({ index: c, text });
    }
    // A single stray label is a title, not a header row.
    if (labels.length < 2) continue;

    const assigned = assignColumns(labels);
    if (assigned.length === 0) continue;

    const strength =
      assigned.reduce((sum, col) => sum + col.score, 0) *
      // Reward rows that explain several distinct fields.
      (1 + new Set(assigned.map((c) => c.field)).size * 0.08) *
      // Reward rows followed by actual data.
      (hasDataBelow(sheet, r) ? 1.25 : 0.7);

    if (strength > best.strength) {
      best = {
        headerRow: r,
        headers: labels.map((l) => l.text),
        columns: assigned,
        strength,
      };
    }
  }

  return best;
}

/**
 * Assigns each column its best field, resolving collisions so two columns
 * never claim the same canonical field (the weaker one gets its runner-up).
 */
function assignColumns(labels: { index: number; text: string }[]): ColumnMapping[] {
  const candidates = labels.map((label) => ({
    index: label.index,
    text: label.text,
    ranked: scoreHeader(label.text),
  }));

  const taken = new Map<CanonicalField, { columnIndex: number; score: number }>();
  const result: ColumnMapping[] = [];

  // Greedy by descending score across all (column, field) pairs.
  const pairs = candidates
    .flatMap((c) => c.ranked.map((r) => ({ column: c, field: r.field, score: r.score })))
    .sort((a, b) => b.score - a.score);

  const usedColumns = new Set<number>();

  for (const pair of pairs) {
    if (pair.score < 0.4) break;
    if (usedColumns.has(pair.column.index)) continue;
    if (taken.has(pair.field)) continue;

    usedColumns.add(pair.column.index);
    taken.set(pair.field, { columnIndex: pair.column.index, score: pair.score });
    result.push({
      field: pair.field,
      columnIndex: pair.column.index,
      header: pair.column.text,
      via: 'header',
      score: Number(pair.score.toFixed(3)),
    });
  }

  return result.sort((a, b) => a.columnIndex - b.columnIndex);
}

/** True when at least one numeric value appears in the rows under `headerRow`. */
function hasDataBelow(sheet: RawSheet, headerRow: number): boolean {
  const limit = Math.min(sheet.rowCount, headerRow + 12);
  for (let r = headerRow + 1; r < limit; r += 1) {
    const row = sheet.rows[r];
    if (!row || row.length === 0) continue;
    for (const cell of row) {
      if (cell && typeof cell.v === 'number') return true;
    }
  }
  return false;
}

/** Convenience lookup used all over the normalizers. */
export function columnOf(columns: ColumnMapping[], field: CanonicalField): number | null {
  return columns.find((c) => c.field === field)?.columnIndex ?? null;
}

export function hasFields(columns: ColumnMapping[], fields: CanonicalField[]): boolean {
  return fields.every((f) => columns.some((c) => c.field === f));
}

export function countFields(columns: ColumnMapping[], fields: CanonicalField[]): number {
  return fields.filter((f) => columns.some((c) => c.field === f)).length;
}
