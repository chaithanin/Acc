'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCompactTHB, formatMonth, formatTHB } from '@/lib/format/number';

/**
 * Chart layer.
 *
 * Colour comes from the three validated categorical slots plus the reserved
 * status colours, read as CSS variables so light and dark both work from one
 * definition. Marks are thin, grids are recessive hairlines, no chart has two
 * y-axes, and every chart on a page is paired with the same data as a table —
 * which is also the relief required for the light-mode aqua slot.
 */

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'] as const;
const AXIS_STYLE = { fontSize: 11, fill: 'var(--ink-muted)' } as const;

/** Axis ticks read as ฿12M rather than 12000000. */
function axisMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(0)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
}

interface TooltipEntry {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  labelFormatter?: (value: string) => string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 shadow-lg">
      <p className="mb-1 text-xs font-medium text-ink">
        {labelFormatter ? labelFormatter(String(label)) : String(label ?? '')}
      </p>
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center gap-2 text-xs">
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-[2px]"
            style={{ background: entry.color }}
          />
          <span className="text-ink-secondary">{entry.name}</span>
          <span className="tnum ml-auto pl-3 font-medium text-ink">
            {typeof entry.value === 'number' ? formatTHB(entry.value) : String(entry.value ?? '')}
          </span>
        </div>
      ))}
    </div>
  );
}

const legendStyle = { fontSize: 11, color: 'var(--ink-secondary)' } as const;

// ---------------------------------------------------------------------------

export interface IncomeExpensePoint {
  label: string;
  income: number;
  expense: number;
}

/** Two series, one axis, a legend and hairline grid. */
export function IncomeExpenseChart({ data }: { data: IncomeExpensePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} />
        <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} tickFormatter={axisMoney} width={46} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-hover)' }} />
        <Legend wrapperStyle={legendStyle} iconType="square" iconSize={8} />
        <Bar dataKey="income" name="Income" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={38} />
        <Bar dataKey="expense" name="Expense" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={38} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface CashflowPoint {
  month: string;
  closingCash: number;
}

/**
 * Closing cash by month with a zero reference line, so the shortfall window is
 * unmistakable (requirement 12.5).
 */
export function CashflowChart({ data }: { data: CashflowPoint[] }) {
  const hasNegative = data.some((d) => d.closingCash < 0);

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis
          dataKey="month"
          tick={AXIS_STYLE}
          tickLine={false}
          axisLine={{ stroke: 'var(--axis)' }}
          tickFormatter={formatMonth}
        />
        <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} tickFormatter={axisMoney} width={46} />
        <Tooltip content={<ChartTooltip labelFormatter={formatMonth} />} />
        {/* The zero line is the point of the chart when cash goes negative. */}
        <ReferenceLine
          y={0}
          stroke={hasNegative ? 'var(--status-critical)' : 'var(--axis)'}
          strokeWidth={hasNegative ? 2 : 1}
        />
        <Line
          type="monotone"
          dataKey="closingCash"
          name="Closing Cash"
          stroke={SERIES[0]}
          strokeWidth={2}
          dot={{ r: 3, strokeWidth: 2, stroke: 'var(--surface)' }}
          activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export interface DonutSlice {
  name: string;
  value: number;
}

/**
 * Received against outstanding, with the collection rate as the centre figure.
 *
 * A two-segment donut only earns its place because the centre number is the
 * real reading — it is a progress gauge, not a comparison of two categories.
 */
export function ReceivedDonut({
  received,
  outstanding,
}: {
  received: number;
  outstanding: number;
}) {
  const total = received + outstanding;
  const rate = total > 0 ? (received / total) * 100 : 0;
  const slices: DonutSlice[] = [
    { name: 'Received', value: Math.max(0, received) },
    { name: 'Outstanding', value: Math.max(0, outstanding) },
  ];

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="88%"
            startAngle={90}
            endAngle={-270}
            // A 2px surface gap separates the segments instead of a border.
            paddingAngle={1.5}
            stroke="var(--surface)"
            strokeWidth={2}
          >
            <Cell fill={SERIES[0]} />
            <Cell fill={SERIES[1]} />
          </Pie>
          <Tooltip content={<ChartTooltip />} />
          <Legend wrapperStyle={legendStyle} iconType="square" iconSize={8} />
        </PieChart>
      </ResponsiveContainer>

      <div className="pointer-events-none absolute inset-x-0 top-[42%] -translate-y-1/2 text-center">
        <p className="text-2xl font-semibold text-ink">{rate.toFixed(1)}%</p>
        <p className="text-[11px] text-ink-muted">collected</p>
      </div>
    </div>
  );
}

export interface CategoryPoint {
  label: string;
  value: number;
}

/**
 * One measure across nominal categories: a single colour for every bar.
 * Colouring by magnitude would double-encode what the bar length already says.
 */
export function CategoryBarChart({
  data,
  horizontal,
  seriesIndex = 0,
}: {
  data: CategoryPoint[];
  horizontal?: boolean;
  seriesIndex?: 0 | 1 | 2;
}) {
  if (horizontal) {
    return (
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 44)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--grid)" horizontal={false} />
          <XAxis type="number" tick={AXIS_STYLE} tickLine={false} axisLine={false} tickFormatter={axisMoney} />
          <YAxis
            type="category"
            dataKey="label"
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={{ stroke: 'var(--axis)' }}
            width={130}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-hover)' }} />
          <Bar dataKey="value" name="Amount" fill={SERIES[seriesIndex]} radius={[0, 4, 4, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} />
        <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} tickFormatter={axisMoney} width={46} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-hover)' }} />
        <Bar dataKey="value" name="Amount" fill={SERIES[seriesIndex]} radius={[4, 4, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface TwoSeriesPoint {
  label: string;
  a: number;
  b: number;
}

/** Plan against actual — two series, one axis, always legended. */
export function PairedBarChart({
  data,
  aLabel,
  bLabel,
}: {
  data: TwoSeriesPoint[];
  aLabel: string;
  bLabel: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} />
        <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} tickFormatter={axisMoney} width={46} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-hover)' }} />
        <Legend wrapperStyle={legendStyle} iconType="square" iconSize={8} />
        <Bar dataKey="a" name={aLabel} fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={34} />
        <Bar dataKey="b" name={bLabel} fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={34} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** A cumulative measure over time — one series, so no legend box. */
export function AccumulationChart({ data, name }: { data: CategoryPoint[]; name: string }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="accumulation" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={AXIS_STYLE}
          tickLine={false}
          axisLine={{ stroke: 'var(--axis)' }}
          tickFormatter={formatMonth}
        />
        <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} tickFormatter={axisMoney} width={46} />
        <Tooltip content={<ChartTooltip labelFormatter={formatMonth} />} />
        <Area
          type="monotone"
          dataKey="value"
          name={name}
          stroke={SERIES[0]}
          strokeWidth={2}
          fill="url(#accumulation)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Compact figure used beside charts where a full card would be too heavy. */
export function InlineStat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-md bg-surface-sunken px-3 py-2">
      <p className="text-[11px] text-ink-muted">{label}</p>
      <p className="tnum mt-0.5 text-sm font-semibold text-ink">{formatCompactTHB(value)}</p>
    </div>
  );
}
