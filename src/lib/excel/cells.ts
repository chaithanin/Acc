import type { RawCell, RawSheet, SourceRef } from './types';

/** Converts a 0-based column index into Excel letters (0 -> A, 27 -> AB). */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** Builds the Excel address for a cell at grid position (r, c) of a sheet. */
export function cellAddress(sheet: RawSheet, r: number, c: number): string {
  return `${columnLetter(sheet.originCol + c)}${sheet.originRow + r + 1}`;
}

export function excelRowNumber(sheet: RawSheet, r: number): number {
  return sheet.originRow + r + 1;
}

export function excelColNumber(sheet: RawSheet, c: number): number {
  return sheet.originCol + c + 1;
}

export function makeSourceRef(
  file: string,
  sheet: RawSheet | null,
  r?: number | null,
  c?: number | null,
): SourceRef {
  if (!sheet) return { file, sheet: null, row: null, col: null, cell: null };
  if (r === null || r === undefined) {
    return { file, sheet: sheet.name, row: null, col: null, cell: null };
  }
  if (c === null || c === undefined) {
    return { file, sheet: sheet.name, row: excelRowNumber(sheet, r), col: null, cell: null };
  }
  return {
    file,
    sheet: sheet.name,
    row: excelRowNumber(sheet, r),
    col: excelColNumber(sheet, c),
    cell: cellAddress(sheet, r, c),
  };
}

export function getCell(sheet: RawSheet, r: number, c: number): RawCell | null {
  const row = sheet.rows[r];
  if (!row || row.length === 0) return null;
  return row[c] ?? null;
}

/** Display text for a cell, preferring Excel's own rendering. */
export function cellText(cell: RawCell | null): string {
  if (!cell) return '';
  if (typeof cell.w === 'string' && cell.w.trim() !== '') return cell.w.trim();
  if (cell.v === null || cell.v === undefined) return '';
  if (typeof cell.v === 'boolean') return cell.v ? 'TRUE' : 'FALSE';
  return String(cell.v).trim();
}

export function isErrorCell(cell: RawCell | null): boolean {
  return !!cell && cell.t === 'e';
}

/**
 * True when a formula reaches outside this workbook. Such values cannot be
 * trusted or recalculated, so they are surfaced as warnings (requirement 28).
 */
export function hasExternalReference(cell: RawCell | null): boolean {
  if (!cell?.f) return false;
  // [1]Sheet!A1 (linked book index) or 'C:\path\[Book.xlsx]Sheet'!A1
  return /\[[^\]]+\]/.test(cell.f);
}

export interface NumericParse {
  value: number | null;
  /** Set when the cell held something that is not a clean number. */
  issue: 'text-in-numeric' | 'formula-error' | 'blank' | null;
  raw: string;
  /** The source text carried a "%" sign; `value` is the literal (5% -> 5). */
  isPercent: boolean;
}

const PAREN_NEGATIVE = /^\((.*)\)$/;
/** Currency symbols, thousands separators and stray unit suffixes seen in the wild. */
const NUMERIC_NOISE = /[฿$€£,\s\u00a0'"]|บาท|THB|฿/gi;

/**
 * Coerces a cell to a number the way a finance reviewer would read it.
 *
 * Handles: real numbers, "1,234.50", "฿1,234", "(1,234)" as negative,
 * trailing "%" (returned as the literal percentage number, not the fraction),
 * and Excel error values.
 */
export function parseNumeric(cell: RawCell | null): NumericParse {
  if (!cell) return { value: null, issue: 'blank', raw: '', isPercent: false };
  if (cell.t === 'e') {
    return { value: null, issue: 'formula-error', raw: cellText(cell), isPercent: false };
  }

  if (typeof cell.v === 'number' && Number.isFinite(cell.v)) {
    return { value: cell.v, issue: null, raw: String(cell.v), isPercent: false };
  }
  if (typeof cell.v === 'boolean') {
    return { value: cell.v ? 1 : 0, issue: null, raw: String(cell.v), isPercent: false };
  }

  const raw = cellText(cell);
  if (raw === '' || raw === '-' || raw === '–' || raw === '—') {
    return { value: null, issue: 'blank', raw, isPercent: false };
  }

  let text = raw;
  let sign = 1;

  const paren = PAREN_NEGATIVE.exec(text);
  if (paren) {
    sign = -1;
    text = paren[1];
  }

  let isPercent = false;
  if (text.endsWith('%')) {
    isPercent = true;
    text = text.slice(0, -1);
  }

  text = text.replace(NUMERIC_NOISE, '');

  if (text.startsWith('-')) {
    sign *= -1;
    text = text.slice(1);
  }

  if (text === '' || !/^\d*\.?\d+$/.test(text)) {
    return { value: null, issue: 'text-in-numeric', raw, isPercent };
  }

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) {
    return { value: null, issue: 'text-in-numeric', raw, isPercent };
  }

  return { value: sign * parsed, issue: null, raw, isPercent };
}

/** Reads a cell as a date, tolerating ISO strings, Date-like text and serials. */
export function parseDateCell(cell: RawCell | null): string | null {
  if (!cell) return null;
  if (cell.t === 'd' && typeof cell.v === 'string') {
    const d = new Date(cell.v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (typeof cell.v === 'number' && Number.isFinite(cell.v)) {
    // Excel serial date (1900 system, accounting for the 1900 leap-year bug).
    const ms = Math.round((cell.v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime()) && d.getUTCFullYear() > 1950 && d.getUTCFullYear() < 2200) {
      return d.toISOString().slice(0, 10);
    }
    return null;
  }
  const text = cellText(cell);
  if (!text) return null;
  return parseDateText(text);
}

const THAI_MONTHS: Record<string, number> = {
  'ม.ค.': 1, มกราคม: 1, 'ก.พ.': 2, กุมภาพันธ์: 2, 'มี.ค.': 3, มีนาคม: 3,
  'เม.ย.': 4, เมษายน: 4, 'พ.ค.': 5, พฤษภาคม: 5, 'มิ.ย.': 6, มิถุนายน: 6,
  'ก.ค.': 7, กรกฎาคม: 7, 'ส.ค.': 8, สิงหาคม: 8, 'ก.ย.': 9, กันยายน: 9,
  'ต.ค.': 10, ตุลาคม: 10, 'พ.ย.': 11, พฤศจิกายน: 11, 'ธ.ค.': 12, ธันวาคม: 12,
};

const EN_MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/**
 * Parses the date formats that actually turn up in these workbooks, including
 * Thai Buddhist-era years (2568 -> 2025) and Thai month abbreviations.
 */
export function parseDateText(input: string): string | null {
  const text = input.trim();
  if (!text) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) return buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // 31/08/2026, 31-08-2026, 31.08.2569
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(text);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    const y = normalizeYear(Number(dmy[3]));
    // A value above 12 in the first slot can only be a day.
    if (d > 12 && m <= 12) return buildDate(y, m, d);
    return buildDate(y, m, d);
  }

  // Aug 2026 / August-2026 / ส.ค. 2569 / ส.ค.68
  const monthYear = /^([\p{L}.]+)[\s\-/]*(\d{2,4})$/u.exec(text);
  if (monthYear) {
    const month = lookupMonth(monthYear[1]);
    if (month) return buildDate(normalizeYear(Number(monthYear[2])), month, 1);
  }

  // 2026-08 / 2569/08
  const yearMonth = /^(\d{4})[\s\-/](\d{1,2})$/.exec(text);
  if (yearMonth) {
    return buildDate(normalizeYear(Number(yearMonth[1])), Number(yearMonth[2]), 1);
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() > 1950) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

export function lookupMonth(token: string): number | null {
  const t = token.trim();
  if (THAI_MONTHS[t] !== undefined) return THAI_MONTHS[t];
  const lower = t.toLowerCase().replace(/\.$/, '');
  if (EN_MONTHS[lower] !== undefined) return EN_MONTHS[lower];
  for (const [key, value] of Object.entries(THAI_MONTHS)) {
    if (t.startsWith(key.replace(/\.$/, ''))) return value;
  }
  return null;
}

/** Thai Buddhist era and 2-digit years both normalise to a Gregorian year. */
export function normalizeYear(year: number): number {
  if (year > 2400) return year - 543;
  if (year < 100) {
    // 68 -> 2568 BE -> 2025; 26 -> 2026 CE.
    return year >= 50 ? 1957 + year : 2000 + year;
  }
  return year;
}

function buildDate(y: number, m: number, d: number): string | null {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/** Last day of the month for a YYYY-MM-DD date — the usual finance report date. */
export function endOfMonth(isoDate: string): string {
  const [y, m] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}
