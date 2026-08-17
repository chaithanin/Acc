import { DashboardPage } from '@/components/dashboard-page';
import { KpiCard, KpiGrid } from '@/components/kpi-card';
import { loadDashboard, pickMetrics } from '@/lib/dashboard/context';
import { getProjection } from '@/lib/dashboard/queries';
import { CashflowView } from './cashflow-view';

/** Cash Flow Forecast (requirement 12.5). */
export default async function CashflowPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const context = loadDashboard(params);

  const metrics = pickMetrics(context, [
    'current_cash',
    'forecast_cash',
    'lowest_forecast_cash',
    'required_funding',
    'expected_future_income',
    'total_future_expense',
  ]);

  const projection = context.snapshot
    ? getProjection(context.snapshot.id, context.projectId)
    : null;

  return (
    <DashboardPage
      title="Cash Flow Forecast"
      description="Opening cash, expected movements and the running closing balance, recalculated month by month."
      context={context}
    >
      <KpiGrid>
        {metrics.map((metric) => (
          <KpiCard
            key={metric.key}
            metric={metric}
            snapshotId={context.snapshot!.id}
            projectId={context.projectId}
          />
        ))}
      </KpiGrid>

      {projection ? <CashflowView projection={projection} /> : null}
    </DashboardPage>
  );
}
