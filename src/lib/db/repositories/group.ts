import { round2 } from '@/lib/calc/aggregate';
import { consolidate, isReconciled, type CompanyFigures, type GroupTotals } from '@/lib/consolidate';
import { getDb } from '../index';
import { companiesForUser } from './companies';
import { getCurrentSnapshot } from './snapshots';

/**
 * The group's figures.
 *
 * Built by reading each company the user is granted, one at a time, with the
 * same scoped queries every other page uses, and adding the results up. No
 * query crosses a company boundary. A user granted three of six companies sees
 * the total of three, because the loop runs over their grants and nothing
 * else — that is the safety argument, and it is why this is arithmetic over
 * existing reads rather than a new kind of query.
 */

/** Metrics whose intercompany portion is removed before the total is shown. */
const ELIMINATED = [
  { metricKey: 'total_receivable_outstanding', table: 'receivable_records', amount: 't.contractual_amount - t.receive_amount' },
  { metricKey: 'accounts_payable', table: 'payable_records', amount: 't.invoice_amount - t.paid_amount' },
  { metricKey: 'total_contractual_income', table: 'receivable_records', amount: 't.contractual_amount' },
  { metricKey: 'contracted_sale_value', table: 'receivable_records', amount: 't.contractual_amount', where: "t.category IN ('contract', 'down_payment')" },
  { metricKey: 'total_expense', table: 'expense_records', amount: 't.amount' },
  { metricKey: 'period_income', table: 'income_records', amount: 't.contractual_amount', where: "t.month = substr(t.report_date, 1, 7) AND t.is_forecast = 0" },
  { metricKey: 'period_expense', table: 'expense_records', amount: 't.amount', where: "t.month = substr(t.report_date, 1, 7) AND t.is_forecast = 0" },
] as const;

export interface GroupView extends GroupTotals {
  /** Companies the user holds a grant for but which have imported nothing. */
  withoutData: { companyId: string; displayName: string }[];
  /** The newest report date across the companies, and the oldest. */
  newestReportDate: string | null;
  oldestReportDate: string | null;
}

/**
 * Every company this user may open, with its live snapshot's figures.
 *
 * A company with no import contributes nothing and is listed separately: a
 * group total that silently omits a subsidiary is worse than one that says
 * which subsidiary is missing.
 */
export function groupFigures(userId: string): GroupView {
  const db = getDb();
  const companies = companiesForUser(userId);

  const figures: CompanyFigures[] = [];
  const withoutData: { companyId: string; displayName: string }[] = [];
  const snapshotIds: { companyId: string; snapshotId: string }[] = [];

  for (const company of companies) {
    const snapshot = getCurrentSnapshot(company.id);
    if (!snapshot) {
      withoutData.push({ companyId: company.id, displayName: company.displayName });
      continue;
    }

    const rows = db
      .prepare<[string, string], { metric_key: string; value: number | null }>(
        `SELECT metric_key, value FROM calculated_metrics
          WHERE snapshot_id = ? AND company_id = ? AND project_id IS NULL`,
      )
      .all(snapshot.id, company.id);

    figures.push({
      companyId: company.id,
      companyCode: company.companyCode,
      displayName: company.displayName,
      reportDate: snapshot.reportDate,
      values: new Map(rows.map((r) => [r.metric_key, r.value])),
    });
    snapshotIds.push({ companyId: company.id, snapshotId: snapshot.id });
  }

  const insideGroup = new Set(companies.map((c) => c.id));
  const intercompany = intercompanyTotals(snapshotIds, insideGroup);
  const totals = consolidate(figures, intercompany);
  totals.mismatches = intercompanyMismatches(snapshotIds, insideGroup);

  const dates = figures.map((f) => f.reportDate).filter((d): d is string => !!d).sort();

  return {
    ...totals,
    withoutData,
    newestReportDate: dates[dates.length - 1] ?? null,
    oldestReportDate: dates[0] ?? null,
  };
}

/**
 * How much of each total is trade with another company inside the group.
 *
 * Only counterparties that are themselves in the consolidation count: a
 * balance with a company the reader has no grant for is, from where they are
 * standing, trade with the outside world, and eliminating it would take money
 * out of a total that never had the other side in it.
 */
function intercompanyTotals(
  snapshots: { companyId: string; snapshotId: string }[],
  insideGroup: Set<string>,
): Map<string, number> {
  const db = getDb();
  const totals = new Map<string, number>();
  if (snapshots.length === 0 || insideGroup.size === 0) return totals;

  const placeholders = [...insideGroup].map(() => '?').join(', ');

  for (const rule of ELIMINATED) {
    let total = 0;

    for (const { companyId, snapshotId } of snapshots) {
      const where = [
        't.snapshot_id = ?',
        't.company_id = ?',
        't.counterparty_company_id IS NOT NULL',
        `t.counterparty_company_id IN (${placeholders})`,
        ...(('where' in rule && rule.where) ? [rule.where] : []),
      ].join(' AND ');

      const row = db
        .prepare<unknown[], { total: number | null }>(
          `SELECT SUM(${rule.amount}) AS total FROM ${rule.table} t WHERE ${where}`,
        )
        .get(snapshotId, companyId, ...insideGroup);

      total += row?.total ?? 0;
    }

    if (total !== 0) {
      totals.set(rule.metricKey, round2((totals.get(rule.metricKey) ?? 0) + total));
    }
  }

  return totals;
}

/**
 * Where one company's receivable from another does not match that other's
 * payable back.
 *
 * The two sides of an intercompany balance are recorded independently, in
 * different books, often by different people. When they disagree the group has
 * a real problem, and netting the difference away silently is how it stays
 * hidden for a year. Reported instead.
 */
function intercompanyMismatches(
  snapshots: { companyId: string; snapshotId: string }[],
  insideGroup: Set<string>,
): GroupTotals['mismatches'] {
  const db = getDb();
  const names = new Map(
    db
      .prepare<[], { id: string; display_name: string }>('SELECT id, display_name FROM companies')
      .all()
      .map((c) => [c.id, c.display_name]),
  );

  const receivable = new Map<string, number>();
  const payable = new Map<string, number>();
  const pairKey = (from: string, to: string) => `${from}→${to}`;

  for (const { companyId, snapshotId } of snapshots) {
    for (const row of db
      .prepare<[string, string], { counterparty_company_id: string; total: number }>(
        `SELECT counterparty_company_id, SUM(contractual_amount - receive_amount) AS total
           FROM receivable_records
          WHERE snapshot_id = ? AND company_id = ? AND counterparty_company_id IS NOT NULL
          GROUP BY counterparty_company_id`,
      )
      .all(snapshotId, companyId)) {
      if (!insideGroup.has(row.counterparty_company_id)) continue;
      receivable.set(pairKey(companyId, row.counterparty_company_id), round2(row.total));
    }

    for (const row of db
      .prepare<[string, string], { counterparty_company_id: string; total: number }>(
        `SELECT counterparty_company_id, SUM(invoice_amount - paid_amount) AS total
           FROM payable_records
          WHERE snapshot_id = ? AND company_id = ? AND counterparty_company_id IS NOT NULL
          GROUP BY counterparty_company_id`,
      )
      .all(snapshotId, companyId)) {
      if (!insideGroup.has(row.counterparty_company_id)) continue;
      // A payable owed by this company to that one is that one's receivable
      // from this one, so the pair is keyed the other way round.
      payable.set(pairKey(row.counterparty_company_id, companyId), round2(row.total));
    }
  }

  const out: GroupTotals['mismatches'] = [];
  for (const key of new Set([...receivable.keys(), ...payable.keys()])) {
    const [from, to] = key.split('→');
    const r = receivable.get(key) ?? 0;
    const p = payable.get(key) ?? 0;
    const difference = round2(r - p);

    if (isReconciled(difference)) continue;

    out.push({
      fromCompany: names.get(from!) ?? from!,
      toCompany: names.get(to!) ?? to!,
      receivable: r,
      payable: p,
      difference,
    });
  }

  return out.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
}
