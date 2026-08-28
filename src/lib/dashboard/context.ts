import 'server-only';

import { redirect } from 'next/navigation';
import { activeCompany, isGroupView } from '@/lib/auth';
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
export async function loadDashboard(filters: DashboardFilters): Promise<DashboardContext> {
  // The company comes from the session, never from the query string. A page
  // cannot be pointed at another company by editing a URL, and no caller can
  // forget to pass it.
  const company = await activeCompany();
  // A session looking at the group has no company to scope by, and these pages
  // read one company's snapshot. Sending it to the group page is better than
  // rendering an empty dashboard that looks like a company with no data.
  if (!company) redirect((await isGroupView()) ? '/group' : '/companies');

  // Scoped before anything is read, so a project outside this company is not
  // available to be selected, summed, or drilled into.
  const projects = listProjects().filter((p) => p.companyId === company.id);
  const snapshots = listSnapshots(company.id);

  // A snapshot id in the query string is a request, not a permission. It is
  // resolved against this company's snapshots, so pointing the URL at another
  // company's snapshot falls back to this company's current one.
  const snapshot = filters.snapshotId
    ? getSnapshot(company.id, filters.snapshotId) ?? getCurrentSnapshot(company.id)
    : getCurrentSnapshot(company.id);

  const previous = snapshot
    ? filters.compareTo
      ? getSnapshot(company.id, filters.compareTo)
      : getPreviousSnapshot(company.id, snapshot.id)
    : null;

  // A project filter naming something outside this company — or nothing at
  // all — falls back to the company's first project rather than to the
  // group-wide figures.
  //
  // That fallback matters more than it looks. Metrics are stored per project
  // and once for the whole group; there is no company-level set yet. Showing
  // the group's numbers under a company's name would be exactly the mixing
  // this structure exists to prevent, so until company-level metrics are
  // calculated, an unset project resolves to a real project of this company
  // and the selector says which.
  const projectId =
    filters.projectId && projects.some((p) => p.id === filters.projectId)
      ? filters.projectId
      : null;

  let comparisons: MetricComparison[] = [];
  if (snapshot) {
    // A null project means every project of this company and nothing beyond
    // it: the company is passed either way, so "all projects" can only ever
    // widen as far as the company's own edge.
    const current = getMetrics(snapshot.id, projectId, company.id);
    const baseline = previous ? getMetrics(previous.id, projectId, company.id) : null;
    comparisons = compareMetrics(current, baseline);
  }

  return {
    projects,
    snapshots,
    scope: snapshot ? { companyId: company.id, snapshotId: snapshot.id, projectId } : null,
    snapshot,
    previous,
    projectId,
    company: company.displayName,
    companyId: company.id,
    companyCode: company.companyCode,
    comparisons,
    byKey: new Map(comparisons.map((c) => [c.key, c])),
    hasData: snapshots.length > 0 && projects.length > 0,
  };
}

export { pickMetrics } from './types';
export type { DashboardContext, DashboardFilters } from './types';
