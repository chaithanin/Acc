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
