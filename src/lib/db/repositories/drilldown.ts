import { getDb } from '../index';
import { scopeClause, type DataScope } from '../scope';

/**
 * Drill-down queries (requirement 16).
 *
 * Every KPI resolves to the individual records behind it, each carrying its
 * source file, sheet and cell so Finance can walk the number back to the
 * spreadsheet it came from.
 *
 * Each entry declares its table and expressions rather than a whole SQL string,
 * so the snapshot/project filter and the source-reference join are written once
 * and no query is assembled by rewriting text.
 */

export interface DrilldownRow {
  projectName: string | null;
  category: string;
  description: string | null;
  amount: number;
  sourceFile: string | null;
  sourceSheet: string | null;
  sourceRow: number | null;
  sourceCell: string | null;
  sourceFormula: string | null;
  importedAt: string | null;
}

interface DrilldownSource {
  label: string;
  table: string;
  /** SQL expression for the amount, in terms of the table alias `t`. */
  amount: string;
  /** SQL expression for the category column. */
  category: string;
  /** SQL expression for the description column. */
  description: string;
  /** Optional extra predicate, parameterised via `params`. */
  where?: string;
  params?: (string | number)[];
}

const RECEIVABLE_OUTSTANDING = 't.contractual_amount - t.receive_amount';
const RECEIVABLE_DESCRIPTION = "COALESCE(t.customer, t.unit, '—')";
const BOQ_DESCRIPTION = "COALESCE(t.description, t.contractor, '—')";
const BOQ_CATEGORY = "COALESCE(t.cost_category, 'BOQ')";

const DRILLDOWN_SOURCES: Record<string, DrilldownSource> = {
  bank_current_amount: {
    label: 'Bank accounts',
    table: 'bank_balances',
    amount: 't.current_amount',
    category: "'Bank'",
    description: "COALESCE(t.bank_name, t.account_no, '—')",
  },
  pending_expense: {
    label: 'Pending expense',
    table: 'bank_balances',
    amount: 't.pending_expense',
    category: "'Pending'",
    description: "COALESCE(t.bank_name, t.account_no, '—')",
  },
  available_cash: {
    label: 'Bank accounts',
    table: 'bank_balances',
    amount: 't.current_amount - t.pending_expense',
    category: "'Available'",
    description: "COALESCE(t.bank_name, t.account_no, '—')",
  },
  current_cash: {
    label: 'Bank accounts',
    table: 'bank_balances',
    amount: 't.current_amount - t.pending_expense',
    category: "'Available'",
    description: "COALESCE(t.bank_name, t.account_no, '—')",
  },
  total_contractual_income: {
    label: 'Contractual income',
    table: 'receivable_records',
    amount: 't.contractual_amount',
    category: 't.category',
    description: RECEIVABLE_DESCRIPTION,
  },
  received_income: {
    label: 'Received income',
    table: 'receivable_records',
    amount: 't.receive_amount',
    category: 't.category',
    description: RECEIVABLE_DESCRIPTION,
  },
  accrued_income: {
    label: 'Accrued income',
    table: 'receivable_records',
    amount: RECEIVABLE_OUTSTANDING,
    category: 't.category',
    description: RECEIVABLE_DESCRIPTION,
  },
  total_receivable_outstanding: {
    label: 'Outstanding receivable',
    table: 'receivable_records',
    amount: RECEIVABLE_OUTSTANDING,
    category: 't.category',
    description: RECEIVABLE_DESCRIPTION,
  },
  boq_total: {
    label: 'BOQ items',
    table: 'boq_records',
    amount: 't.boq_amount',
    category: BOQ_CATEGORY,
    description: BOQ_DESCRIPTION,
  },
  boq_to_date: {
    label: 'BOQ to date',
    table: 'boq_records',
    amount: 't.boq_to_date',
    category: BOQ_CATEGORY,
    description: BOQ_DESCRIPTION,
  },
  boq_paid: {
    label: 'BOQ payments',
    table: 'boq_records',
    amount: 't.paid_amount',
    category: BOQ_CATEGORY,
    description: BOQ_DESCRIPTION,
  },
  boq_outstanding: {
    label: 'BOQ outstanding',
    table: 'boq_records',
    amount: 't.boq_to_date - t.paid_amount',
    category: BOQ_CATEGORY,
    description: BOQ_DESCRIPTION,
  },
  remaining_boq: {
    label: 'Remaining BOQ',
    table: 'boq_records',
    amount: 't.boq_amount - t.paid_amount',
    category: BOQ_CATEGORY,
    description: BOQ_DESCRIPTION,
  },
  total_expense: {
    label: 'Expense records',
    table: 'expense_records',
    amount: 't.amount',
    category: 't.category',
    description: "COALESCE(t.description, '—')",
  },
  other_expense: {
    label: 'Non-construction expense',
    table: 'expense_records',
    amount: 't.amount',
    category: 't.category',
    description: "COALESCE(t.description, '—')",
    where: 't.category <> ?',
    params: ['construction'],
  },
  wip_ytd: {
    label: 'WIP accounts',
    table: 'wip_records',
    amount: 't.ytd',
    category: "COALESCE(t.account_code, 'WIP')",
    description: "COALESCE(t.account_name, '—')",
  },
  advance_outstanding: {
    label: 'Advance & deposit accounts',
    table: 'wip_records',
    amount: 't.advance_payment',
    category: "COALESCE(t.account_code, 'Advance')",
    description: "COALESCE(t.account_name, '—')",
  },
};

/** Receivable category KPIs share one query, differing only by category. */
const RECEIVABLE_CATEGORY_METRICS: Record<string, string> = {
  reservation_outstanding: 'reservation',
  contract_outstanding: 'contract',
  down_payment_outstanding: 'down_payment',
  transfer_outstanding: 'transfer_fee',
};

function sourceFor(metricKey: string): DrilldownSource | null {
  const category = RECEIVABLE_CATEGORY_METRICS[metricKey];
  if (category) {
    return {
      label: 'Outstanding receivable',
      table: 'receivable_records',
      amount: RECEIVABLE_OUTSTANDING,
      category: 't.category',
      description: RECEIVABLE_DESCRIPTION,
      where: 't.category = ?',
      params: [category],
    };
  }
  return DRILLDOWN_SOURCES[metricKey] ?? null;
}

/**
 * The records behind one KPI.
 *
 * This is the endpoint an attacker reaches for: it takes a snapshot id and a
 * project id straight from the query string and returns rows. The company in
 * `scope` comes from the session instead, and both it and the snapshot are
 * matched on the record itself, so another company's snapshot id returns an
 * empty result rather than that company's records.
 */
export interface DrilldownResult {
  rows: DrilldownRow[];
  label: string;
  supported: boolean;
  /**
   * The total of EVERY contributing record, not of the rows returned.
   *
   * Summing the returned rows was wrong the moment the limit bit: a KPI of
   * ฿1.2bn opened a drill-down footed at ฿400m and nothing said why. A figure
   * that disagrees with the KPI it explains is worse than no figure.
   */
  total: number;
  /** How many records contribute, before the limit. */
  recordCount: number;
  /** True when `rows` is a subset — the caller must say so on screen. */
  truncated: boolean;
}

export function drilldown(
  scope: DataScope,
  metricKey: string,
  limit = 500,
): DrilldownResult {
  const source = sourceFor(metricKey);
  if (!source) {
    return { rows: [], label: '', supported: false, total: 0, recordCount: 0, truncated: false };
  }

  const scoped = scopeClause(scope, 't');
  const predicates = [scoped.where];
  const params: (string | number)[] = [...scoped.params];

  if (source.where) {
    predicates.push(source.where);
    params.push(...(source.params ?? []));
  }

  const where = `${predicates.join(' AND ')}
       AND ${source.amount} IS NOT NULL
       AND ${source.amount} <> 0`;

  // The true footing, computed over every contributing record. Read before the
  // rows so the limit below cannot change it.
  const totals = getDb()
    .prepare<(string | number)[], { n: number; total: number | null }>(
      `SELECT COUNT(*) AS n, SUM(${source.amount}) AS total FROM ${source.table} t WHERE ${where}`,
    )
    .get(...params) ?? { n: 0, total: 0 };

  // Table and expressions come from the constant map above, never from input.
  const sql = `
    SELECT p.name                AS project_name,
           ${source.category}    AS category,
           ${source.description} AS description,
           ${source.amount}      AS amount,
           sr.source_file, sr.source_sheet, sr.source_row, sr.source_cell,
           sr.source_formula, sr.created_at AS imported_at
      FROM ${source.table} t
      LEFT JOIN projects p           ON p.id = t.project_id
      LEFT JOIN source_references sr ON sr.id = t.source_ref_id
     WHERE ${where}
     ORDER BY ABS(${source.amount}) DESC
     LIMIT ?`;

  params.push(limit);

  const rows = getDb()
    .prepare<(string | number)[], {
      project_name: string | null; category: string; description: string | null; amount: number;
      source_file: string | null; source_sheet: string | null; source_row: number | null;
      source_cell: string | null; source_formula: string | null; imported_at: string | null;
    }>(sql)
    .all(...params);

  return {
    label: source.label,
    supported: true,
    total: totals.total ?? 0,
    recordCount: totals.n,
    truncated: totals.n > rows.length,
    rows: rows.map((row) => ({
      projectName: row.project_name,
      category: row.category,
      description: row.description,
      amount: row.amount,
      sourceFile: row.source_file,
      sourceSheet: row.source_sheet,
      sourceRow: row.source_row,
      sourceCell: row.source_cell,
      sourceFormula: row.source_formula,
      importedAt: row.imported_at,
    })),
  };
}

export function isDrilldownSupported(metricKey: string): boolean {
  return sourceFor(metricKey) !== null;
}
