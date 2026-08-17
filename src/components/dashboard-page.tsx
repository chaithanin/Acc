import Link from 'next/link';
import { FilterBar } from './filter-bar';
import { EmptyState, PageHeader } from './ui/primitives';
import type { DashboardContext } from '@/lib/dashboard/types';

/**
 * Common frame for the dashboard pages: heading, global filters, and the
 * "nothing imported yet" state — so each page only writes its own content.
 */
export function DashboardPage({
  title,
  description,
  context,
  action,
  children,
}: {
  title: string;
  description?: string;
  context: DashboardContext;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <PageHeader title={title} description={description} action={action} />

      <FilterBar
        snapshots={context.snapshots}
        snapshot={context.snapshot}
        previous={context.previous}
        projects={context.projects}
        projectId={context.projectId}
        company={context.company}
      />

      {context.snapshot ? (
        children
      ) : (
        <EmptyState
          title="No financial data has been imported yet"
          description="Upload an Excel workbook or a ZIP of workbooks and the dashboard will populate itself. Nothing here is hard-coded — every figure comes from an imported file."
          action={
            <Link
              href="/import"
              className="inline-flex rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              Go to Data Import
            </Link>
          }
        />
      )}
    </>
  );
}
