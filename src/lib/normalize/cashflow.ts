import { parseDateText } from '@/lib/excel/cells';
import type { CashflowRecord } from '@/lib/types';
import { dataRows, type NormalizeContext } from './context';

/**
 * Cash-flow forecast sheets.
 *
 * Only the per-month INPUTS are taken from the file — expected income and
 * expected expense. The net figure and the running closing balance are
 * recalculated by the engine (requirement 9), so any value read here for those
 * columns is kept purely for reconciliation against our own result.
 */
export function normalizeCashflow(ctx: NormalizeContext): CashflowRecord[] {
  const records: CashflowRecord[] = [];

  for (const row of dataRows(ctx)) {
    if (row.isTotalRow()) continue;

    const monthText = row.text('month') ?? row.text('date') ?? row.text('description');
    const iso = monthText ? parseDateText(monthText) : row.date('date');
    if (!iso) continue;

    const income = row.num('expected_income') ?? row.num('income_amount');
    const expense = row.num('expected_expense') ?? row.num('expense_amount');
    const opening = row.num('opening_balance');
    const closing = row.num('closing_balance');
    const net = row.num('net_cashflow');

    if (income === null && expense === null && opening === null && closing === null) continue;

    const project = row.project();

    records.push({
      kind: 'cashflow',
      sourceRef: row.ref('expected_income'),
      projectId: project.id,
      projectLabel: project.label,
      month: iso.slice(0, 7),
      openingBalance: opening,
      expectedIncome: income ?? 0,
      expectedExpense: expense ?? 0,
      // Stated values, retained only so reconciliation can compare them with
      // the engine's own running balance.
      netCashflow: net,
      closingBalance: closing,
      isComputed: false,
    });
  }

  return records;
}
