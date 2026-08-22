import type { DataScope } from '@/lib/db/scope';
import type { SnapshotInfo } from '@/lib/db/repositories/snapshots';
import type { MetricComparison, Project } from '@/lib/types';

/**
 * Dashboard shapes and pure helpers.
 *
 * Deliberately free of `server-only` and of any database import, because
 * client components need these types and the filter helpers. The loader that
 * populates them lives in `context.ts`, which is server-only.
 */

export type ComparisonMode = 'previous' | 'period';

export interface DashboardFilters {
  snapshotId?: string;
  projectId?: string;
  compareTo?: string;
}

export interface DashboardContext {
  projects: Project[];
  snapshots: SnapshotInfo[];
  snapshot: SnapshotInfo | null;
  previous: SnapshotInfo | null;
  projectId: string | null;
  /** Display name of the company this page is scoped to. Never null: a
   *  dashboard without a company does not render. */
  company: string;
  companyId: string;
  companyCode: string;
  /**
   * What every record read on this page must be filtered by.
   *
   * Null only when the company holds no snapshot yet — which is the one case
   * where there is nothing to read. Pages pass this object straight through
   * rather than assembling ids themselves, so no page can read a snapshot
   * without also naming the company it belongs to.
   */
  scope: DataScope | null;
  /** Every KPI for the current scope, paired with its previous value. */
  comparisons: MetricComparison[];
  byKey: Map<string, MetricComparison>;
  hasData: boolean;
}

/**
 * Pulls the KPIs a page wants, in the order given, skipping any the current
 * snapshot did not produce.
 */
export function pickMetrics(context: DashboardContext, keys: string[]): MetricComparison[] {
  return keys
    .map((key) => context.byKey.get(key))
    .filter((m): m is MetricComparison => m !== undefined);
}
