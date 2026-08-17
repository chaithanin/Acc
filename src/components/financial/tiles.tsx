'use client';

import { sentimentOf } from '@/lib/compare';
import { formatByUnit, formatPercent } from '@/lib/format/number';
import type { MetricComparison } from '@/lib/types';
import { cx } from '../ui/primitives';

/**
 * Compact KPI tile for the financial dashboard.
 *
 * The tile leads with the value, then the movement against the previous
 * period. Movement colour follows the metric's own direction — a falling
 * expense is good, a falling income is not — via `sentimentOf`.
 */
export function KpiTile({
  metric,
  title,
  onOpen,
}: {
  metric: MetricComparison;
  /** Overrides the engine's label where the dashboard uses a shorter name. */
  title?: string;
  onOpen?: () => void;
}) {
  const sentiment = sentimentOf(metric.key, metric.difference);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        'group flex w-full flex-col rounded-xl border border-border bg-surface px-4 py-3.5 text-left',
        'transition-colors hover:bg-surface-hover',
      )}
    >
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
        {title ?? metric.label}
      </span>

      <span className="mt-1.5 text-2xl font-semibold tracking-tight text-ink">
        {formatByUnit(metric.current, metric.unit)}
      </span>

      <span className="mt-1.5 flex items-baseline gap-1.5 text-xs">
        <span
          className={cx(
            'font-medium',
            sentiment === 'positive' && 'text-delta-up',
            sentiment === 'negative' && 'text-delta-down',
            sentiment === 'neutral' && 'text-ink-muted',
          )}
        >
          {/* Arrow as well as colour, so direction never rests on hue alone. */}
          {metric.differencePct === null
            ? '—'
            : `${metric.differencePct > 0 ? '▲' : metric.differencePct < 0 ? '▼' : '■'} ${formatPercent(metric.differencePct, 1)}`}
        </span>
        <span className="text-ink-muted">vs previous period</span>
      </span>
    </button>
  );
}

/**
 * Ratio tile: the figure plus the target it is measured against, which is what
 * makes a bare ratio meaningful to a reader.
 */
export function RatioTile({
  metric,
  target,
  targetLabel,
  onOpen,
}: {
  metric: MetricComparison;
  target: number;
  targetLabel: string;
  onOpen?: () => void;
}) {
  const meets = metric.current !== null && metric.current >= target;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col items-center rounded-xl border border-border bg-surface px-4 py-3.5 text-center transition-colors hover:bg-surface-hover"
    >
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
        {metric.label}
      </span>

      <span
        className={cx(
          'mt-1.5 text-2xl font-semibold tracking-tight',
          metric.current === null ? 'text-ink-muted' : meets ? 'text-income' : 'text-expense',
        )}
      >
        {formatByUnit(metric.current, metric.unit)}
      </span>

      <span className="mt-1 text-xs font-medium text-ink-secondary">
        {target} or higher
      </span>
      <span className="text-[11px] text-ink-muted">{targetLabel}</span>
    </button>
  );
}

/**
 * The central progress dial — a value against a target.
 *
 * Drawn as SVG rather than a chart library: it is one number, and a pie
 * component would bring an axis, legend and tooltip machinery it has no use for.
 */
export function ProgressDial({
  value,
  target,
  label,
  caption,
  tone = 'income',
  size = 200,
}: {
  /** Percentage 0–100+, or null when not calculable. */
  value: number | null;
  target?: number;
  label: string;
  caption?: string;
  tone?: 'income' | 'expense';
  size?: number;
}) {
  const stroke = Math.max(12, Math.round(size * 0.075));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // Over-100% still fills the ring rather than wrapping past the start.
  const fraction = value === null ? 0 : Math.max(0, Math.min(1, value / 100));

  return (
    <figure className="flex flex-col items-center">
      <figcaption className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-ink-secondary">
        {label}
      </figcaption>

      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} role="img" aria-label={`${label}: ${value ?? 'not calculable'}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--dial-track)"
            strokeWidth={stroke}
          />
          {value !== null ? (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={tone === 'income' ? 'var(--income)' : 'var(--expense)'}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${circumference * fraction} ${circumference}`}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          ) : null}
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-semibold tracking-tight text-ink">
            {value === null ? 'N/A' : `${value.toFixed(1)}%`}
          </span>
          {target !== undefined ? (
            <span className="mt-0.5 text-[11px] text-ink-muted">Target: {target.toFixed(1)}%</span>
          ) : null}
        </div>
      </div>

      {caption ? (
        <p className="mt-2 whitespace-pre-line text-center text-[11px] leading-relaxed text-ink-muted">
          {caption}
        </p>
      ) : null}
    </figure>
  );
}
