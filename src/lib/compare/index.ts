import type { Metric, MetricComparison } from '@/lib/types';
import { round2 } from '@/lib/calc/aggregate';

/**
 * Snapshot comparison (requirement 11).
 *
 *   Difference  = Current − Previous
 *   Difference% = ((Current − Previous) / ABS(Previous)) × 100
 *
 * A zero or missing previous value yields a null percentage, which the UI
 * renders as N/A. Dividing by zero is never attempted.
 */
export function compareMetrics(
  current: Metric[],
  previous: Metric[] | null,
): MetricComparison[] {
  const previousByKey = new Map((previous ?? []).map((m) => [m.key, m]));

  return current.map((metric) => {
    const prior = previousByKey.get(metric.key) ?? null;
    const previousValue = prior?.value ?? null;
    return buildComparison(metric, previousValue);
  });
}

export function buildComparison(metric: Metric, previousValue: number | null): MetricComparison {
  const difference =
    metric.value !== null && previousValue !== null ? round2(metric.value - previousValue) : null;

  return {
    key: metric.key,
    label: metric.label,
    section: metric.section,
    unit: metric.unit,
    current: metric.value,
    previous: previousValue,
    difference,
    differencePct: percentChange(metric.value, previousValue),
    formula: metric.formula,
    inputs: metric.inputs,
  };
}

/** Null when there is no meaningful base to divide by. */
export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  if (previous === 0) return null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  return Number.isFinite(pct) ? Number(pct.toFixed(2)) : null;
}

/**
 * Whether a movement should read as good or bad.
 *
 * Direction is metric-specific: rising cash is good, rising shortfall is not.
 * Keeping this in one table stops each chart inventing its own colour rule.
 */
const LOWER_IS_BETTER = new Set([
  'pending_expense',
  'boq_outstanding',
  'total_outstanding_expense',
  'required_funding',
  'total_expense',
  'other_expense',
  'total_future_expense',
]);

/** Metrics where a change carries no inherent sentiment. */
const NEUTRAL = new Set(['boq_total', 'boq_to_date', 'total_contractual_income', 'wip_ytd']);

export type Sentiment = 'positive' | 'negative' | 'neutral';

export function sentimentOf(key: string, difference: number | null): Sentiment {
  if (difference === null || difference === 0) return 'neutral';
  if (NEUTRAL.has(key)) return 'neutral';
  const better = LOWER_IS_BETTER.has(key) ? difference < 0 : difference > 0;
  return better ? 'positive' : 'negative';
}
