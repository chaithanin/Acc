import { POLICY } from '@/config/accounting-policy';
import type { ReceivableRecord } from '@/lib/types';
import { round2 } from './aggregate';

/**
 * Receivables ageing.
 *
 * Every receivable row has carried a due date since the first import and
 * nothing read it, so the dashboard could say how much was owed but not how
 * much was late — which is the only version of the question a credit
 * controller can act on.
 *
 * Ageing is measured against the report date, not today. A dashboard opened in
 * November showing August's snapshot must age that snapshot as it stood in
 * August, or the same import shows a different overdue balance every morning.
 */

export interface AgeingBucket {
  label: string;
  /** Days past due this bucket covers. */
  from: number;
  to: number | null;
  amount: number;
  count: number;
  refIndexes: number[];
}

export interface AgeingResult {
  buckets: AgeingBucket[];
  /** Everything outstanding, whether or not it has a due date. */
  total: number;
  /** Outstanding past its due date on the report date. */
  overdue: number;
  /** Outstanding with no due date in the file — aged nowhere, reported here. */
  undated: number;
  undatedCount: number;
  /** The oldest overdue item, in days. Null when nothing is overdue. */
  oldestDays: number | null;
}

const DAY = 86_400_000;

/** Whole days between two dates, positive when the first is earlier. */
function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY);
}

export function ageReceivables(rows: ReceivableRecord[], reportDate: string): AgeingResult {
  const buckets: AgeingBucket[] = POLICY.ageingBuckets.map((b) => ({
    label: b.label,
    from: b.from,
    to: b.to,
    amount: 0,
    count: 0,
    refIndexes: [],
  }));

  let total = 0;
  let overdue = 0;
  let undated = 0;
  let undatedCount = 0;
  let oldestDays: number | null = null;

  for (const row of rows) {
    // What is still owed on this row. A row collected in full is not a
    // receivable and does not age; a negative balance is an overpayment and
    // belongs on neither side of an ageing report.
    const outstanding = round2(row.contractualAmount - row.receiveAmount);
    if (outstanding <= 0) continue;

    total += outstanding;

    if (!row.dueDate) {
      undated += outstanding;
      undatedCount += 1;
      continue;
    }

    const daysPastDue = daysBetween(row.dueDate, reportDate);
    if (daysPastDue === null) {
      undated += outstanding;
      undatedCount += 1;
      continue;
    }

    if (daysPastDue > 0) {
      overdue += outstanding;
      oldestDays = oldestDays === null ? daysPastDue : Math.max(oldestDays, daysPastDue);
    }

    const bucket = buckets.find(
      (b) => daysPastDue >= b.from && (b.to === null || daysPastDue <= b.to),
    );
    if (!bucket) continue;

    bucket.amount = round2(bucket.amount + outstanding);
    bucket.count += 1;
    if (row.sourceRefIndex !== undefined && row.sourceRefIndex >= 0) {
      bucket.refIndexes.push(row.sourceRefIndex);
    }
  }

  return {
    buckets,
    total: round2(total),
    overdue: round2(overdue),
    undated: round2(undated),
    undatedCount,
    oldestDays,
  };
}

/**
 * The identity an ageing report has to satisfy.
 *
 * Every bucket plus everything that could not be aged must equal the total
 * outstanding. A bucket set that does not foot to the receivable balance is
 * worse than no ageing at all.
 */
export function ageingFoots(result: AgeingResult, tolerance = POLICY.roundingTolerance): boolean {
  const summed = result.buckets.reduce((sum, b) => sum + b.amount, 0) + result.undated;
  return Math.abs(round2(summed) - result.total) <= tolerance;
}

/** A key safe to put in a metric name: "1–30" becomes "1_30". */
export function bucketKey(label: string): string {
  return label.toLowerCase().replace(/[–—-]/g, '_').replace(/\+/g, '_plus').replace(/[^a-z0-9_]/g, '');
}
