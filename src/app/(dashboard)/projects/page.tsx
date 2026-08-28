import { DashboardPage } from '@/components/dashboard-page';
import { KpiCard, KpiGrid } from '@/components/kpi-card';
import { SectionLabel } from '@/components/ui/primitives';
import { Card, CardHeader } from '@/components/ui/primitives';
import { loadDashboard, pickMetrics } from '@/lib/dashboard/context';
import { budgetPosition, getProjectFinancials } from '@/lib/db/repositories/project-financials';
import { formatTHB } from '@/lib/format/number';
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

  // Profitability, for the project in the filter or for the company as a
  // whole. These are the figures a project director is judged on, and until
  // revenue was recognised they could not be produced at all.
  const profitability = pickMetrics(context, [
    'completion_percent',
    'contracted_sale_value',
    'recognised_revenue',
    'revenue_backlog',
    'cost_of_goods_sold',
    'gross_profit',
    'net_profit_margin',
  ]);

  // The project's own budget position, which is a board figure rather than an
  // imported one.
  const budget = context.scope?.projectId
    ? budgetPosition(
        getProjectFinancials(context.scope.companyId, context.scope.projectId),
        pickMetrics(context, ['total_expense'])[0]?.current ?? 0,
      )
    : null;

  const data = context.scope
    ? {
        projection: getProjection(context.scope),
        byProject: getProjectMetrics(context.scope, context.projects),
        summary: loadDatasetSummary(context.scope),
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
      <SectionLabel>Profitability</SectionLabel>
      <KpiGrid>
        {profitability.map((m) => (
          <KpiCard key={m.key} metric={m} snapshotId={context.snapshot!.id} projectId={context.projectId} />
        ))}
      </KpiGrid>

      {budget ? (
        <Card className="mt-4">
          <CardHeader
            title="Project budget"
            subtitle="Committed cost is money promised by signed contract and not yet spent. It counts against the budget alongside actual spend, because a budget that looks healthy until the commitments land is how an overrun is found too late."
          />
          <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {[
              ['Approved', budget.approved],
              ['Revised', budget.revised],
              ['Actual', budget.actual],
              ['Committed', budget.committed],
              ['Remaining', budget.remaining],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
                <dd className="mt-0.5 tabular-nums text-ink">
                  {value === null ? <span className="text-ink-muted">not set</span> : formatTHB(value as number)}
                </dd>
              </div>
            ))}
          </dl>
          {budget.utilisation !== null ? (
            <p className={`mt-3 border-t border-border pt-3 text-sm ${budget.utilisation > 100 ? 'text-critical' : 'text-ink-secondary'}`}>
              {budget.utilisation}% of the budget in force is spent or committed.
              {budget.utilisation > 100 ? ' This project is over its budget.' : ''}
            </p>
          ) : (
            <p className="mt-3 border-t border-border pt-3 text-sm text-ink-muted">
              No cost budget has been set for this project. Set one in Settings › Projects & Aliases.
            </p>
          )}
        </Card>
      ) : null}

      <div className="mt-6">
        <SectionLabel>Bank</SectionLabel>
      </div>
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
