import { DashboardPage } from '@/components/dashboard-page';
import { KpiCard, KpiGrid } from '@/components/kpi-card';
import { loadDashboard, pickMetrics } from '@/lib/dashboard/context';
import { getAccountSummary, getLedgerRows } from '@/lib/dashboard/queries';
import { LedgerView } from './ledger-view';

/**
 * Ledger & Advances.
 *
 * The accounting system's GL exports land here: an account-level summary of
 * advances and deposits, plus every transaction behind it. This is the audit
 * trail Finance uses to justify a balance line by line.
 */
export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const context = await loadDashboard(params);

  const metrics = pickMetrics(context, ['advance_outstanding', 'wip_ytd', 'gl_entry_count']);

  const data = context.scope
    ? {
        accounts: getAccountSummary(context.scope),
        entries: getLedgerRows(context.scope),
      }
    : null;

  return (
    <DashboardPage
      title="Ledger & Advances"
      description="Account balances from the general ledger, with every posting behind them."
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

      {data ? (
        <LedgerView
          accounts={data.accounts}
          entries={data.entries.rows}
          totalEntries={data.entries.totalCount}
          truncated={data.entries.truncated}
        />
      ) : null}
    </DashboardPage>
  );
}
