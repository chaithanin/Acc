'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatTHB } from '@/lib/format/number';
import type { MonthPoint } from '@/lib/dashboard/queries';

/**
 * Charts for the financial dashboard.
 *
 * Income is teal, expense is coral, and the cash line is gold — the palette
 * the brief asks for, validated in docs/DESIGN.md. Both bar series sit on one
 * shared baht axis; the net-profit line is drawn in ink rather than a fourth
 * hue, because it is derived from the two bars rather than a peer of them.
 */

const AXIS = { fontSize: 11, fill: 'var(--ink-muted)' } as const;
const LEGEND = { fontSize: 11, color: 'var(--ink-secondary)', paddingTop: 8 } as const;

function axisMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(0)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
}

interface Entry {
  name?: string | number;
  value?: number | string;
  color?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Entry[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 shadow-lg">
      <p className="mb-1 text-xs font-semibold text-ink">{String(label ?? '')}</p>
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center gap-2 text-xs">
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: entry.color }} />
          <span className="text-ink-secondary">{entry.name}</span>
          <span className="tnum ml-auto pl-4 font-medium text-ink">
            {typeof entry.value === 'number' ? formatTHB(entry.value) : String(entry.value ?? '')}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Income and expense bars with the net-profit line over them. */
export function IncomeExpenseComboChart({ data }: { data: MonthPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={axisMoney} width={48} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-hover)' }} />
        <Legend wrapperStyle={LEGEND} iconType="square" iconSize={8} />
        <Bar dataKey="income" name="Total Income" fill="var(--income)" radius={[4, 4, 0, 0]} maxBarSize={22} />
        <Bar dataKey="expense" name="Total Expenses" fill="var(--expense)" radius={[4, 4, 0, 0]} maxBarSize={22} />
        <Line
          type="monotone"
          dataKey="netProfit"
          name="Net Profit"
          stroke="var(--ink)"
          strokeWidth={2}
          dot={{ r: 2.5, strokeWidth: 2, stroke: 'var(--surface)' }}
          activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Closing cash by month. One series, so no legend box — the title names it. */
export function CashLineChart({ data }: { data: MonthPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={axisMoney} width={48} />
        <Tooltip content={<ChartTooltip />} />
        <Line
          type="monotone"
          dataKey="cash"
          name="Cash at end of month"
          stroke="var(--cash)"
          strokeWidth={2.5}
          dot={{ r: 3.5, fill: 'var(--cash)', strokeWidth: 2, stroke: 'var(--surface)' }}
          activeDot={{ r: 6, strokeWidth: 2, stroke: 'var(--surface)' }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
