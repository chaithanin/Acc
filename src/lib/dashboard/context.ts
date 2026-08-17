import 'server-only';

import { compareMetrics } from '@/lib/compare';
import { listProjects } from '@/lib/db/repositories/projects';
import {
  getCurrentSnapshot,
  getMetrics,
  getPreviousSnapshot,
  getSnapshot,
  listSnapshots,
} from '@/lib/db/repositories/snapshots';
import type { MetricComparison } from '@/lib/types';
import type { DashboardContext, DashboardFilters } from './types';

/**
 * Server-side loader for every dashboard page.
 *
 * Resolves the global filters (requirement 21) once — report date, project,
 * company and comparison baseline — so each page renders from the same
 * selection rather than re-deriving it.
 *
 * The shapes and pure helpers live in `./types`, which client components can
 * import; this module touches the database and must not.
 */
export function loadDashboard(filters: DashboardFilters): DashboardContext {
  const projects = listProjects();
  const snapshots = listSnapshots();

  const snapshot = filters.snapshotId
    ? getSnapshot(filters.snapshotId) ?? getCurrentSnapshot()
    : getCurrentSnapshot();

  const previous = snapshot
    ? filters.compareTo
      ? getSnapshot(filters.compareTo)
      : getPreviousSnapshot(snapshot.id)
    : null;

  // A project filter naming something that no longer exists is ignored rather
  // than showing an empty dashboard with no explanation.
  const projectId =
    filters.projectId && projects.some((p) => p.id === filters.projectId)
      ? filters.projectId
      : null;

  let comparisons: MetricComparison[] = [];
  if (snapshot) {
    const current = getMetrics(snapshot.id, projectId);
    const baseline = previous ? getMetrics(previous.id, projectId) : null;
    comparisons = compareMetrics(current, baseline);
  }

  return {
    projects,
    snapshots,
    snapshot,
    previous,
    projectId,
    company: filters.company ?? null,
    comparisons,
    byKey: new Map(comparisons.map((c) => [c.key, c])),
    hasData: snapshots.length > 0,
  };
}

export { companiesOf, pickMetrics, projectsForCompany } from './types';
export type { DashboardContext, DashboardFilters } from './types';
