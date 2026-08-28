import { DashboardPage } from '@/components/dashboard-page';
import { KpiCard, KpiGrid } from '@/components/kpi-card';
import { loadDashboard, pickMetrics } from '@/lib/dashboard/context';
import { getPayableRows, loadDatasetSummary } from '@/lib/dashboard/queries';
import { PayableView } from './payable-view';

/**
 * Accounts payable.
 *
 * The mirror of the receivable dashboard, and the side of the ledger this
 * system used not to have. Before it, the liquidity ratios divided by
 * certified-but-unpaid construction and called the result Accounts Payable —
 * which said nothing about a vendor invoice sitting unpaid on someone's desk,
 * when it fell due, or how long it had been there.
 */
export default async function PayablePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const context = await loadDashboard(params);

  const metrics = pickMetrics(context, [
    'accounts_payable',
    'payable_overdue',
    'payable_invoiced',
    'payable_paid',
    'total_owed',
    'boq_outstanding',
  ]);

  const ageing = pickMetrics(context, [
    'payable_aged_current',
    'payable_aged_1_30',
    'payable_aged_31_60',
    'payable_aged_61_90',
    'payable_aged_91_120',
    'payable_aged_120_plus',
  ]);

  const [overdue, undated] = pickMetrics(context, ['payable_overdue', 'payable_undated']);

  const data = context.scope
    ? { rows: getPayableRows(context.scope), summary: loadDatasetSummary(context.scope) }
    : null;

  return (
    <DashboardPage
      title="Payable"
      description="What the company owes its vendors, when it falls due, and how much of it is already late."
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

      <PayableView
        rows={data?.rows ?? []}
        buckets={ageing}
        overdue={overdue ?? null}
        undated={undated ?? null}
        payable={metrics.find((m) => m.key === 'accounts_payable')?.current ?? null}
        reportDate={context.snapshot?.reportDate ?? ''}
      />
    </DashboardPage>
  );
}
