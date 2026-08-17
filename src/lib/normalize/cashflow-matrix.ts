import { cellText, getCell, lookupMonth, makeSourceRef, parseNumeric } from '@/lib/excel/cells';
import { normalizeText } from '@/lib/detect/normalize-text';
import type { RawSheet } from '@/lib/excel/types';
import type { CashflowRecord } from '@/lib/types';
import type { NormalizeContext } from './context';

/**
 * Cash-flow statements laid out as a matrix: months across the columns,
 * line items down the rows, split into INFLOW / OUTFLOW / CASH BALANCE blocks.
 *
 *     INFLOW (Month / 2026)
 *              Jan        Feb        Mar   …
 *     1. Due Date Inv. Billing
 *     1.2 Operating Income
 *     4. Total Cash Inflow (1+2+3)     <- authoritative
 *     7. Total Forecast Cash Inflow Plan (5+6)
 *
 *     OUTFLOW (Month / 2026)           <- values stated negative
 *     …
 *     CASH BALANCE (Month / 2026)
 *     1. Cash at Bank Bal b/f          <- opening
 *     2. Cash Flow Bal (In-Out)        <- net
 *     3. Total Cash at Bank Bal c/f    <- closing
 *
 * The reader takes the stated total rows rather than summing the components,
 * because both are present and adding them would count the same money twice.
 * Opening and closing balances are read for reconciliation only — the running
 * balance is still recomputed by the engine.
 */

/** A month header needs several months on one row before it is believable. */
const MIN_MONTHS_IN_HEADER = 3;

interface MonthColumn {
  month: string;
  col: number;
}

interface Section {
  kind: 'inflow' | 'outflow' | 'balance';
  headerRow: number;
  columns: MonthColumn[];
  lastRow: number;
}

export function isCashflowMatrix(sheet: RawSheet): boolean {
  return findSections(sheet, defaultYear(sheet)).length >= 2;
}

export function normalizeCashflowMatrix(ctx: NormalizeContext): CashflowRecord[] {
  const { sheet } = ctx;
  const sections = findSections(sheet, defaultYear(sheet, ctx.reportDate));
  if (sections.length === 0) return [];

  // month -> the figures gathered for it from every section
  const months = new Map<
    string,
    { income: number; expense: number; opening: number | null; closing: number | null; net: number | null; row: number; col: number }
  >();

  const bucket = (month: string, row: number, col: number) => {
    let entry = months.get(month);
    if (!entry) {
      entry = { income: 0, expense: 0, opening: null, closing: null, net: null, row, col };
      months.set(month, entry);
    }
    return entry;
  };

  for (const section of sections) {
    if (section.kind === 'balance') {
      readBalanceSection(ctx, section, bucket);
    } else {
      readFlowSection(ctx, section, bucket);
    }
  }

  const records: CashflowRecord[] = [];

  for (const [month, entry] of [...months.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    // A month with nothing at all in it is padding on the right of the sheet.
    if (entry.income === 0 && entry.expense === 0 && entry.opening === null && entry.closing === null) {
      continue;
    }

    records.push({
      kind: 'cashflow',
      sourceRef: makeSourceRef(ctx.fileName, sheet, entry.row, entry.col),
      projectId: ctx.defaultProjectId,
      projectLabel: ctx.defaultProjectLabel,
      month,
      openingBalance: entry.opening,
      expectedIncome: entry.income,
      expectedExpense: entry.expense,
      netCashflow: entry.net,
      closingBalance: entry.closing,
      isComputed: false,
    });
  }

  return records;
}

/** Reads an INFLOW or OUTFLOW block into the per-month buckets. */
function readFlowSection(
  ctx: NormalizeContext,
  section: Section,
  bucket: (month: string, row: number, col: number) => { income: number; expense: number },
): void {
  const totalRow = findTotalRow(ctx.sheet, section);

  // Without a stated total, fall back to summing the component lines.
  const rows =
    totalRow !== null
      ? [totalRow]
      : componentRows(ctx.sheet, section);

  for (const row of rows) {
    for (const column of section.columns) {
      const value = parseNumeric(getCell(ctx.sheet, row, column.col)).value;
      if (value === null || value === 0) continue;

      const entry = bucket(column.month, row, column.col);
      // Outflow is stated as a negative; the engine wants a positive cost.
      if (section.kind === 'inflow') entry.income += Math.abs(value);
      else entry.expense += Math.abs(value);
    }
  }
}

/** Reads the CASH BALANCE block: opening, net and closing per month. */
function readBalanceSection(
  ctx: NormalizeContext,
  section: Section,
  bucket: (month: string, row: number, col: number) => {
    opening: number | null;
    closing: number | null;
    net: number | null;
  },
): void {
  for (let r = section.headerRow + 1; r <= section.lastRow; r += 1) {
    const label = normalizeText(rowLabel(ctx.sheet, r));
    if (!label) continue;

    // "Forecast … Plan" lines are a separate scenario, not this month's actual.
    if (label.includes('forecast')) continue;

    const role = balanceRole(label);
    if (!role) continue;

    for (const column of section.columns) {
      const value = parseNumeric(getCell(ctx.sheet, r, column.col)).value;
      if (value === null) continue;
      const entry = bucket(column.month, r, column.col);
      entry[role] = value;
    }
  }
}

function balanceRole(label: string): 'opening' | 'closing' | 'net' | null {
  // Carried-forward is checked first: "Total Cash at Bank Bal c/f" also
  // contains "bal", so a looser opening test would claim it.
  if (label.includes('c/f') || label.includes('carried') || label.includes('ยกไป')) return 'closing';
  if (label.includes('b/f') || label.includes('brought') || label.includes('ยกมา')) return 'opening';
  if (label.includes('in-out') || label.includes('net')) return 'net';
  return null;
}

/**
 * The stated total for a flow section. Forecast totals are skipped so an
 * actuals column is never replaced by a plan of zeroes.
 */
function findTotalRow(sheet: RawSheet, section: Section): number | null {
  for (let r = section.headerRow + 1; r <= section.lastRow; r += 1) {
    const label = normalizeText(rowLabel(sheet, r));
    if (!label.includes('total')) continue;
    if (label.includes('forecast')) continue;
    return r;
  }
  return null;
}

/** Component lines: everything that is neither a total nor a forecast plan. */
function componentRows(sheet: RawSheet, section: Section): number[] {
  const rows: number[] = [];
  for (let r = section.headerRow + 1; r <= section.lastRow; r += 1) {
    const label = normalizeText(rowLabel(sheet, r));
    if (!label || label.includes('total') || label.includes('forecast')) continue;
    rows.push(r);
  }
  return rows;
}

/** First non-empty text cell on a row — the line item's name. */
function rowLabel(sheet: RawSheet, row: number): string {
  const cells = sheet.rows[row];
  if (!cells || cells.length === 0) return '';
  for (const cell of cells) {
    if (!cell || typeof cell.v === 'number') continue;
    const text = cellText(cell);
    if (text) return text;
  }
  return '';
}

/**
 * Locates each month-header row and works out which block it belongs to from
 * the marker text above it.
 */
function findSections(sheet: RawSheet, year: string): Section[] {
  const sections: Section[] = [];

  for (let r = 0; r < sheet.rowCount; r += 1) {
    const columns = monthColumns(sheet, r, year);
    if (columns.length < MIN_MONTHS_IN_HEADER) continue;

    const kind = sectionKind(sheet, r);
    if (!kind) continue;

    sections.push({ kind, headerRow: r, columns, lastRow: sheet.rowCount - 1 });
  }

  // Each section ends where the next one's marker begins.
  for (let i = 0; i < sections.length; i += 1) {
    const next = sections[i + 1];
    if (next) sections[i].lastRow = Math.max(sections[i].headerRow, next.headerRow - 2);
  }

  return sections;
}

/** Reads the block marker in the few rows above a month header. */
function sectionKind(sheet: RawSheet, headerRow: number): Section['kind'] | null {
  for (let r = headerRow; r >= Math.max(0, headerRow - 3); r -= 1) {
    const text = normalizeText(rowLabel(sheet, r));
    if (!text) continue;
    if (text.includes('inflow')) return 'inflow';
    if (text.includes('outflow')) return 'outflow';
    if (text.includes('cash balance') || text.includes('balance (month')) return 'balance';
  }
  return null;
}

/** Month names sitting across a row, mapped to their column. */
function monthColumns(sheet: RawSheet, row: number, year: string): MonthColumn[] {
  const cells = sheet.rows[row];
  if (!cells || cells.length === 0) return [];

  const found: MonthColumn[] = [];
  const seen = new Set<number>();

  for (let c = 0; c < sheet.colCount; c += 1) {
    const text = cellText(getCell(sheet, row, c));
    if (!text || text.length > 12) continue;

    const month = lookupMonth(text);
    // A repeated month means a second year's columns, which this layout does
    // not distinguish; the first occurrence wins.
    if (!month || seen.has(month)) continue;

    seen.add(month);
    found.push({ month: `${year}-${String(month).padStart(2, '0')}`, col: c });
  }

  return found;
}

/**
 * The year the columns belong to. Taken from a marker such as
 * "INFLOW (Month / 2026)", falling back to the report date.
 */
function defaultYear(sheet: RawSheet, reportDate?: string): string {
  const limit = Math.min(sheet.rowCount, 60);
  for (let r = 0; r < limit; r += 1) {
    const text = rowLabel(sheet, r);
    const match = /\b(20\d{2}|25\d{2})\b/.exec(text);
    if (!match) continue;
    const year = Number(match[1]);
    // Thai Buddhist era, as elsewhere in the importer.
    return String(year > 2400 ? year - 543 : year);
  }
  return (reportDate ?? new Date().toISOString()).slice(0, 4);
}
