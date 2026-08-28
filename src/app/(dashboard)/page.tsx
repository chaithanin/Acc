import { DashboardPage } from '@/components/dashboard-page';
import { KpiCard, KpiGrid } from '@/components/kpi-card';
import { OverviewCharts } from './overview-charts';
import { getProjectMetrics, getProjection, loadDatasetSummary } from '@/lib/dashboard/queries';
import { loadDashboard, pickMetrics } from '@/lib/dashboard/context';
import { SectionLabel } from '@/components/ui/primitives';
import { AlertPanel } from '@/components/alert-panel';
import { buildAlerts } from '@/lib/alerts';

/** Executive Overview (requirement 12.1). */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const context = await loadDashboard(params);

  const headline = pickMetrics(context, [
    'bank_current_amount',
    'available_cash',
    'total_receivable_outstanding',
    'total_outstanding_expense',
    'net_financial_position',
    'forecast_cash',
  ]);

  const secondary = pickMetrics(context, [
    'accrued_income',
    'received_income',
    'boq_outstanding',
    'advance_outstanding',
  ]);

  // Everything management should be told without having to look for it. Built
  // from figures that already exist, so an alert cannot silently stop working
  // when a data source it alone depended on goes quiet.
  const alerts = buildAlerts({
    metrics: context.byKey,
    reportDate: context.snapshot?.reportDate ?? null,
    importedAt: context.snapshot?.createdAt ?? null,
  });

  const charts = context.scope
    ? {
        projection: getProjection(context.scope),
        byProject: getProjectMetrics(context.scope, context.projects),
        summary: loadDatasetSummary(context.scope),
      }
    : null;

  return (
    <DashboardPage
      title="Executive Overview"
      description="Group-wide financial position for the selected reporting period."
      context={context}
    >
      <AlertPanel alerts={alerts} />

      <SectionLabel>Financial position</SectionLabel>
      <KpiGrid>
        {headline.map((metric, index) => (
          <KpiCard
            key={metric.key}
            metric={metric}
            snapshotId={context.snapshot!.id}
            projectId={context.projectId}
            emphasis={index === 0}
          />
        ))}
      </KpiGrid>

      <div className="mt-6">
        <SectionLabel>Income, cost and commitments</SectionLabel>
        <KpiGrid>
          {secondary.map((metric) => (
            <KpiCard
              key={metric.key}
              metric={metric}
              snapshotId={context.snapshot!.id}
              projectId={context.projectId}
            />
          ))}
        </KpiGrid>
      </div>

      {charts ? (
        <OverviewCharts
          projection={charts.projection}
          byProject={charts.byProject}
          summary={charts.summary}
        />
      ) : null}
    </DashboardPage>
  );
}
