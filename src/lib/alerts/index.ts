import { POLICY } from '@/config/accounting-policy';
import type { MetricComparison } from '@/lib/types';

/**
 * What management should be told without having to look for it.
 *
 * The brief's own list: cash below a threshold, large overdue receivables,
 * budget overrun, large unpaid payables, and data that has not refreshed.
 * Everything here is derived from figures that already exist — an alert that
 * needs its own data source is an alert that will silently stop working.
 *
 * Severity is deliberately hard to reach. A list that always has ten things on
 * it is a list nobody reads, so each rule fires on a threshold someone would
 * actually act on rather than on any movement at all.
 */

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'information';

export interface Alert {
  severity: AlertSeverity;
  title: string;
  detail: string;
  /** Where to go to do something about it. */
  href?: string;
}

export interface AlertInputs {
  metrics: Map<string, MetricComparison>;
  reportDate: string | null;
  /** When the newest import for this company was run. */
  importedAt: string | null;
  /** Today, injected so the same snapshot reads the same in a test. */
  now?: Date;
}

const value = (metrics: Map<string, MetricComparison>, key: string): number | null =>
  metrics.get(key)?.current ?? null;

const DAY = 86_400_000;

export function buildAlerts({ metrics, reportDate, importedAt, now = new Date() }: AlertInputs): Alert[] {
  const alerts: Alert[] = [];

  const cash = value(metrics, 'available_cash');
  const owed = value(metrics, 'current_liabilities');
  const overdueIn = value(metrics, 'receivable_overdue');
  const receivable = value(metrics, 'total_receivable_outstanding');
  const overdueOut = value(metrics, 'payable_overdue');
  const workingCapital = value(metrics, 'working_capital');
  const shortfall = value(metrics, 'required_funding');

  // --- cash against what is already owed
  if (cash !== null && owed !== null && owed > 0) {
    const cover = cash / owed;
    if (cover < 0.5) {
      alerts.push({
        severity: 'critical',
        title: 'Cash covers less than half of what is already owed',
        detail: `Available cash is ${pct(cover)} of current liabilities. Payments falling due cannot all be met from cash on hand.`,
        href: '/financial',
      });
    } else if (cover < 1) {
      alerts.push({
        severity: 'high',
        title: 'Cash does not cover what is owed',
        detail: `Available cash is ${pct(cover)} of current liabilities. A collection or a facility is needed before the next payment run.`,
        href: '/financial',
      });
    }
  }

  if (workingCapital !== null && workingCapital < 0) {
    alerts.push({
      severity: 'high',
      title: 'Working capital is negative',
      detail: "Today's obligations exceed today's assets.",
      href: '/financial',
    });
  }

  if (shortfall !== null && shortfall > 0) {
    alerts.push({
      severity: 'critical',
      title: 'The cash projection goes below zero',
      detail: `A facility of ${money(shortfall)} would keep every projected month above the line.`,
      href: '/cashflow',
    });
  }

  // --- collections
  if (overdueIn !== null && receivable !== null && receivable > 0) {
    const share = overdueIn / receivable;
    if (share >= 0.25) {
      alerts.push({
        severity: share >= 0.5 ? 'critical' : 'high',
        title: `${pct(share)} of the receivable balance is overdue`,
        detail: `${money(overdueIn)} is past its due date. The oldest is ${value(metrics, 'receivable_oldest_days') ?? '—'} days old.`,
        href: '/receivable',
      });
    }
  }

  const undated = value(metrics, 'receivable_undated');
  if (undated !== null && receivable !== null && receivable > 0 && undated / receivable >= 0.2) {
    alerts.push({
      severity: 'medium',
      title: 'A fifth of the receivable balance cannot be aged',
      detail: `${money(undated)} sits on rows whose file carries no due date, so nothing can say whether it is late. An amount that cannot be aged is an amount nobody is chasing.`,
      href: '/receivable',
    });
  }

  // --- what the company itself owes
  if (overdueOut !== null && overdueOut > 0) {
    alerts.push({
      severity: overdueOut > (cash ?? 0) ? 'high' : 'medium',
      title: 'Vendor invoices are overdue',
      detail: `${money(overdueOut)} is past its due date. Suppliers notice before anyone else does.`,
      href: '/payable',
    });
  }

  // --- is any of this current?
  const stale = staleness(reportDate, importedAt, now);
  if (stale) alerts.push(stale);

  return alerts.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

const RANK: Record<AlertSeverity, number> = { critical: 0, high: 1, medium: 2, information: 3 };

/**
 * Whether what is on screen is recent enough to act on.
 *
 * The report date has always been shown; nothing said whether it was old. A
 * dashboard reading March's figures in August looked exactly like one reading
 * August's.
 */
export function staleness(
  reportDate: string | null,
  importedAt: string | null,
  now = new Date(),
): Alert | null {
  if (!reportDate) return null;

  const asAt = Date.parse(`${reportDate}T00:00:00Z`);
  if (!Number.isFinite(asAt)) return null;

  const days = Math.floor((now.getTime() - asAt) / DAY);
  if (days <= POLICY.freshnessDays) return null;

  const months = Math.floor(days / 30);
  return {
    severity: days > POLICY.freshnessDays * 2 ? 'high' : 'medium',
    title: `These figures are ${months >= 2 ? `${months} months` : `${days} days`} old`,
    detail:
      `The newest import is for ${reportDate}`
      + (importedAt ? `, uploaded ${importedAt.slice(0, 10)}` : '')
      + `. The group closes within ${POLICY.freshnessDays} days, so this month is overdue. Decisions taken on it are being taken on old figures.`,
    href: '/import',
  };
}

const money = (n: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n));
const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;
