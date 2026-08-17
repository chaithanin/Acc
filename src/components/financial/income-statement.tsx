'use client';

import { formatTHB } from '@/lib/format/number';
import { cx } from '../ui/primitives';

/**
 * Income statement summary.
 *
 * Subtotal lines (Gross Profit, Operating Profit, Net Profit) are emphasised;
 * negatives use accounting parentheses; the right column expresses each line as
 * a share of total income, which is how the statement is normally read.
 */

export interface StatementLine {
  label: string;
  value: number | null;
  /** Subtotals get a rule above and heavier type. */
  emphasis?: boolean;
}

export function IncomeStatement({
  lines,
  totalIncome,
}: {
  lines: StatementLine[];
  totalIncome: number | null;
}) {
  const share = (value: number | null) => {
    if (value === null || !totalIncome) return null;
    return (value / totalIncome) * 100;
  };

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border">
          <th className="pb-2 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Line
          </th>
          <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Amount
          </th>
          <th className="w-16 pb-2 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            %
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => {
          const pct = share(line.value);
          const negative = (line.value ?? 0) < 0;

          return (
            <tr
              key={line.label}
              className={cx(line.emphasis && 'border-t border-border-strong')}
            >
              <td
                className={cx(
                  'py-2 pr-4',
                  line.emphasis ? 'font-semibold text-ink' : 'text-ink-secondary',
                )}
              >
                {line.label}
              </td>
              <td
                className={cx(
                  'tnum py-2 text-right',
                  line.emphasis ? 'font-semibold' : '',
                  negative ? 'text-delta-down' : 'text-ink',
                )}
              >
                {formatTHB(line.value)}
              </td>
              <td
                className={cx(
                  'tnum py-2 text-right text-xs',
                  line.emphasis ? 'font-semibold text-ink' : 'text-ink-muted',
                )}
              >
                {pct === null ? '—' : `${pct.toFixed(1)}%`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
