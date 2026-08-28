import { POLICY } from '@/config/accounting-policy';
import { round2 } from '@/lib/calc/aggregate';

/**
 * Consolidation.
 *
 * The group total is built as a sum of per-company reads, each one scoped the
 * way every other read in this system is scoped. No query is widened to cross
 * a company boundary: a user who is granted three of six companies gets the
 * total of three, because the loop runs over their grants and nothing else.
 * That is the whole safety argument, and it is why this is arithmetic over
 * existing reads rather than a new kind of query.
 *
 * Two things must never be summed. A ratio is not additive — adding two quick
 * ratios produces a number with no meaning — so ratios and percentages are
 * recomputed at group level from the summed components they are made of. And
 * an intercompany balance appears in two companies' books, correctly in each,
 * so it is eliminated once rather than counted twice.
 */

export interface CompanyFigures {
  companyId: string;
  companyCode: string;
  displayName: string;
  reportDate: string | null;
  /** Metric key → value, for that company's live snapshot. */
  values: Map<string, number | null>;
}

export interface Elimination {
  /** What is being removed. */
  metricKey: string;
  /** Sum across companies before removal. */
  gross: number;
  /** The intercompany amount taken out. */
  amount: number;
  net: number;
}

export interface GroupTotals {
  companies: CompanyFigures[];
  /** Metric key → consolidated value. */
  values: Map<string, number | null>;
  eliminations: Elimination[];
  /**
   * Where one company's receivable from another does not match that other's
   * payable back. An unreconciled intercompany difference is the classic
   * consolidation defect, so it is reported rather than netted away.
   */
  mismatches: {
    fromCompany: string;
    toCompany: string;
    receivable: number;
    payable: number;
    difference: number;
  }[];
}

/**
 * Figures that are ratios or percentages, and how to rebuild each at group
 * level. Anything not named here and carrying a money unit is summed.
 */
const DERIVED: Record<string, (v: (key: string) => number) => number | null> = {
  net_profit_margin: (v) => {
    const revenue = v('recognised_revenue');
    return revenue === 0 ? null : round2((v('net_profit') / revenue) * 100);
  },
  quick_ratio: (v) => {
    const owed = v('total_owed');
    return owed === 0 ? null : round2((v('available_cash') + v('total_receivable_outstanding')) / owed);
  },
  current_ratio: (v) => {
    const owed = v('total_owed');
    return owed === 0
      ? null
      : round2(
          (v('available_cash') + v('total_receivable_outstanding') + v('advance_outstanding') + v('wip_ytd')) / owed,
        );
  },
  completion_percent: (v) => {
    const total = v('boq_total');
    return total === 0 ? null : round2((v('boq_to_date') / total) * 100);
  },
};

/** Keys whose group value is rebuilt rather than summed. */
export const DERIVED_AT_GROUP = new Set(Object.keys(DERIVED));

/**
 * Combines each company's figures into the group's.
 *
 * `intercompany` is the amount to eliminate per metric key, already computed
 * from the counterparty marks.
 */
export function consolidate(
  companies: CompanyFigures[],
  intercompany: Map<string, number>,
): GroupTotals {
  const summed = new Map<string, number>();
  const seen = new Set<string>();

  for (const company of companies) {
    for (const [key, value] of company.values) {
      seen.add(key);
      if (value === null || DERIVED_AT_GROUP.has(key)) continue;
      summed.set(key, round2((summed.get(key) ?? 0) + value));
    }
  }

  const eliminations: Elimination[] = [];
  for (const [key, amount] of intercompany) {
    if (amount === 0) continue;
    const gross = summed.get(key) ?? 0;
    const net = round2(gross - amount);
    summed.set(key, net);
    eliminations.push({ metricKey: key, gross, amount: round2(amount), net });
  }

  // Rebuilt from the eliminated totals, so a ratio reflects the group as
  // consolidated rather than as the sum of six unconsolidated ones.
  const values = new Map<string, number | null>(summed);
  const read = (key: string) => summed.get(key) ?? 0;
  for (const key of seen) {
    const rebuild = DERIVED[key];
    if (rebuild) values.set(key, rebuild(read));
  }

  return { companies, values, eliminations, mismatches: [] };
}

/** A difference this small is rounding between two ledgers, not a break. */
export const isReconciled = (difference: number) =>
  Math.abs(difference) <= POLICY.roundingTolerance;
