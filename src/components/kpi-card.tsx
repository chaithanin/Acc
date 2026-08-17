'use client';

import { useState } from 'react';
import { sentimentOf } from '@/lib/compare';
import { formatCompactTHB, formatDelta, formatNumber, formatPercent, formatTHB } from '@/lib/format/number';
import type { MetricComparison } from '@/lib/types';
import { Button, Modal, Spinner } from './ui/controls';
import { Card, cx } from './ui/primitives';
import { DrilldownTable, type DrilldownResponse } from './drilldown-table';

/**
 * A single KPI (requirement 10).
 *
 * Every card shows current, previous, difference and percentage change, and
 * opens two views on demand: the calculation behind the figure (requirement
 * 27) and the individual source records (requirement 16).
 */

export interface KpiCardProps {
  metric: MetricComparison;
  snapshotId: string;
  projectId: string | null;
  /** Draw attention to the headline figure on a dashboard. */
  emphasis?: boolean;
}

export function KpiCard({ metric, snapshotId, projectId, emphasis }: KpiCardProps) {
  const [showCalculation, setShowCalculation] = useState(false);
  const [drilldown, setDrilldown] = useState<DrilldownResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const sentiment = sentimentOf(metric.key, metric.difference);
  const isCount = metric.unit === 'COUNT';

  const openDrilldown = async () => {
    setLoading(true);
    setDrilldown(null);
    try {
      const params = new URLSearchParams({ snapshotId, metricKey: metric.key });
      if (projectId) params.set('projectId', projectId);
      const response = await fetch(`/api/drilldown?${params}`);
      setDrilldown(await response.json());
    } catch {
      setDrilldown({ supported: false, label: '', rows: [], total: 0, error: 'The details could not be loaded.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Card className="flex flex-col justify-between">
        <div>
          <p className="text-xs font-medium text-ink-secondary">{metric.label}</p>
          <p
            className={cx(
              'mt-2 font-semibold tracking-tight text-ink',
              emphasis ? 'text-3xl' : 'text-2xl',
            )}
          >
            {isCount ? formatNumber(metric.current) : formatCompactTHB(metric.current)}
          </p>

          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-3 text-xs">
            <span className="text-ink-muted">Previous</span>
            <span className="tnum text-right text-ink-secondary">
              {metric.previous === null
                ? '—'
                : isCount
                  ? formatNumber(metric.previous)
                  : formatCompactTHB(metric.previous)}
            </span>

            <span className="text-ink-muted">Difference</span>
            <span
              className={cx(
                'tnum text-right font-medium',
                sentiment === 'positive' && 'text-delta-up',
                sentiment === 'negative' && 'text-delta-down',
                sentiment === 'neutral' && 'text-ink-secondary',
              )}
            >
              {metric.difference === null
                ? '—'
                : isCount
                  ? formatNumber(metric.difference)
                  : formatDelta(metric.difference, 'millions')}
            </span>

            <span className="text-ink-muted">Change</span>
            <span
              className={cx(
                'tnum text-right font-medium',
                sentiment === 'positive' && 'text-delta-up',
                sentiment === 'negative' && 'text-delta-down',
                sentiment === 'neutral' && 'text-ink-secondary',
              )}
            >
              {formatPercent(metric.differencePct)}
            </span>
          </div>
        </div>

        <div className="mt-3 flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setShowCalculation(true)}>
            View calculation
          </Button>
          <Button size="sm" variant="ghost" onClick={openDrilldown}>
            {loading ? <Spinner /> : 'Drill down'}
          </Button>
        </div>
      </Card>

      <Modal
        open={showCalculation}
        onClose={() => setShowCalculation(false)}
        title={metric.label}
        subtitle="How this figure is calculated"
      >
        <CalculationDetail metric={metric} />
      </Modal>

      <Modal
        open={drilldown !== null}
        onClose={() => setDrilldown(null)}
        title={`${metric.label} — source records`}
        subtitle="Every row shows the file, sheet and cell it came from"
        wide
      >
        {drilldown ? <DrilldownTable data={drilldown} /> : null}
      </Modal>
    </>
  );
}

/** The formula, its inputs and the arithmetic, exactly as requirement 27 asks. */
function CalculationDetail({ metric }: { metric: MetricComparison }) {
  const isCount = metric.unit === 'COUNT';
  const fmt = (value: number | null) => (isCount ? formatNumber(value) : formatTHB(value));

  return (
    <div className="space-y-5 text-sm">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Formula</p>
        <p className="mt-1 rounded-md bg-surface-sunken px-3 py-2 font-mono text-[13px] text-ink">
          {metric.formula || '—'}
        </p>
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Calculation</p>
        <table className="mt-1 w-full">
          <tbody>
            {metric.inputs.map((row, index) => (
              <tr key={`${row.label}-${index}`} className="border-b border-border last:border-0">
                <td className="py-1.5 pr-4 text-ink-secondary">{row.label}</td>
                <td className="tnum py-1.5 text-right text-ink">{fmt(row.value)}</td>
              </tr>
            ))}
            <tr>
              <td className="pt-2 font-medium text-ink">Result</td>
              <td className="tnum pt-2 text-right font-semibold text-ink">{fmt(metric.current)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-3 gap-4 border-t border-border pt-4">
        <div>
          <p className="text-xs text-ink-muted">Current</p>
          <p className="tnum mt-0.5 font-medium text-ink">{fmt(metric.current)}</p>
        </div>
        <div>
          <p className="text-xs text-ink-muted">Previous</p>
          <p className="tnum mt-0.5 font-medium text-ink">{fmt(metric.previous)}</p>
        </div>
        <div>
          <p className="text-xs text-ink-muted">Change</p>
          <p className="tnum mt-0.5 font-medium text-ink">
            {metric.difference === null ? '—' : fmt(metric.difference)} ({formatPercent(metric.differencePct)})
          </p>
        </div>
      </div>
    </div>
  );
}

/** Lays KPI cards out on a responsive grid. */
export function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{children}</div>;
}
