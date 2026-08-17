import { monthKey } from '@/lib/excel/cells';
import type { CashflowRecord, NormalizedDataset } from '@/lib/types';
import { dedupe, round2 } from './aggregate';

/**
 * Cash-flow forecast engine (requirement 9).
 *
 * The running balance is ALWAYS recomputed here — a closing figure read from
 * the sheet is kept only so reconciliation can compare the two.
 *
 *   Month 1: closing = opening bank balance + net cash flow
 *   Month n: closing = previous closing + net cash flow
 */

export interface CashflowMonth {
  month: string;
  openingCash: number;
  expectedIncome: number;
  expectedExpense: number;
  netCashFlow: number;
  closingCash: number;
  /** Closing balance as stated in the source, when the sheet had one. */
  statedClosing: number | null;
  status: 'healthy' | 'tight' | 'shortfall';
  refIndexes: number[];
}

export interface CashflowProjection {
  months: CashflowMonth[];
  openingCash: number;
  /** Closing cash of the final forecast month. */
  forecastCash: number;
  lowestCash: number;
  lowestMonth: string | null;
  /** Absolute size of the deepest negative balance; 0 when never negative. */
  requiredFunding: number;
  hasShortfall: boolean;
}

/** Below this the month is flagged as tight but not yet a shortfall. */
const TIGHT_THRESHOLD = 1_000_000;

/**
 * Builds the month-by-month projection.
 *
 * Forecast inputs come from cash-flow sheets when present. Otherwise they are
 * derived from future-dated income, expense and BOQ rows, so a client with no
 * dedicated forecast tab still gets a projection.
 */
export function projectCashflow(
  data: NormalizedDataset,
  openingCash: number,
  reportDate: string,
): CashflowProjection {
  const buckets = collectMonthlyInputs(data, reportDate);
  const months = [...buckets.keys()].sort();

  const rows: CashflowMonth[] = [];
  let running = round2(openingCash);

  for (const month of months) {
    const bucket = buckets.get(month)!;
    const opening = running;
    const net = round2(bucket.income - bucket.expense);
    const closing = round2(opening + net);

    rows.push({
      month,
      openingCash: opening,
      expectedIncome: round2(bucket.income),
      expectedExpense: round2(bucket.expense),
      netCashFlow: net,
      closingCash: closing,
      statedClosing: bucket.statedClosing,
      status: closing < 0 ? 'shortfall' : closing < TIGHT_THRESHOLD ? 'tight' : 'healthy',
      refIndexes: dedupe(bucket.refIndexes),
    });

    running = closing;
  }

  const lowest = rows.reduce<CashflowMonth | null>(
    (min, row) => (min === null || row.closingCash < min.closingCash ? row : min),
    null,
  );

  return {
    months: rows,
    openingCash: round2(openingCash),
    forecastCash: rows.length > 0 ? rows[rows.length - 1].closingCash : round2(openingCash),
    lowestCash: lowest ? lowest.closingCash : round2(openingCash),
    lowestMonth: lowest?.month ?? null,
    requiredFunding: lowest && lowest.closingCash < 0 ? round2(Math.abs(lowest.closingCash)) : 0,
    hasShortfall: !!lowest && lowest.closingCash < 0,
  };
}

interface MonthBucket {
  income: number;
  expense: number;
  statedClosing: number | null;
  refIndexes: number[];
}

function collectMonthlyInputs(data: NormalizedDataset, reportDate: string): Map<string, MonthBucket> {
  const buckets = new Map<string, MonthBucket>();
  const currentMonth = monthKey(reportDate);

  const bucketFor = (month: string): MonthBucket => {
    let bucket = buckets.get(month);
    if (!bucket) {
      bucket = { income: 0, expense: 0, statedClosing: null, refIndexes: [] };
      buckets.set(month, bucket);
    }
    return bucket;
  };

  // A dedicated forecast sheet is authoritative for the months it covers.
  if (data.cashflow.length > 0) {
    for (const row of data.cashflow) {
      const bucket = bucketFor(row.month);
      bucket.income += row.expectedIncome;
      bucket.expense += row.expectedExpense;
      if (row.closingBalance !== null) bucket.statedClosing = row.closingBalance;
      if (row.sourceRefIndex !== undefined) bucket.refIndexes.push(row.sourceRefIndex);
    }
    return buckets;
  }

  // Otherwise derive the forecast from forward-dated operational records.
  for (const row of data.income) {
    if (!row.month || row.month <= currentMonth) continue;
    const bucket = bucketFor(row.month);
    bucket.income += row.contractualAmount - row.receivedAmount;
    if (row.sourceRefIndex !== undefined) bucket.refIndexes.push(row.sourceRefIndex);
  }

  for (const row of data.expense) {
    if (!row.month || row.month <= currentMonth) continue;
    const bucket = bucketFor(row.month);
    bucket.expense += row.amount;
    if (row.sourceRefIndex !== undefined) bucket.refIndexes.push(row.sourceRefIndex);
  }

  // Unpaid BOQ scheduled in future months is a committed cash outflow.
  for (const row of data.boq) {
    if (!row.month || row.month <= currentMonth) continue;
    const outstanding = row.boqToDate - row.paidAmount;
    if (outstanding <= 0) continue;
    const bucket = bucketFor(row.month);
    bucket.expense += outstanding;
    if (row.sourceRefIndex !== undefined) bucket.refIndexes.push(row.sourceRefIndex);
  }

  return buckets;
}

/** Total inflow across the projection — used by the future-income KPI. */
export function totalForecastIncome(projection: CashflowProjection): number {
  return round2(projection.months.reduce((sum, m) => sum + m.expectedIncome, 0));
}

export function totalForecastExpense(projection: CashflowProjection): number {
  return round2(projection.months.reduce((sum, m) => sum + m.expectedExpense, 0));
}

/** Refs behind every month, for drilling into a forecast figure. */
export function projectionRefIndexes(projection: CashflowProjection): number[] {
  return dedupe(projection.months.flatMap((m) => m.refIndexes));
}

export type { CashflowRecord };
