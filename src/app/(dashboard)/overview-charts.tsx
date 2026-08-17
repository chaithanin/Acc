'use client';

import {
  CashflowChart,
  CategoryBarChart,
  IncomeExpenseChart,
  ReceivedDonut,
} from '@/components/charts';
import { DataTable, type Column } from '@/components/data-table';
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import type { CashflowProjection } from '@/lib/calc/cashflow';
import type { DatasetSummary, ProjectMetricRow } from '@/lib/dashboard/queries';
import { formatMonth } from '@/lib/format/number';

/**
 * Overview charts.
 *
 * Each chart is paired with the same figures as a table — required by the
 * spec, and also the relief that the light-mode palette's low-contrast slot
 * depends on for accessibility.
 */
export function OverviewCharts({
  projection,
  byProject,
  summary,
}: {
  projection: CashflowProjection;
  byProject: ProjectMetricRow[];
  summary: DatasetSummary;
}) {
  const cashflowData = projection.months.map((m) => ({
    month: m.month,
    closingCash: m.closingCash,
  }));

  const projectColumns: Column<ProjectMetricRow>[] = [
    { key: 'project', header: 'Project', value: (r) => r.projectName },
    { key: 'cash', header: 'Available Cash', numeric: true, value: (r) => r.availableCash },
    { key: 'receivable', header: 'Receivable Outstanding', numeric: true, value: (r) => r.receivableOutstanding },
    { key: 'boq', header: 'BOQ Outstanding', numeric: true, value: (r) => r.boqOutstanding },
    { key: 'advance', header: 'Advances', numeric: true, value: (r) => r.advanceOutstanding },
  ];

  return (
    <div className="mt-6 grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader
          title="Income vs Expense by month"
          subtitle="Contractual income against committed cost, from the imported records"
        />
        {summary.incomeByMonth.length > 0 ? (
          <IncomeExpenseChart
            data={summary.incomeByMonth.map((row) => ({
              label: formatMonth(row.label),
              income: row.income,
              expense: row.expense,
            }))}
          />
        ) : (
          <EmptyState
            title="No dated income or expense records"
            description="The imported files carry no month on their income or cost lines, so there is nothing to plot over time."
          />
        )}
      </Card>

      <Card>
        <CardHeader
          title="Cash flow forecast"
          subtitle={
            projection.hasShortfall
              ? `Closing cash falls below zero in ${formatMonth(projection.lowestMonth)}`
              : 'Closing cash by month, recalculated from the forecast inputs'
          }
        />
        {cashflowData.length > 0 ? (
          <CashflowChart data={cashflowData} />
        ) : (
          <EmptyState
            title="No forecast months found"
            description="Import a cash-flow sheet, or records dated after the report date, and the projection appears here."
          />
        )}
      </Card>

      <Card>
        <CardHeader title="Receivable — received vs outstanding" subtitle="Across all categories" />
        {summary.receivedTotal + summary.outstandingTotal > 0 ? (
          <ReceivedDonut received={summary.receivedTotal} outstanding={summary.outstandingTotal} />
        ) : (
          <EmptyState title="No receivable records" description="Nothing to break down yet." />
        )}
      </Card>

      <Card>
        <CardHeader title="Outstanding by receivable type" />
        {summary.receivableByCategory.length > 0 ? (
          <CategoryBarChart data={summary.receivableByCategory} horizontal />
        ) : (
          <EmptyState title="No receivable records" description="Nothing to break down yet." />
        )}
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader
          title="Project comparison"
          subtitle="The same figures as the chart above, exportable and drillable"
        />
        {byProject.length > 0 ? (
          <DataTable
            rows={byProject}
            columns={projectColumns}
            exportName="project-comparison"
            pageSize={20}
            initialSort={{ key: 'receivable', direction: 'desc' }}
          />
        ) : (
          <EmptyState
            title="No project-level figures"
            description="Imported records were not attributed to a project. Check the project aliases under Settings."
          />
        )}
      </Card>
    </div>
  );
}
