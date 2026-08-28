import { round2 } from '@/lib/calc/aggregate';
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
  /**
   * Further record sets that belong to the same figure.
   *
   * A KPI that adds two tables together has to open both. Pending Expense is
   * the bank sheets' pending column *plus* the pending on every expense
   * record, and Total Contractual Income is the receivable ledger *plus* the
   * sales sheet — drilling into only the first left the drill-down footing to
   * less than the KPI it was explaining, which is the one thing a drill-down
   * must never do.
   */
  also?: Omit<DrilldownSource, 'label' | 'also'>[];
}

const RECEIVABLE_OUTSTANDING = 't.contractual_amount - t.receive_amount';
const RECEIVABLE_DESCRIPTION = "COALESCE(t.customer, t.unit, '—')";
const BOQ_DESCRIPTION = "COALESCE(t.description, t.contractor, '—')";
const BOQ_CATEGORY = "COALESCE(t.cost_category, 'BOQ')";
const PAYABLE_OUTSTANDING = 't.invoice_amount - t.paid_amount';
const PAYABLE_DESCRIPTION = "COALESCE(t.vendor, t.invoice_no, t.description, '—')";
const INCOME_DESCRIPTION = "COALESCE(t.description, t.category, '—')";
const EXPENSE_DESCRIPTION = "COALESCE(t.description, t.category, '—')";

/** The sales sheet, as a second half of the income figures. */
const INCOME_SHEET = {
  table: 'income_records',
  category: 't.category',
  description: INCOME_DESCRIPTION,
};

/** Pending payments carried on the expense records rather than the bank sheet. */
const EXPENSE_PENDING = {
  table: 'expense_records',
  amount: 't.pending_amount',
  category: "'Pending'",
  description: EXPENSE_DESCRIPTION,
};

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
    also: [EXPENSE_PENDING],
  },
  available_cash: {
    label: 'Bank accounts',
    table: 'bank_balances',
    amount: 't.current_amount - t.pending_expense',
    category: "'Available'",
    description: "COALESCE(t.bank_name, t.account_no, '—')",
    // Available Cash nets off the pending on the expense records too, so the
    // drill-down carries them as negatives rather than footing high.
    also: [{ ...EXPENSE_PENDING, amount: '-t.pending_amount' }],
  },
  current_cash: {
    label: 'Bank accounts',
    table: 'bank_balances',
    amount: 't.current_amount - t.pending_expense',
    category: "'Available'",
    description: "COALESCE(t.bank_name, t.account_no, '—')",
    also: [{ ...EXPENSE_PENDING, amount: '-t.pending_amount' }],
  },
  total_contractual_income: {
    label: 'Contractual income',
    table: 'receivable_records',
    amount: 't.contractual_amount',
    category: 't.category',
    description: RECEIVABLE_DESCRIPTION,
    also: [{ ...INCOME_SHEET, amount: 't.contractual_amount' }],
  },
  received_income: {
    label: 'Received income',
    table: 'receivable_records',
    amount: 't.receive_amount',
    category: 't.category',
    description: RECEIVABLE_DESCRIPTION,
    also: [{ ...INCOME_SHEET, amount: 't.received_amount' }],
  },
  accrued_income: {
    label: 'Accrued income',
    table: 'receivable_records',
    amount: RECEIVABLE_OUTSTANDING,
    category: 't.category',
    description: RECEIVABLE_DESCRIPTION,
    also: [{ ...INCOME_SHEET, amount: 't.contractual_amount - t.received_amount' }],
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
  direct_cost_incurred: {
    label: 'Direct cost incurred',
    table: 'expense_records',
    amount: 't.amount',
    category: 't.category',
    description: EXPENSE_DESCRIPTION,
    where: "t.category IN ('construction', 'contractor', 'material')",
  },
  contracted_sale_value: {
    label: 'Order book',
    table: 'receivable_records',
    amount: 't.contractual_amount',
    category: 't.category',
    description: RECEIVABLE_DESCRIPTION,
    // Reservation and transfer fees are consideration for something other than
    // the unit and are not part of the price revenue is recognised against.
    where: "t.category IN ('contract', 'down_payment')",
    also: [{ ...INCOME_SHEET, amount: 't.contractual_amount' }],
  },
  period_income: {
    label: 'Income raised this month',
    table: 'income_records',
    amount: 't.contractual_amount',
    category: 't.category',
    description: INCOME_DESCRIPTION,
    // The month the snapshot is for, taken from the record's own report date
    // so the predicate needs nothing the scope does not carry.
    where: "t.month = substr(t.report_date, 1, 7) AND t.is_forecast = 0",
  },
  period_collected: {
    label: 'Collected this month',
    table: 'income_records',
    amount: 't.received_amount',
    category: 't.category',
    description: INCOME_DESCRIPTION,
    where: "t.month = substr(t.report_date, 1, 7) AND t.is_forecast = 0",
  },
  period_expense: {
    label: 'Spend this month',
    table: 'expense_records',
    amount: 't.amount',
    category: 't.category',
    description: EXPENSE_DESCRIPTION,
    where: "t.month = substr(t.report_date, 1, 7) AND t.is_forecast = 0",
  },
  operating_expenses: {
    label: 'Operating expenses',
    table: 'expense_records',
    amount: 't.amount',
    category: 't.category',
    description: EXPENSE_DESCRIPTION,
    // Everything that is neither a direct cost nor tax: tax is taken once,
    // below operating profit, and must not appear on this line as well.
    where: "t.category NOT IN ('construction', 'contractor', 'material', 'tax')",
  },
  taxes: {
    label: 'Tax charged',
    table: 'expense_records',
    amount: 't.amount',
    category: 't.category',
    description: EXPENSE_DESCRIPTION,
    where: "t.category = 'tax'",
  },
  total_outstanding_expense: {
    label: 'Owed and due',
    table: 'boq_records',
    amount: 't.boq_to_date - t.paid_amount',
    category: BOQ_CATEGORY,
    description: BOQ_DESCRIPTION,
    also: [
      { table: 'bank_balances', amount: 't.pending_expense', category: "'Pending'",
        description: "COALESCE(t.bank_name, t.account_no, '—')" },
      EXPENSE_PENDING,
    ],
  },
  payable_invoiced: {
    label: 'Vendor invoices',
    table: 'payable_records',
    amount: 't.invoice_amount',
    category: "COALESCE(t.category, 'Payable')",
    description: PAYABLE_DESCRIPTION,
  },
  payable_paid: {
    label: 'Vendor invoices paid',
    table: 'payable_records',
    amount: 't.paid_amount',
    category: "COALESCE(t.category, 'Payable')",
    description: PAYABLE_DESCRIPTION,
  },
  accounts_payable: {
    label: 'Owed to vendors',
    table: 'payable_records',
    amount: PAYABLE_OUTSTANDING,
    category: "COALESCE(t.category, 'Payable')",
    description: PAYABLE_DESCRIPTION,
  },
  total_owed: {
    label: 'Everything owed',
    table: 'payable_records',
    amount: PAYABLE_OUTSTANDING,
    category: "COALESCE(t.category, 'Vendor')",
    description: PAYABLE_DESCRIPTION,
    also: [
      { table: 'boq_records', amount: 't.boq_to_date - t.paid_amount',
        category: BOQ_CATEGORY, description: BOQ_DESCRIPTION },
      { table: 'bank_balances', amount: 't.pending_expense', category: "'Pending'",
        description: "COALESCE(t.bank_name, t.account_no, '—')" },
      EXPENSE_PENDING,
    ],
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

/**
 * Ageing buckets, as a drill-down.
 *
 * The bucket a row falls in depends on the snapshot's report date, which the
 * scope does not carry — so the predicate is written against the report date
 * stored on the record itself. Every fact row has one.
 */
/** Payable ageing, on the same boundaries as the receivable side. */
const PAYABLE_AGEING: Record<string, { label: string; where: string }> = {
  payable_aged_current: {
    label: 'Not yet due',
    where: "t.due_date IS NOT NULL AND julianday(t.due_date) >= julianday(t.report_date)",
  },
  payable_aged_1_30: {
    label: '1–30 days overdue',
    where: "t.due_date IS NOT NULL AND julianday(t.report_date) - julianday(t.due_date) BETWEEN 1 AND 30",
  },
  payable_aged_31_60: {
    label: '31–60 days overdue',
    where: "t.due_date IS NOT NULL AND julianday(t.report_date) - julianday(t.due_date) BETWEEN 31 AND 60",
  },
  payable_aged_61_90: {
    label: '61–90 days overdue',
    where: "t.due_date IS NOT NULL AND julianday(t.report_date) - julianday(t.due_date) BETWEEN 61 AND 90",
  },
  payable_aged_91_120: {
    label: '91–120 days overdue',
    where: "t.due_date IS NOT NULL AND julianday(t.report_date) - julianday(t.due_date) BETWEEN 91 AND 120",
  },
  payable_aged_120_plus: {
    label: 'More than 120 days overdue',
    where: "t.due_date IS NOT NULL AND julianday(t.report_date) - julianday(t.due_date) > 120",
  },
  payable_overdue: {
    label: 'Overdue payable',
    where: "t.due_date IS NOT NULL AND julianday(t.report_date) > julianday(t.due_date)",
  },
  payable_undated: {
    label: 'Owed with no due date',
    where: 't.due_date IS NULL',
  },
};

const AGEING_METRICS: Record<string, { label: string; where: string }> = {
  receivable_aged_current: {
    label: 'Not yet due',
    where: "t.due_date IS NOT NULL AND julianday(t.due_date) >= julianday(t.report_date)",
  },
  receivable_aged_1_30: {
    label: '1–30 days overdue',
    where: "t.due_date IS NOT NULL AND julianday(t.report_date) - julianday(t.due_date) BETWEEN 1 AND 30",
  },
  receivable_aged_31_60: {
    label: '31–60 days overdue',
    where: "t.due_date IS NOT NULL AND julianday(t.report_date) - julianday(t.due_date) BETWEEN 31 AND 60",
  },
  receivable_aged_61_90: {
    label: '61–90 days overdue',
    where: "t.due_date IS NOT NULL AND julianday(t.report_date) - julianday(t.due_date) BETWEEN 61 AND 90",
  },
  receivable_aged_91_120: {
    label: '91–120 days overdue',
    where: "t.due_date IS NOT NULL AND julianday(t.report_date) - julianday(t.due_date) BETWEEN 91 AND 120",
  },
  receivable_aged_120_plus: {
    label: 'More than 120 days overdue',
    where: "t.due_date IS NOT NULL AND julianday(t.report_date) - julianday(t.due_date) > 120",
  },
  receivable_overdue: {
    label: 'Overdue receivable',
    where: "t.due_date IS NOT NULL AND julianday(t.report_date) > julianday(t.due_date)",
  },
  receivable_undated: {
    label: 'Owed with no due date',
    where: 't.due_date IS NULL',
  },
};

function sourceFor(metricKey: string): DrilldownSource | null {
  const payableAged = PAYABLE_AGEING[metricKey];
  if (payableAged) {
    return {
      label: payableAged.label,
      table: 'payable_records',
      amount: PAYABLE_OUTSTANDING,
      category: "COALESCE(t.due_date, 'no due date')",
      description: PAYABLE_DESCRIPTION,
      where: `${payableAged.where} AND ${PAYABLE_OUTSTANDING} > 0`,
    };
  }

  const aged = AGEING_METRICS[metricKey];
  if (aged) {
    return {
      label: aged.label,
      table: 'receivable_records',
      amount: RECEIVABLE_OUTSTANDING,
      category: "COALESCE(t.due_date, 'no due date')",
      description: RECEIVABLE_DESCRIPTION,
      // Only what is still owed ages. A row collected in full is not a
      // receivable, and a negative balance is an overpayment.
      where: `${aged.where} AND ${RECEIVABLE_OUTSTANDING} > 0`,
    };
  }

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

  // Every record set this figure is made of, in order.
  const parts = [source, ...(source.also ?? [])];

  /** The scoped predicate for one record set, with its parameters. */
  const clauseFor = (part: { amount: string; where?: string; params?: (string | number)[] }) => {
    const scoped = scopeClause(scope, 't');
    const predicates = [scoped.where];
    const params: (string | number)[] = [...scoped.params];

    if (part.where) {
      predicates.push(part.where);
      params.push(...(part.params ?? []));
    }

    return {
      where: `${predicates.join(' AND ')}
         AND ${part.amount} IS NOT NULL
         AND ${part.amount} <> 0`,
      params,
    };
  };

  // The true footing, computed over every contributing record in every part.
  // Read before the rows so the limit below cannot change it.
  let totalValue = 0;
  let recordCount = 0;
  for (const part of parts) {
    const clause = clauseFor(part);
    const totals = getDb()
      .prepare<(string | number)[], { n: number; total: number | null }>(
        `SELECT COUNT(*) AS n, SUM(${part.amount}) AS total FROM ${part.table} t WHERE ${clause.where}`,
      )
      .get(...clause.params) ?? { n: 0, total: 0 };
    totalValue += totals.total ?? 0;
    recordCount += totals.n;
  }
  const totals = { n: recordCount, total: round2(totalValue) };

  // Tables and expressions come from the constant map above, never from input.
  const params: (string | number)[] = [];
  const selects = parts.map((part) => {
    const clause = clauseFor(part);
    params.push(...clause.params);
    return `
    SELECT p.name              AS project_name,
           ${part.category}    AS category,
           ${part.description} AS description,
           ${part.amount}      AS amount,
           sr.source_file, sr.source_sheet, sr.source_row, sr.source_cell,
           sr.source_formula, sr.created_at AS imported_at
      FROM ${part.table} t
      LEFT JOIN projects p           ON p.id = t.project_id
      LEFT JOIN source_references sr ON sr.id = t.source_ref_id
     WHERE ${clause.where}`;
  });

  // Wrapped in a subquery: SQLite will not order a compound SELECT by an
  // expression, only by a bare output column or an ordinal.
  const sql = `
    SELECT * FROM (${selects.join('\n     UNION ALL\n')}
    )
     ORDER BY ABS(amount) DESC
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
