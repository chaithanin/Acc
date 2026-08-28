import { DashboardPage } from '@/components/dashboard-page';
import { KpiCard, KpiGrid } from '@/components/kpi-card';
import { loadDashboard, pickMetrics } from '@/lib/dashboard/context';
import { getReceivableRows, loadDatasetSummary } from '@/lib/dashboard/queries';
import { ReceivableAgeing } from './receivable-ageing';
import { ReceivableView } from './receivable-view';

/** Receivable Dashboard (requirement 12.3). */
export default async function ReceivablePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const context = await loadDashboard(params);

  const metrics = pickMetrics(context, [
    'total_contractual_income',
    'received_income',
    'total_receivable_outstanding',
    'reservation_outstanding',
    'contract_outstanding',
    'down_payment_outstanding',
    'transfer_outstanding',
  ]);

  // Ageing is its own read: it answers a different question from "how much is
  // owed" — namely which of it a credit controller should be chasing today.
  const ageing = pickMetrics(context, [
    'receivable_aged_current',
    'receivable_aged_1_30',
    'receivable_aged_31_60',
    'receivable_aged_61_90',
    'receivable_aged_91_120',
    'receivable_aged_120_plus',
  ]);

  const [overdue, undated, oldest] = pickMetrics(context, [
    'receivable_overdue',
    'receivable_undated',
    'receivable_oldest_days',
  ]);

  const data = context.scope
    ? {
        rows: getReceivableRows(context.scope),
        summary: loadDatasetSummary(context.scope),
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

      <ReceivableAgeing
        buckets={ageing}
        overdue={overdue ?? null}
        undated={undated ?? null}
        oldest={oldest ?? null}
        outstanding={metrics.find((m) => m.key === 'total_receivable_outstanding')?.current ?? null}
        reportDate={context.snapshot?.reportDate ?? ''}
        snapshotId={context.snapshot?.id ?? ''}
        projectId={context.projectId}
      />

      {data ? <ReceivableView rows={data.rows} summary={data.summary} /> : null}
    </DashboardPage>
  );
}
