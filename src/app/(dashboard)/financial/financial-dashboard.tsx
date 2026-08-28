'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CashLineChart, IncomeExpenseComboChart } from '@/components/financial/charts';
import { IncomeStatement, type StatementLine } from '@/components/financial/income-statement';
import { KpiTile, ProgressDial, RatioTile } from '@/components/financial/tiles';
import { FilterBar } from '@/components/filter-bar';
import { KPI_DEFINITIONS } from '@/config/kpi-definitions';
import { DrilldownTable, type DrilldownResponse } from '@/components/drilldown-table';
import { Modal } from '@/components/ui/controls';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/primitives';
import type { TARGETS, TARGET_LABELS } from '@/config/targets';
import type { DashboardContext } from '@/lib/dashboard/types';
import type { MonthPoint } from '@/lib/dashboard/queries';
import type { BudgetUtilisation } from '@/lib/db/repositories/budgets';
import { formatByUnit, formatDate, formatMonth, formatTHB, formatPercent } from '@/lib/format/number';
import type { MetricComparison } from '@/lib/types';

export function FinancialDashboard({
  context,
  metrics,
  series,
  hasSeries,
  incomeBudget,
  expenseBudget,
  month,
  targets,
  targetLabels,
  canEditBudget,
}: {
  context: DashboardContext;
  metrics: Record<string, MetricComparison | undefined>;
  series: MonthPoint[];
  hasSeries: boolean;
  incomeBudget: BudgetUtilisation;
  expenseBudget: BudgetUtilisation;
  month: string;
  targets: typeof TARGETS;
  targetLabels: typeof TARGET_LABELS;
  canEditBudget: boolean;
}) {
  const [drilldown, setDrilldown] = useState<{ metric: MetricComparison; data: DrilldownResponse | null } | null>(null);

  const open = async (metric: MetricComparison | undefined) => {
    if (!metric || !context.snapshot) return;
    setDrilldown({ metric, data: null });

    const params = new URLSearchParams({ snapshotId: context.snapshot.id, metricKey: metric.key });
    if (context.projectId) params.set('projectId', context.projectId);

    try {
      const response = await fetch(`/api/drilldown?${params}`);
      setDrilldown({ metric, data: await response.json() });
    } catch {
      setDrilldown({
        metric,
        data: { supported: false, label: '', rows: [], total: 0, error: 'The details could not be loaded.' },
      });
    }
  };

  /**
   * A snapshot imported by an earlier version of the engine will not carry
   * metrics added since. Rather than crash, those read as "not available" and
   * the banner below points at Recalculate, which regenerates them from the
   * stored records without re-reading a file.
   */
  const missing: string[] = [];
  const m = (key: string): MetricComparison => {
    const found = metrics[key];
    if (found) return found;
    if (!missing.includes(key)) missing.push(key);
    return placeholder(key);
  };

  if (!context.snapshot) {
    return (
      <>
        <PageHeader title="Financial Dashboard" />
        <EmptyState
          title="No financial data has been imported yet"
          description="Upload an Excel workbook or a ZIP of workbooks and every figure on this page fills itself in."
          action={
            <Link
              href="/import"
              className="inline-flex rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              Go to Data Import
            </Link>
          }
        />
      </>
    );
  }

  // The statement runs on revenue earned, not on the order book. The order
  // book sits above it as its own line so both are visible and neither is
  // mistaken for the other.
  const statement: StatementLine[] = [
    { label: 'Contracted Sale Value (order book)', value: m('contracted_sale_value')?.current ?? null },
    { label: 'Not yet earned', value: negate(m('revenue_backlog')?.current) },
    { label: 'Recognised Revenue', value: m('recognised_revenue')?.current ?? null, emphasis: true },
    { label: 'Cost of Sales', value: negate(m('cost_of_goods_sold')?.current) },
    { label: 'Gross Profit', value: m('gross_profit')?.current ?? null, emphasis: true },
    { label: 'Total Operating Expenses', value: negate(m('operating_expenses')?.current) },
    { label: 'Operating Profit (EBIT)', value: m('operating_profit')?.current ?? null, emphasis: true },
    { label: 'Taxes', value: negate(m('taxes')?.current) },
    { label: 'Net Profit', value: m('net_profit')?.current ?? null, emphasis: true },
  ];

  return (
    <>
      <PageHeader
        title="Financial Dashboard"
        description="Every figure is recalculated from the imported workbooks."
        action={
          <Badge tone="info">
            Last period with data: {formatDate(context.snapshot.reportDate)}
          </Badge>
        }
      />

      <StaleSnapshotNotice keys={missing} />

      <FilterBar
        snapshots={context.snapshots}
        snapshot={context.snapshot}
        previous={context.previous}
        projects={context.projects}
        projectId={context.projectId}
        company={context.company}
      />

      {/* KPI tiles arranged around the central margin dial. */}
      <section className="grid gap-3 xl:grid-cols-[1fr_auto_1fr]">
        <div className="grid gap-3 sm:grid-cols-2">
          <KpiTile metric={m('recognised_revenue')} title="Recognised Revenue" onOpen={() => open(m('recognised_revenue'))} />
          <KpiTile metric={m('total_expense')} title="Total Expenses" onOpen={() => open(m('total_expense'))} />
          <KpiTile metric={m('total_receivable_outstanding')} title="Accounts Receivable" onOpen={() => open(m('total_receivable_outstanding'))} />
          <KpiTile metric={m('total_outstanding_expense')} title="Accounts Payable" onOpen={() => open(m('total_outstanding_expense'))} />
        </div>

        <Card className="flex items-center justify-center xl:w-80">
          <ProgressDial
            value={m('net_profit_margin')?.current ?? null}
            target={targets.netProfitMargin}
            label="Net Profit Margin %"
            caption={
              m('net_profit_margin')?.current === null
                ? 'Not calculable until the project’s total sale value is set.'
                : `Net Profit ${formatTHB(m('net_profit')?.current ?? null, 'millions')}\n${formatPercent(m('net_profit_margin')?.differencePct ?? null, 1)} vs previous period`
            }
          />
        </Card>

        <div className="grid gap-3 sm:grid-cols-2">
          <KpiTile metric={m('net_profit')} title="Net Profit" onOpen={() => open(m('net_profit'))} />
          <KpiTile metric={m('available_cash')} title="Cash at end of period" onOpen={() => open(m('available_cash'))} />
          <RatioTile
            metric={m('quick_ratio')}
            target={targets.quickRatio}
            targetLabel={targetLabels.quickRatio}
            onOpen={() => open(m('quick_ratio'))}
          />
          <RatioTile
            metric={m('current_ratio')}
            target={targets.currentRatio}
            targetLabel={targetLabels.currentRatio}
            onOpen={() => open(m('current_ratio'))}
          />
        </div>
      </section>

      {/* Income vs expense, with the two budget dials beside it. */}
      <section className="mt-4 grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader
            title="Income and Expenses"
            subtitle={`By month across ${context.snapshot.reportDate.slice(0, 4)}`}
          />
          {hasSeries ? (
            <IncomeExpenseComboChart data={series} />
          ) : (
            <EmptyState
              title="No dated income or expense records"
              description="The imported files are balance-sheet ledgers, which carry no profit-and-loss lines. Import an income, expense or BOQ sheet and this chart fills in."
            />
          )}
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <BudgetDial
            title="Income budget for the month"
            utilisation={incomeBudget}
            tone="income"
            month={month}
            canEdit={canEditBudget}
          />
          <BudgetDial
            title="Expense budget for the month"
            utilisation={expenseBudget}
            tone="expense"
            month={month}
            canEdit={canEditBudget}
          />
        </div>
      </section>

      {/* Cash line and the statement. */}
      <section className="mt-4 grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader
            title="Cash at end of month"
            subtitle="Opening cash carried forward through each month's net movement"
          />
          {hasSeries ? (
            <CashLineChart data={series} />
          ) : (
            <EmptyState
              title="No monthly movements to project"
              description="Cash is carried forward from dated income and expense records; none were found in this import."
            />
          )}
        </Card>

        <Card>
          <CardHeader title="Income Statement" subtitle={formatMonth(month)} />
          <IncomeStatement lines={statement} totalIncome={m('recognised_revenue')?.current ?? null} />
        </Card>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Working capital"
            subtitle="What is held against what is owed. Not a statutory balance sheet — the imports carry no capital, borrowing or accumulated profit."
          />
          <dl className="space-y-2 text-sm">
            {[
              ['Current assets', m('current_assets')?.current ?? null],
              ['Current liabilities', negate(m('current_liabilities')?.current)],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-1.5">
                <dt className="text-ink-secondary">{label}</dt>
                <dd className="tabular-nums text-ink">{formatTHB(value as number | null)}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-4 pt-1">
              <dt className="font-medium text-ink">Working capital</dt>
              <dd className={`font-semibold tabular-nums ${(m('working_capital')?.current ?? 0) < 0 ? 'text-critical' : 'text-ink'}`}>
                {formatTHB(m('working_capital')?.current ?? null)}
              </dd>
            </div>
          </dl>
          {(m('working_capital')?.current ?? 0) < 0 ? (
            <p className="mt-3 text-sm text-critical">
              Today&rsquo;s obligations exceed today&rsquo;s assets. The business needs a facility or
              a collection before the next round of payments falls due.
            </p>
          ) : null}
        </Card>

        <Card>
          <CardHeader
            title="Cash flow by kind"
            subtitle={`Movements the records account for in ${formatMonth(month)} — what a treasurer reconciles against the bank statement.`}
          />
          <dl className="space-y-2 text-sm">
            {([
              { label: 'Operating', key: 'operating_cash_flow' },
              { label: 'Investing', key: 'investing_cash_flow' },
              { label: 'Financing', key: 'financing_cash_flow' },
            ] as const).map(({ label, key }) => {
              const value = m(key)?.current ?? null;
              return (
                <div key={label} className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-1.5">
                  <dt className="text-ink-secondary">{label}</dt>
                  <dd className={`tabular-nums ${value === null ? 'text-ink-muted' : value < 0 ? 'text-critical' : 'text-ink'}`}>
                    {value === null ? 'not calculable' : formatTHB(value)}
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="mt-3 text-xs text-ink-muted">
            Construction of units held for sale is operating, not investing: building what the
            business sells is what the business does, and the units are inventory rather than fixed
            assets. Financing is unknown rather than zero — no loan, dividend or capital record is
            imported, and reporting zero would claim the company neither borrowed nor repaid.
          </p>
        </Card>
      </section>

      <Modal
        open={drilldown !== null}
        onClose={() => setDrilldown(null)}
        title={`${drilldown?.metric.label ?? ''} — source records`}
        subtitle="Every row shows the file, sheet and cell it came from"
        wide
      >
        {drilldown ? (
          <>
            <div className="mb-4 rounded-lg bg-surface-sunken px-3 py-2 text-sm">
              {KPI_DEFINITIONS[drilldown.metric.key] ? (
                <p className="mb-2 text-ink-secondary">
                  {KPI_DEFINITIONS[drilldown.metric.key].meaning}{' '}
                  <span className="text-ink-muted">
                    Read from {KPI_DEFINITIONS[drilldown.metric.key].readsFrom.toLowerCase()}
                  </span>
                </p>
              ) : null}
              <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Formula</p>
              <p className="mt-0.5 font-mono text-[13px] text-ink">{drilldown.metric.formula}</p>
              <p className="tnum mt-2 text-ink-secondary">
                Current {formatByUnit(drilldown.metric.current, drilldown.metric.unit)} · Previous{' '}
                {formatByUnit(drilldown.metric.previous, drilldown.metric.unit)} · Change{' '}
                {formatPercent(drilldown.metric.differencePct)}
              </p>
            </div>
            {drilldown.data ? (
              <DrilldownTable data={drilldown.data} />
            ) : (
              <p className="text-sm text-ink-secondary">Loading…</p>
            )}
          </>
        ) : null}
      </Modal>
    </>
  );
}

/** A metric the current snapshot does not carry. Renders as "not available". */
function placeholder(key: string): MetricComparison {
  return {
    key,
    label: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    section: 'position',
    unit: 'THB',
    current: null,
    previous: null,
    difference: null,
    differencePct: null,
    formula: 'Not present in this snapshot — recalculate to generate it.',
    inputs: [],
  };
}

function StaleSnapshotNotice({ keys }: { keys: string[] }) {
  if (keys.length === 0) return null;
  return (
    <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-ink">
      <p className="font-medium">
        {keys.length} figure{keys.length === 1 ? '' : 's'} on this page were added after this snapshot
        was imported.
      </p>
      <p className="mt-0.5 text-ink-secondary">
        Run <Link href="/import/history" className="underline">Recalculate</Link> on this import to
        generate them from the stored records — no file needs re-uploading.
      </p>
    </div>
  );
}

/** Costs are shown as deductions, so they read as negative on the statement. */
function negate(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return value === 0 ? 0 : -value;
}

function BudgetDial({
  title,
  utilisation,
  tone,
  month,
  canEdit,
}: {
  title: string;
  utilisation: BudgetUtilisation;
  tone: 'income' | 'expense';
  month: string;
  canEdit: boolean;
}) {
  return (
    <Card className="flex flex-col items-center justify-center">
      {utilisation.percent === null ? (
        <div className="py-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{title}</p>
          <p className="mt-3 text-sm text-ink-secondary">No budget set for {formatMonth(month)}.</p>
          <p className="mt-1 text-xs text-ink-muted">
            Source workbooks carry no budget, so this dial stays empty until one is entered.
          </p>
          {canEdit ? (
            <Link
              href={`/settings/budget?month=${month}`}
              className="mt-3 inline-flex rounded-md border border-border-strong px-3 py-1.5 text-xs text-ink hover:bg-surface-hover"
            >
              Set a budget
            </Link>
          ) : null}
        </div>
      ) : (
        <ProgressDial
          value={utilisation.percent}
          label={title}
          tone={tone}
          size={150}
          caption={`Budget ${formatTHB(utilisation.budget, 'millions')}\nBalance ${formatTHB(utilisation.balance, 'millions')}`}
        />
      )}
    </Card>
  );
}
