import { DashboardPage } from '@/components/dashboard-page';
import { KpiCard, KpiGrid } from '@/components/kpi-card';
import { SectionLabel } from '@/components/ui/primitives';
import { loadDashboard, pickMetrics } from '@/lib/dashboard/context';
import { getProjectMetrics, getProjection, loadDatasetSummary } from '@/lib/dashboard/queries';
import { ProjectView } from './project-view';

/**
 * Project Dashboard (requirement 12.2).
 *
 * The project selector is the shared global filter, so a project chosen here
 * stays selected when moving to Receivable, BOQ or Cash Flow.
 */
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const context = await loadDashboard(params);

  const selected = context.projects.find((p) => p.id === context.projectId) ?? null;

  const bank = pickMetrics(context, ['bank_current_amount', 'pending_expense', 'available_cash']);
  const income = pickMetrics(context, [
    'total_contractual_income',
    'received_income',
    'accrued_income',
    'expected_future_income',
  ]);
  const cost = pickMetrics(context, [
    'boq_total',
    'boq_paid',
    'boq_outstanding',
    'total_expense',
    'wip_ytd',
    'advance_outstanding',
  ]);
  const cash = pickMetrics(context, ['forecast_cash', 'lowest_forecast_cash', 'required_funding']);

  const data = context.snapshot
    ? {
        projection: getProjection(context.snapshot.id, context.projectId),
        byProject: getProjectMetrics(context.snapshot.id, context.projects),
        summary: loadDatasetSummary(context.snapshot.id, context.projectId),
      }
    : null;

  return (
    <DashboardPage
      title={selected ? selected.name : 'All Projects'}
      description={
        selected
          ? selected.company ?? 'Project-level financial position.'
          : 'Every project side by side. Choose one from the Project filter to focus.'
      }
      context={context}
    >
      <SectionLabel>Bank</SectionLabel>
      <KpiGrid>
        {bank.map((m) => (
          <KpiCard key={m.key} metric={m} snapshotId={context.snapshot!.id} projectId={context.projectId} />
        ))}
      </KpiGrid>

      <div className="mt-6">
        <SectionLabel>Income and receivable</SectionLabel>
        <KpiGrid>
          {income.map((m) => (
            <KpiCard key={m.key} metric={m} snapshotId={context.snapshot!.id} projectId={context.projectId} />
          ))}
        </KpiGrid>
      </div>

      <div className="mt-6">
        <SectionLabel>Cost, BOQ and work in progress</SectionLabel>
        <KpiGrid>
          {cost.map((m) => (
            <KpiCard key={m.key} metric={m} snapshotId={context.snapshot!.id} projectId={context.projectId} />
          ))}
        </KpiGrid>
      </div>

      <div className="mt-6">
        <SectionLabel>Cash outlook</SectionLabel>
        <KpiGrid>
          {cash.map((m) => (
            <KpiCard key={m.key} metric={m} snapshotId={context.snapshot!.id} projectId={context.projectId} />
          ))}
        </KpiGrid>
      </div>

      {data ? (
        <ProjectView
          projection={data.projection}
          byProject={data.byProject}
          summary={data.summary}
          focused={!!selected}
        />
      ) : null}
    </DashboardPage>
  );
}
