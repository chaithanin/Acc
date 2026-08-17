/**
 * THB formatting (requirement 19).
 *
 * Negative amounts use accounting parentheses — (฿12.50M) — because finance
 * readers scan for the bracket, not the minus sign.
 */

export type DisplayMode = 'full' | 'thousands' | 'millions';

export const DISPLAY_MODES: { value: DisplayMode; label: string }[] = [
  { value: 'full', label: 'Full Amount' },
  { value: 'thousands', label: 'Thousands' },
  { value: 'millions', label: 'Millions' },
];

const BAHT = '฿';

function group(value: number, decimals: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Formats an amount in Thai baht.
 *
 * `full` shows every digit; `thousands` and `millions` scale and suffix. A
 * null value renders as an em dash so empty cells read as "no data" rather
 * than as zero.
 */
export function formatTHB(
  value: number | null | undefined,
  mode: DisplayMode = 'full',
  options: { decimals?: number; showSymbol?: boolean } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';

  const showSymbol = options.showSymbol ?? true;
  const symbol = showSymbol ? BAHT : '';
  const negative = value < 0;
  const abs = Math.abs(value);

  let body: string;
  if (mode === 'millions') {
    body = `${symbol}${group(abs / 1_000_000, options.decimals ?? 2)}M`;
  } else if (mode === 'thousands') {
    body = `${symbol}${group(abs / 1_000, options.decimals ?? 1)}K`;
  } else {
    body = `${symbol}${group(abs, options.decimals ?? 2)}`;
  }

  return negative ? `(${body})` : body;
}

/**
 * Picks a scale automatically. Used on KPI cards, where a fixed scale either
 * wastes space on big numbers or destroys precision on small ones.
 */
export function formatCompactTHB(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return formatTHB(value, 'millions');
  if (abs >= 10_000) return formatTHB(value, 'thousands');
  return formatTHB(value, 'full', { decimals: abs % 1 === 0 ? 0 : 2 });
}

/** Signed difference, e.g. "+฿17.11M" / "(฿2.40M)". */
export function formatDelta(
  value: number | null | undefined,
  mode: DisplayMode = 'millions',
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value === 0) return formatTHB(0, mode);
  const formatted = formatTHB(value, mode);
  return value > 0 ? `+${formatted}` : formatted;
}

/** Percentage change. Null renders as N/A — never a division by zero. */
export function formatPercent(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

/** Liquidity ratios read as "1.42×"; null means the ratio was not calculable. */
export function formatRatio(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
  return `${value.toFixed(decimals)}×`;
}

/** Formats a metric according to its own unit, so callers never branch on it. */
export function formatByUnit(
  value: number | null | undefined,
  unit: 'THB' | 'PERCENT' | 'COUNT' | 'RATIO',
): string {
  if (unit === 'PERCENT') return value === null || value === undefined ? 'N/A' : `${value.toFixed(1)}%`;
  if (unit === 'RATIO') return formatRatio(value);
  if (unit === 'COUNT') return formatNumber(value);
  return formatCompactTHB(value);
}

export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return group(value, decimals);
}

/** "2026-08-31" -> "31 Aug 2026". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "2026-08" -> "Aug 2026". */
export function formatMonth(month: string | null | undefined): string {
  if (!month) return '—';
  const date = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
