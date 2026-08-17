import { DashboardPage } from '@/components/dashboard-page';
import { KpiCard, KpiGrid } from '@/components/kpi-card';
import { loadDashboard, pickMetrics } from '@/lib/dashboard/context';
import { getBoqRows } from '@/lib/dashboard/queries';
import { BoqView } from './boq-view';

/** BOQ / Construction Dashboard (requirement 12.4). */
export default async function BoqPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const context = await loadDashboard(params);

  const metrics = pickMetrics(context, [
    'boq_total',
    'boq_to_date',
    'boq_paid',
    'boq_outstanding',
    'remaining_boq',
    'total_future_expense',
  ]);

  const rows = context.snapshot ? getBoqRows(context.snapshot.id, context.projectId) : [];

  return (
    <DashboardPage
      title="BOQ / Construction"
      description="Contract value, work certified to date, payments made and what is still committed."
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

      <BoqView rows={rows} />
    </DashboardPage>
  );
}
