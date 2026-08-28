import { TARGETS, TARGET_LABELS } from '@/config/targets';
import { FinancialDashboard } from './financial-dashboard';
import { loadDashboard, pickMetrics } from '@/lib/dashboard/context';
import { getMonthlySeries, hasMonthlyData } from '@/lib/dashboard/queries';
import { getBudget, utilisation } from '@/lib/db/repositories/budgets';
import { can, currentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';

/**
 * Financial Dashboard — the executive landing page.
 *
 * Everything on it is computed from imported records; nothing is hard-coded.
 * Where a figure genuinely cannot be derived (a budget, which no source
 * workbook contains) the panel says so and offers the way to supply it.
 */
export default async function FinancialDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');

  const params = await searchParams;
  const context = await loadDashboard(params);

  const keys = [
    'total_contractual_income',
    'contracted_sale_value',
    'recognised_revenue',
    'revenue_backlog',
    'completion_percent',
    'period_income',
    'period_expense',
    'total_expense',
    'total_receivable_outstanding',
    'total_outstanding_expense',
    'net_profit',
    'available_cash',
    'quick_ratio',
    'current_ratio',
    'net_profit_margin',
    'cost_of_goods_sold',
    'gross_profit',
    'operating_expenses',
    'operating_profit',
    'taxes',
  ];

  const metrics = new Map(pickMetrics(context, keys).map((m) => [m.key, m]));

  const reportDate = context.snapshot?.reportDate ?? '';
  const month = reportDate.slice(0, 7);

  const series = context.scope
    ? getMonthlySeries(context.scope, reportDate, metrics.get('available_cash')?.current ?? 0)
    : [];

  const budget = context.scope
    ? getBudget(context.scope.companyId, month, context.scope.projectId)
    : null;

  // The budget is a figure for one month, so it is compared with the month —
  // not with the contracted balance of every sale the project has ever made.
  // Dividing the second into the first read 18,873% on real volumes.
  const incomeBudget = utilisation(
    budget?.incomeBudget ?? null,
    metrics.get('period_income')?.current ?? 0,
  );
  const expenseBudget = utilisation(
    budget?.expenseBudget ?? null,
    metrics.get('period_expense')?.current ?? 0,
  );

  return (
    <FinancialDashboard
      context={context}
      metrics={Object.fromEntries(metrics)}
      series={series}
      hasSeries={hasMonthlyData(series)}
      incomeBudget={incomeBudget}
      expenseBudget={expenseBudget}
      month={month}
      targets={TARGETS}
      targetLabels={TARGET_LABELS}
      canEditBudget={can(user, 'mapping:edit')}
    />
  );
}
