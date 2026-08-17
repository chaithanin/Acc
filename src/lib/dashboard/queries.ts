import 'server-only';

import { getDb } from '@/lib/db';
import { getProjection as readProjection } from '@/lib/db/repositories/snapshots';
import type { CashflowProjection } from '@/lib/calc/cashflow';
import type { Project } from '@/lib/types';

/**
 * Aggregate reads that back the charts and tables.
 *
 * These queries roll stored records up for display. They never recompute a
 * KPI — that is the calculation engine's job, and duplicating it here would
 * create a second definition of the same number.
 */

export interface ProjectMetricRow {
  projectId: string;
  projectName: string;
  receivableOutstanding: number;
  boqOutstanding: number;
  availableCash: number;
  advanceOutstanding: number;
}

/** Per-project figures for the comparison chart on the overview. */
export function getProjectMetrics(snapshotId: string, projects: Project[]): ProjectMetricRow[] {
  const rows = getDb()
    .prepare<[string], { project_id: string; metric_key: string; value: number | null }>(
      `SELECT project_id, metric_key, value
         FROM calculated_metrics
        WHERE snapshot_id = ? AND project_id IS NOT NULL
          AND metric_key IN ('total_receivable_outstanding','boq_outstanding','available_cash','advance_outstanding')`,
    )
    .all(snapshotId);

  const byProject = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const entry = byProject.get(row.project_id) ?? {};
    entry[row.metric_key] = row.value ?? 0;
    byProject.set(row.project_id, entry);
  }

  return [...byProject.entries()]
    .map(([projectId, values]) => ({
      projectId,
      projectName: projects.find((p) => p.id === projectId)?.name ?? 'Unassigned',
      receivableOutstanding: values.total_receivable_outstanding ?? 0,
      boqOutstanding: values.boq_outstanding ?? 0,
      availableCash: values.available_cash ?? 0,
      advanceOutstanding: values.advance_outstanding ?? 0,
    }))
    .sort((a, b) => a.projectName.localeCompare(b.projectName));
}

export function getProjection(snapshotId: string, projectId: string | null): CashflowProjection {
  return readProjection(snapshotId, projectId);
}

export interface DatasetSummary {
  incomeByMonth: { label: string; income: number; expense: number }[];
  receivableByCategory: { label: string; value: number }[];
  receivedTotal: number;
  outstandingTotal: number;
  recordCounts: Record<string, number>;
}

const CATEGORY_LABELS: Record<string, string> = {
  reservation: 'Reservation',
  contract: 'Contract',
  down_payment: 'Down Payment',
  transfer_fee: 'Transfer Fee',
  rental: 'Rental',
  related_company: 'Related Company',
  other_income: 'Other Income',
};

export function loadDatasetSummary(snapshotId: string, projectId: string | null): DatasetSummary {
  const db = getDb();
  const scope = projectId ? 'AND project_id = ?' : '';
  const args = projectId ? [snapshotId, projectId] : [snapshotId];

  const monthly = db
    .prepare<(string | null)[], { month: string | null; income: number; expense: number }>(
      `SELECT month,
              SUM(income)  AS income,
              SUM(expense) AS expense
         FROM (
           SELECT month, contractual_amount AS income, 0 AS expense
             FROM income_records WHERE snapshot_id = ? ${scope}
           UNION ALL
           SELECT month, 0 AS income, amount AS expense
             FROM expense_records WHERE snapshot_id = ? ${projectId ? 'AND project_id = ?' : ''}
           UNION ALL
           SELECT month, 0 AS income, (boq_to_date - paid_amount) AS expense
             FROM boq_records WHERE snapshot_id = ? ${projectId ? 'AND project_id = ?' : ''}
         )
        WHERE month IS NOT NULL
        GROUP BY month
        ORDER BY month`,
    )
    .all(...args, ...args, ...args);

  const byCategory = db
    .prepare<(string | null)[], { category: string; contractual: number; received: number }>(
      `SELECT category,
              SUM(contractual_amount) AS contractual,
              SUM(receive_amount)     AS received
         FROM receivable_records
        WHERE snapshot_id = ? ${scope}
        GROUP BY category`,
    )
    .all(...args);

  const receivedTotal = byCategory.reduce((sum, r) => sum + (r.received ?? 0), 0);
  const contractualTotal = byCategory.reduce((sum, r) => sum + (r.contractual ?? 0), 0);

  const counts = db
    .prepare<(string | null)[], { kind: string; n: number }>(
      `SELECT 'receivable' AS kind, COUNT(*) AS n FROM receivable_records WHERE snapshot_id = ? ${scope}
       UNION ALL SELECT 'boq', COUNT(*) FROM boq_records WHERE snapshot_id = ? ${scope}
       UNION ALL SELECT 'bank', COUNT(*) FROM bank_balances WHERE snapshot_id = ? ${scope}
       UNION ALL SELECT 'wip', COUNT(*) FROM wip_records WHERE snapshot_id = ? ${scope}
       UNION ALL SELECT 'gl', COUNT(*) FROM gl_entries WHERE snapshot_id = ? ${scope}
       UNION ALL SELECT 'income', COUNT(*) FROM income_records WHERE snapshot_id = ? ${scope}
       UNION ALL SELECT 'expense', COUNT(*) FROM expense_records WHERE snapshot_id = ? ${scope}`,
    )
    .all(...args, ...args, ...args, ...args, ...args, ...args, ...args);

  return {
    incomeByMonth: monthly.map((row) => ({
      label: row.month ?? '',
      income: row.income ?? 0,
      expense: row.expense ?? 0,
    })),
    receivableByCategory: byCategory
      .map((row) => ({
        label: CATEGORY_LABELS[row.category] ?? row.category,
        value: (row.contractual ?? 0) - (row.received ?? 0),
      }))
      .filter((row) => row.value !== 0)
      .sort((a, b) => b.value - a.value),
    receivedTotal,
    outstandingTotal: contractualTotal - receivedTotal,
    recordCounts: Object.fromEntries(counts.map((c) => [c.kind, c.n])),
  };
}

// ----------------------------------------------------------- monthly series

export interface MonthPoint {
  month: string;
  label: string;
  income: number;
  expense: number;
  netProfit: number;
  /** Running cash at the end of the month. */
  cash: number;
}

const MONTH_LABELS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * Twelve months of income, expense, net profit and closing cash for the
 * calendar year of the report date.
 *
 * Months with no records stay at zero rather than being dropped, so the axis
 * always reads JAN–DEC and a gap in the data is visible as a gap.
 */
export function getMonthlySeries(
  snapshotId: string,
  projectId: string | null,
  reportDate: string,
  openingCash: number,
): MonthPoint[] {
  const db = getDb();
  const year = reportDate.slice(0, 4);
  const scope = projectId ? 'AND project_id = ?' : '';
  const args = projectId ? [snapshotId, projectId] : [snapshotId];

  const rows = db
    .prepare<(string | null)[], { month: string; income: number; expense: number }>(
      `SELECT month, SUM(income) AS income, SUM(expense) AS expense
         FROM (
           SELECT month, contractual_amount AS income, 0 AS expense
             FROM income_records  WHERE snapshot_id = ? ${scope}
           UNION ALL
           SELECT month, 0, amount
             FROM expense_records WHERE snapshot_id = ? ${scope}
           UNION ALL
           SELECT month, 0, (boq_to_date - paid_amount)
             FROM boq_records     WHERE snapshot_id = ? ${scope}
         )
        WHERE month IS NOT NULL
        GROUP BY month`,
    )
    .all(...args, ...args, ...args);

  const byMonth = new Map(rows.map((r) => [r.month, r]));

  let cash = openingCash;
  return MONTH_LABELS.map((label, index) => {
    const month = `${year}-${String(index + 1).padStart(2, '0')}`;
    const row = byMonth.get(month);
    const income = row?.income ?? 0;
    const expense = row?.expense ?? 0;
    const netProfit = Number((income - expense).toFixed(2));
    cash = Number((cash + netProfit).toFixed(2));
    return { month, label, income, expense, netProfit, cash };
  });
}

/** True when any month in the series carries a figure worth plotting. */
export function hasMonthlyData(series: MonthPoint[]): boolean {
  return series.some((m) => m.income !== 0 || m.expense !== 0);
}

// ------------------------------------------------------------------ tables

export interface ReceivableTableRow {
  projectName: string | null;
  category: string;
  customer: string | null;
  unit: string | null;
  contractual: number;
  received: number;
  outstanding: number;
  percent: number | null;
  sourceFile: string | null;
  sourceSheet: string | null;
  sourceCell: string | null;
}

export function getReceivableRows(snapshotId: string, projectId: string | null): ReceivableTableRow[] {
  const db = getDb();
  const sql = `
    SELECT p.name AS project_name, r.category, r.customer, r.unit,
           r.contractual_amount, r.receive_amount,
           sr.source_file, sr.source_sheet, sr.source_cell
      FROM receivable_records r
      LEFT JOIN projects p ON p.id = r.project_id
      LEFT JOIN source_references sr ON sr.id = r.source_ref_id
     WHERE r.snapshot_id = ? ${projectId ? 'AND r.project_id = ?' : ''}
     ORDER BY r.contractual_amount DESC`;

  const args = projectId ? [snapshotId, projectId] : [snapshotId];

  return db
    .prepare<string[], any>(sql)
    .all(...args)
    .map((row) => {
      const outstanding = (row.contractual_amount ?? 0) - (row.receive_amount ?? 0);
      return {
        projectName: row.project_name,
        category: CATEGORY_LABELS[row.category] ?? row.category,
        customer: row.customer,
        unit: row.unit,
        contractual: row.contractual_amount ?? 0,
        received: row.receive_amount ?? 0,
        outstanding,
        percent:
          row.contractual_amount > 0
            ? Number(((row.receive_amount / row.contractual_amount) * 100).toFixed(1))
            : null,
        sourceFile: row.source_file,
        sourceSheet: row.source_sheet,
        sourceCell: row.source_cell,
      };
    });
}

export interface BoqTableRow {
  projectName: string | null;
  description: string | null;
  contractor: string | null;
  costCategory: string | null;
  month: string | null;
  boqAmount: number;
  boqToDate: number;
  paidAmount: number;
  outstanding: number;
  sourceFile: string | null;
  sourceSheet: string | null;
  sourceCell: string | null;
}

export function getBoqRows(snapshotId: string, projectId: string | null): BoqTableRow[] {
  const sql = `
    SELECT p.name AS project_name, b.description, b.contractor, b.cost_category, b.month,
           b.boq_amount, b.boq_to_date, b.paid_amount,
           sr.source_file, sr.source_sheet, sr.source_cell
      FROM boq_records b
      LEFT JOIN projects p ON p.id = b.project_id
      LEFT JOIN source_references sr ON sr.id = b.source_ref_id
     WHERE b.snapshot_id = ? ${projectId ? 'AND b.project_id = ?' : ''}
     ORDER BY b.boq_amount DESC`;

  const args = projectId ? [snapshotId, projectId] : [snapshotId];

  return getDb()
    .prepare<string[], any>(sql)
    .all(...args)
    .map((row) => ({
      projectName: row.project_name,
      description: row.description,
      contractor: row.contractor,
      costCategory: row.cost_category,
      month: row.month,
      boqAmount: row.boq_amount ?? 0,
      boqToDate: row.boq_to_date ?? 0,
      paidAmount: row.paid_amount ?? 0,
      outstanding: (row.boq_to_date ?? 0) - (row.paid_amount ?? 0),
      sourceFile: row.source_file,
      sourceSheet: row.source_sheet,
      sourceCell: row.source_cell,
    }));
}

export interface LedgerTableRow {
  projectName: string | null;
  accountCode: string | null;
  accountName: string | null;
  entryDate: string | null;
  voucherNo: string | null;
  vendor: string | null;
  description: string | null;
  costCode: string | null;
  debit: number;
  credit: number;
  balance: number | null;
  sourceFile: string | null;
  sourceSheet: string | null;
  sourceCell: string | null;
}

export function getLedgerRows(
  snapshotId: string,
  projectId: string | null,
  limit = 5000,
): LedgerTableRow[] {
  const sql = `
    SELECT p.name AS project_name, g.account_code, g.account_name, g.entry_date, g.voucher_no,
           g.vendor, g.description, g.cost_code, g.debit, g.credit, g.balance,
           sr.source_file, sr.source_sheet, sr.source_cell
      FROM gl_entries g
      LEFT JOIN projects p ON p.id = g.project_id
      LEFT JOIN source_references sr ON sr.id = g.source_ref_id
     WHERE g.snapshot_id = ? ${projectId ? 'AND g.project_id = ?' : ''}
     ORDER BY g.entry_date, g.voucher_no
     LIMIT ?`;

  const args = projectId ? [snapshotId, projectId, limit] : [snapshotId, limit];

  return getDb()
    .prepare<(string | number)[], any>(sql)
    .all(...args)
    .map((row) => ({
      projectName: row.project_name,
      accountCode: row.account_code,
      accountName: row.account_name,
      entryDate: row.entry_date,
      voucherNo: row.voucher_no,
      vendor: row.vendor,
      description: row.description,
      costCode: row.cost_code,
      debit: row.debit ?? 0,
      credit: row.credit ?? 0,
      balance: row.balance,
      sourceFile: row.source_file,
      sourceSheet: row.source_sheet,
      sourceCell: row.source_cell,
    }));
}

export interface AccountSummaryRow {
  projectName: string | null;
  accountCode: string | null;
  accountName: string | null;
  currentPeriod: number;
  closing: number;
  advance: number;
}

export function getAccountSummary(snapshotId: string, projectId: string | null): AccountSummaryRow[] {
  const sql = `
    SELECT p.name AS project_name, w.account_code, w.account_name,
           w.current_period, w.ytd, w.advance_payment
      FROM wip_records w
      LEFT JOIN projects p ON p.id = w.project_id
     WHERE w.snapshot_id = ? ${projectId ? 'AND w.project_id = ?' : ''}
     ORDER BY w.ytd DESC`;

  const args = projectId ? [snapshotId, projectId] : [snapshotId];

  return getDb()
    .prepare<string[], any>(sql)
    .all(...args)
    .map((row) => ({
      projectName: row.project_name,
      accountCode: row.account_code,
      accountName: row.account_name,
      currentPeriod: row.current_period ?? 0,
      closing: row.ytd ?? 0,
      advance: row.advance_payment ?? 0,
    }));
}
