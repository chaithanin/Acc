/**
 * The two derived quantities the report is really about.
 *
 * A buyer pays instalments over several years and takes the unit at
 * completion. The accounting treats those instalments as an advance: the
 * difference between what they will have paid and what the unit is expected to
 * sell for is a financing cost, recognised over the life of the plan.
 *
 * This module supplies the uplift that gives the expected selling price, and
 * the effective interest rate that discounts the instalments back to it. The
 * template arrives at the rate with Excel's Goal Seek, which is not something a
 * generated file can carry; it is solved for here and written as a value, which
 * is exactly what the template holds too.
 */

/** Months from `month` to `completion` inclusive; 0 once completion has passed. */
export function monthsToCompletion(month: string, completionMonth: string): number {
  const [my, mm] = month.split('-').map(Number);
  const [cy, cm] = completionMonth.split('-').map(Number);
  return Math.max(0, (cy - my) * 12 + (cm - mm) + 1);
}

/**
 * The selling-price uplift table.
 *
 * Straight-line in months remaining: a unit bought at the very start of the
 * schedule carries the full uplift, one bought the month before completion
 * carries almost none. The anchor is the first month of the report, so the
 * table is a property of the schedule rather than a list of hard-coded rates.
 */
export function upliftTable(
  months: string[],
  completionMonth: string,
  maxUplift: number,
): Map<string, number> {
  const table = new Map<string, number>();
  if (months.length === 0) return table;

  const anchor = monthsToCompletion(months[0], completionMonth);
  for (const month of months) {
    const remaining = monthsToCompletion(month, completionMonth);
    table.set(month, anchor === 0 ? 0 : (remaining / anchor) * maxUplift);
  }

  return table;
}

/** Days from the first of `month` to `completionDate`, inclusive of both. */
export function daysToCompletion(month: string, completionDate: string): number {
  const start = Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
  const end = Date.UTC(
    Number(completionDate.slice(0, 4)),
    Number(completionDate.slice(5, 7)) - 1,
    Number(completionDate.slice(8, 10)),
  );
  return Math.round((end - start) / 86_400_000) + 1;
}

/**
 * Future value of an instalment plan at completion, at an annual rate `r`
 * compounded daily — the same arithmetic as the template's
 * `=H6*(1+$G123)^H$121`.
 */
export function futureValue(
  plan: Map<string, number>,
  completionDate: string,
  annualRate: number,
  onKey = 0,
): number {
  const daily = annualRate / 365;
  // The handover instalment is paid at completion, so it accrues nothing and
  // enters at face value. Leaving it out was worth an interest rate of 80% a
  // year: the monthly instalments alone were being asked to grow into a price
  // that half of them had not been counted towards.
  let total = onKey;

  for (const [month, amount] of plan) {
    if (amount === 0) continue;
    total += amount * (1 + daily) ** daysToCompletion(month, completionDate);
  }

  return total;
}

export interface EirResult {
  rate: number;
  /** True when a rate satisfying the target was actually found. */
  solved: boolean;
  reason?: string;
}

/**
 * The rate at which the instalments grow into the expected selling price.
 *
 * Bisection rather than Newton: the function is monotonic in the rate over the
 * whole plausible range, bisection cannot diverge, and 200 iterations reach
 * far below the precision anybody reads off this report.
 */
export function solveEir(
  plan: Map<string, number>,
  completionDate: string,
  target: number,
  onKey = 0,
): EirResult {
  const principal = [...plan.values()].reduce((sum, v) => sum + v, onKey);

  if (principal <= 0) {
    return { rate: 0, solved: false, reason: 'The instalment plan is empty.' };
  }
  if (target <= 0) {
    return { rate: 0, solved: false, reason: 'The expected selling price is zero.' };
  }
  // Undiscounted, the instalments already exceed the target: no positive rate
  // brings them back down, and a negative one is not what this models.
  if (futureValue(plan, completionDate, 0, onKey) >= target) {
    return {
      rate: 0,
      solved: false,
      reason:
        'The instalments already total more than the expected selling price, so no positive interest rate fits.',
    };
  }

  const MAX_RATE = 2; // 200% a year is far past anything real; it is a bound, not a guess.
  if (futureValue(plan, completionDate, MAX_RATE, onKey) < target) {
    return {
      rate: MAX_RATE,
      solved: false,
      reason: 'No rate below 200% grows these instalments into the expected selling price.',
    };
  }

  let low = 0;
  let high = MAX_RATE;

  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    if (futureValue(plan, completionDate, mid, onKey) < target) low = mid;
    else high = mid;
  }

  return { rate: (low + high) / 2, solved: true };
}
