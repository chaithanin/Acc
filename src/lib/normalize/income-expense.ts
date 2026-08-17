import { parseDateText } from '@/lib/excel/cells';
import type { ExpenseRecord, IncomeRecord } from '@/lib/types';
import {
  dataRows,
  detectExpenseCategory,
  detectIncomeCategory,
  type NormalizeContext,
  type RowReader,
} from './context';

/**
 * Income sheets.
 *
 * An income line carries up to three figures — what is contracted, what has
 * been received, and what is still accrued. Only the first two are ever read
 * from the file; the accrued figure is recomputed by the calculation engine so
 * a stale Excel formula cannot leak into a KPI (requirement 5).
 */
export function normalizeIncome(ctx: NormalizeContext): IncomeRecord[] {
  const records: IncomeRecord[] = [];

  for (const row of dataRows(ctx)) {
    if (row.isTotalRow()) continue;

    const contractual = row.num('contractual_amount');
    const received = row.num('receive_amount');
    const accrued = row.num('accrue_amount');
    const income = row.num('income_amount');
    const amount = row.num('amount');

    if (
      contractual === null && received === null && accrued === null &&
      income === null && amount === null
    ) {
      continue;
    }

    const labels = row.labelTexts();
    const category = detectIncomeCategory(labels) ?? 'other_income';
    const project = row.project();

    const contractualAmount = contractual ?? income ?? amount ?? 0;
    const receivedAmount = received ?? 0;

    records.push({
      kind: 'income',
      sourceRef: row.ref('contractual_amount'),
      projectId: project.id,
      projectLabel: project.label,
      category,
      description: row.text('description') ?? row.text('category'),
      month: monthOf(row),
      contractualAmount,
      receivedAmount,
      accruedAmount: accrued ?? contractualAmount - receivedAmount,
      isForecast: isFutureMonth(monthOf(row), ctx.reportDate),
    });
  }

  return records;
}

/** Expense sheets — one row per cost line, categorised from its own labels. */
export function normalizeExpense(ctx: NormalizeContext): ExpenseRecord[] {
  const records: ExpenseRecord[] = [];

  for (const row of dataRows(ctx)) {
    if (row.isTotalRow()) continue;

    const expense = row.num('expense_amount');
    const paid = row.num('paid_amount');
    const pending = row.num('pending_amount') ?? row.num('pending_expense');
    const amount = row.num('amount');

    if (expense === null && paid === null && pending === null && amount === null) continue;

    const labels = row.labelTexts();
    const category = detectExpenseCategory(labels) ?? 'other_expense';
    const project = row.project();

    const paidAmount = paid ?? 0;
    const pendingAmount = pending ?? 0;
    // When only paid/pending are stated, the total is their sum.
    const total = expense ?? amount ?? paidAmount + pendingAmount;

    records.push({
      kind: 'expense',
      sourceRef: row.ref('expense_amount'),
      projectId: project.id,
      projectLabel: project.label,
      category,
      description: row.text('description') ?? row.text('category'),
      month: monthOf(row),
      amount: total,
      paidAmount,
      pendingAmount,
      isForecast: isFutureMonth(monthOf(row), ctx.reportDate),
    });
  }

  return records;
}

function monthOf(row: RowReader): string | null {
  const monthText = row.text('month');
  if (monthText) {
    const iso = parseDateText(monthText);
    if (iso) return iso.slice(0, 7);
  }
  const date = row.date('date');
  return date ? date.slice(0, 7) : null;
}

/** Anything dated after the report date is forward-looking, not actual. */
function isFutureMonth(month: string | null, reportDate: string): boolean {
  if (!month) return false;
  return month > reportDate.slice(0, 7);
}
