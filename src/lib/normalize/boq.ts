import { makeSourceRef, parseDateText } from '@/lib/excel/cells';
import type { BoqRecord } from '@/lib/types';
import { dataRows, detectExpenseCategory, headerTextAt, type NormalizeContext } from './context';

/**
 * BOQ / construction cost sheets.
 *
 * Supports the per-item table ("BOQ | To Date | Paid | Pending") and the
 * monthly matrix layout where each column is a month and the row is a cost
 * item — the "คชจ แต่ละเดือน" sheets.
 */
export function normalizeBoq(ctx: NormalizeContext): BoqRecord[] {
  const monthColumns = detectMonthColumns(ctx);
  const rows = monthColumns.length >= 2 ? normalizeMonthly(ctx, monthColumns) : normalizeItems(ctx);
  return rows;
}

interface MonthColumn {
  month: string;
  columnIndex: number;
  header: string;
}

/**
 * Finds header cells that parse as a month. Two or more means the sheet is a
 * month-by-month matrix rather than an item list.
 */
function detectMonthColumns(ctx: NormalizeContext): MonthColumn[] {
  const { sheet, detection } = ctx;
  if (detection.headerRow === null) return [];

  const claimed = new Set(detection.columns.map((c) => c.columnIndex));
  const found: MonthColumn[] = [];

  for (let c = 0; c < sheet.colCount; c += 1) {
    if (claimed.has(c)) continue;
    const header = headerTextAt(sheet, detection.headerRow, c);
    if (!header || header.length > 24) continue;
    const iso = parseDateText(header);
    if (!iso) continue;
    found.push({ month: iso.slice(0, 7), columnIndex: c, header });
  }
  return found;
}

function normalizeItems(ctx: NormalizeContext): BoqRecord[] {
  const records: BoqRecord[] = [];

  for (const row of dataRows(ctx)) {
    if (row.isTotalRow()) continue;

    const boq = row.num('boq_amount');
    const toDate = row.num('boq_to_date');
    const paid = row.num('paid_amount');
    const pending = row.num('pending_amount');
    const accrued = row.num('accrued_amount');
    const amount = row.num('amount');

    if (boq === null && toDate === null && paid === null && pending === null && amount === null) {
      continue;
    }

    const description = row.text('description') ?? row.text('category');
    const project = row.project();
    const labels = row.labelTexts();

    const boqAmount = boq ?? amount ?? 0;
    const paidAmount = paid ?? 0;
    const boqToDate = toDate ?? boqAmount;

    records.push({
      kind: 'boq',
      sourceRef: row.ref('boq_amount'),
      projectId: project.id,
      projectLabel: project.label,
      accountCode: row.text('account_code'),
      description,
      contractor: row.text('contractor'),
      costCategory: detectExpenseCategory(labels) ?? 'construction',
      month: row.text('month') ? monthOf(row.text('month')) : row.date('date')?.slice(0, 7) ?? null,
      boqAmount,
      boqToDate,
      paidAmount,
      // Prefer a stated pending/accrued figure; otherwise derive it.
      pendingAmount: pending ?? accrued ?? boqToDate - paidAmount,
    });
  }

  return records;
}

function normalizeMonthly(ctx: NormalizeContext, monthColumns: MonthColumn[]): BoqRecord[] {
  const records: BoqRecord[] = [];

  for (const row of dataRows(ctx)) {
    if (row.isTotalRow()) continue;

    const description = row.text('description') ?? row.text('category') ?? row.text('account_name');
    const project = row.project();
    const labels = row.labelTexts();
    const costCategory = detectExpenseCategory(labels) ?? 'construction';
    const contractor = row.text('contractor');
    const accountCode = row.text('account_code');

    for (const col of monthColumns) {
      const cell = ctx.sheet.rows[row.rowIndex]?.[col.columnIndex] ?? null;
      if (!cell || typeof cell.v !== 'number' || cell.v === 0) continue;

      records.push({
        kind: 'boq',
        sourceRef: makeSourceRef(ctx.fileName, ctx.sheet, row.rowIndex, col.columnIndex),
        projectId: project.id,
        projectLabel: project.label,
        accountCode,
        description,
        contractor,
        costCategory,
        month: col.month,
        // A monthly matrix states planned/committed cost per month; there is
        // no separate paid column, so paid is left at zero rather than assumed.
        boqAmount: cell.v,
        boqToDate: cell.v,
        paidAmount: 0,
        pendingAmount: cell.v,
      });
    }
  }

  return records;
}

function monthOf(text: string | null): string | null {
  if (!text) return null;
  const iso = parseDateText(text);
  return iso ? iso.slice(0, 7) : null;
}
