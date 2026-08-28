import { Card, CardHeader } from '@/components/ui/primitives';
import { formatTHB, formatDate } from '@/lib/format/number';
import type { MetricComparison } from '@/lib/types';

/**
 * The ageing report.
 *
 * "How much is owed" and "how much of it is late" are different questions, and
 * only the second one can be acted on. Every receivable row has carried a due
 * date since the first import; this is what reads it.
 *
 * Aged against the report date rather than today, so an August snapshot shows
 * August's overdue balance whenever it is opened.
 */

/** Later buckets are worse. The scale is the severity, not a decoration. */
const TONE: Record<string, { bar: string; text: string }> = {
  receivable_aged_current:   { bar: 'bg-good',     text: 'text-good' },
  receivable_aged_1_30:      { bar: 'bg-good/60',  text: 'text-ink' },
  receivable_aged_31_60:     { bar: 'bg-warning',  text: 'text-warning' },
  receivable_aged_61_90:     { bar: 'bg-warning',  text: 'text-warning' },
  receivable_aged_91_120:    { bar: 'bg-critical/70', text: 'text-critical' },
  receivable_aged_120_plus:  { bar: 'bg-critical', text: 'text-critical' },
};

export function ReceivableAgeing({
  buckets,
  overdue,
  undated,
  oldest,
  outstanding,
  reportDate,
}: {
  buckets: MetricComparison[];
  overdue: MetricComparison | null;
  undated: MetricComparison | null;
  oldest: MetricComparison | null;
  outstanding: number | null;
  reportDate: string;
  snapshotId: string;
  projectId: string | null;
}) {
  if (buckets.length === 0) return null;

  const total = buckets.reduce((sum, b) => sum + (b.current ?? 0), 0) + (undated?.current ?? 0);
  const widest = Math.max(...buckets.map((b) => Math.abs(b.current ?? 0)), 1);

  // The identity that makes the report trustworthy. It is shown rather than
  // assumed: a bucket set that does not foot to the receivable balance is
  // worse than no ageing at all.
  const foots = outstanding === null || Math.abs(total - outstanding) <= 1;

  return (
    <Card className="mt-4">
      <CardHeader
        title="Ageing"
        subtitle={`Measured against ${formatDate(reportDate)}, the date of this snapshot — not against today.`}
        action={
          overdue?.current ? (
            <div className="text-right">
              <div className="text-lg font-semibold tabular-nums text-critical">
                {formatTHB(overdue.current)}
              </div>
              <div className="text-[11px] uppercase tracking-wide text-ink-muted">
                overdue
                {oldest?.current ? `, oldest ${oldest.current} days` : ''}
              </div>
            </div>
          ) : (
            <span className="text-sm text-good">Nothing is overdue</span>
          )
        }
      />

      <div className="space-y-2">
        {buckets.map((bucket) => {
          const value = bucket.current ?? 0;
          const tone = TONE[bucket.key] ?? { bar: 'bg-accent', text: 'text-ink' };
          const share = (Math.abs(value) / widest) * 100;

          return (
            <div key={bucket.key} className="grid grid-cols-[7rem_1fr_9rem] items-center gap-3">
              <span className="text-sm text-ink-secondary">
                {bucket.label.replace('Receivable ', '')}
              </span>
              <div className="h-2.5 overflow-hidden rounded-sm bg-surface-sunken">
                <div
                  className={`h-full rounded-sm ${tone.bar}`}
                  style={{ width: `${Math.max(share, value === 0 ? 0 : 1.5)}%` }}
                />
              </div>
              <span className={`text-right text-sm font-medium tabular-nums ${value === 0 ? 'text-ink-muted' : tone.text}`}>
                {formatTHB(value)}
              </span>
            </div>
          );
        })}
      </div>

      <dl className="mt-4 grid gap-3 border-t border-border pt-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-ink-muted">Buckets total</dt>
          <dd className="tabular-nums text-ink">{formatTHB(total)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-ink-muted">Outstanding</dt>
          <dd className="tabular-nums text-ink">{formatTHB(outstanding)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-ink-muted">Reconciles</dt>
          <dd className={foots ? 'text-good' : 'text-critical'}>
            {foots ? 'Yes — every bucket foots to the balance' : 'No — investigate before using'}
          </dd>
        </div>
      </dl>

      {undated?.current ? (
        <p className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          {formatTHB(undated.current)} is owed on rows whose file carries no due date, so nothing can
          say whether it is late. It is counted in the balance and in no bucket. An amount that
          cannot be aged is an amount nobody is chasing.
        </p>
      ) : null}
    </Card>
  );
}
