import type { CanonicalField } from '@/config/field-synonyms';
import { scoreHeader } from '@/lib/detect/header-detector';
import { cellText, getCell, isErrorCell, makeSourceRef, parseNumeric } from '@/lib/excel/cells';
import type { RawSheet, SourceRef } from '@/lib/excel/types';

/**
 * Label/value extraction for summary-style sheets.
 *
 * Many finance sheets are not tables at all — they read
 * "Bank Current Amount | 8,000,000" down column A/B. The tabular header
 * detector finds nothing there, so this pass looks for a recognisable LABEL
 * cell and takes the nearest number to its right (or directly below).
 *
 * This is still label-driven, not position-driven: nothing here assumes the
 * label sits in a particular column (requirement 25).
 */

/** How far right of a label to look for its value. */
const VALUE_SEARCH_COLS = 8;

export interface KeyValueHit {
  field: CanonicalField;
  label: string;
  value: number;
  score: number;
  labelRef: SourceRef;
  valueRef: SourceRef;
  /** Formula behind the value, when it was Excel-calculated. */
  formula: string | null;
}

export function extractKeyValues(
  sheet: RawSheet,
  fileName: string,
  options: { minScore?: number; fields?: CanonicalField[] } = {},
): KeyValueHit[] {
  const minScore = options.minScore ?? 0.75;
  const allowed = options.fields ? new Set(options.fields) : null;
  const hits: KeyValueHit[] = [];

  for (let r = 0; r < sheet.rowCount; r += 1) {
    const row = sheet.rows[r];
    if (!row || row.length === 0) continue;

    for (let c = 0; c < sheet.colCount; c += 1) {
      const cell = getCell(sheet, r, c);
      if (!cell || typeof cell.v === 'number') continue;

      const label = cellText(cell);
      // Long prose is a note, not a label.
      if (!label || label.length > 80) continue;

      const ranked = scoreHeader(label);
      const top = ranked[0];
      if (!top || top.score < minScore) continue;
      if (allowed && !allowed.has(top.field)) continue;

      const found = findValueNear(sheet, r, c);
      if (!found) continue;

      hits.push({
        field: top.field,
        label,
        value: found.value,
        score: Number(top.score.toFixed(3)),
        labelRef: makeSourceRef(fileName, sheet, r, c),
        valueRef: makeSourceRef(fileName, sheet, found.row, found.col),
        formula: found.formula,
      });
    }
  }

  return hits;
}

function findValueNear(
  sheet: RawSheet,
  r: number,
  c: number,
): { value: number; row: number; col: number; formula: string | null } | null {
  // Prefer the value to the right — the overwhelmingly common layout.
  const maxCol = Math.min(sheet.colCount, c + 1 + VALUE_SEARCH_COLS);
  for (let cc = c + 1; cc < maxCol; cc += 1) {
    const cell = getCell(sheet, r, cc);
    if (!cell) continue;
    if (isErrorCell(cell)) return null;
    const parsed = parseNumeric(cell);
    if (parsed.value !== null) {
      return { value: parsed.value, row: r, col: cc, formula: cell.f ?? null };
    }
    // A second text cell means the label's value is not on this row.
    if (cellText(cell) !== '') return null;
  }

  // Otherwise accept a number sitting directly beneath the label.
  const below = getCell(sheet, r + 1, c);
  if (below && !isErrorCell(below)) {
    const parsed = parseNumeric(below);
    if (parsed.value !== null) {
      return { value: parsed.value, row: r + 1, col: c, formula: below.f ?? null };
    }
  }

  return null;
}

/**
 * Collapses hits to one value per field, keeping the highest-scoring match.
 * Summary sheets repeat labels (per project, then a total); the strongest
 * label wins and the rest stay available to the caller.
 */
export function bestPerField(hits: KeyValueHit[]): Map<CanonicalField, KeyValueHit> {
  const out = new Map<CanonicalField, KeyValueHit>();
  for (const hit of hits) {
    const existing = out.get(hit.field);
    if (!existing || hit.score > existing.score) out.set(hit.field, hit);
  }
  return out;
}
