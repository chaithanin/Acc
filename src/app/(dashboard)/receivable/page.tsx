import { DashboardPage } from '@/components/dashboard-page';
import { KpiCard, KpiGrid } from '@/components/kpi-card';
import { loadDashboard, pickMetrics } from '@/lib/dashboard/context';
import { getReceivableRows, loadDatasetSummary } from '@/lib/dashboard/queries';
import { ReceivableView } from './receivable-view';

/** Receivable Dashboard (requirement 12.3). */
export default async function ReceivablePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const context = loadDashboard(params);

  const metrics = pickMetrics(context, [
    'total_contractual_income',
    'received_income',
    'total_receivable_outstanding',
    'reservation_outstanding',
    'contract_outstanding',
    'down_payment_outstanding',
    'transfer_outstanding',
  ]);

  const data = context.snapshot
    ? {
        rows: getReceivableRows(context.snapshot.id, context.projectId),
        summary: loadDatasetSummary(context.snapshot.id, context.projectId),
      }
    : null;

  return (
    <DashboardPage
      title="Receivable"
      description="Contract value, collections and what remains outstanding, by category."
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

      {data ? <ReceivableView rows={data.rows} summary={data.summary} /> : null}
    </DashboardPage>
  );
}
