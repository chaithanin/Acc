'use client';

import { CashflowChart, IncomeExpenseChart, PairedBarChart } from '@/components/charts';
import { DataTable, type Column } from '@/components/data-table';
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import type { CashflowProjection } from '@/lib/calc/cashflow';
import type { DatasetSummary, ProjectMetricRow } from '@/lib/dashboard/queries';
import { formatMonth } from '@/lib/format/number';

export function ProjectView({
  projection,
  byProject,
  summary,
  focused,
}: {
  projection: CashflowProjection;
  byProject: ProjectMetricRow[];
  summary: DatasetSummary;
  focused: boolean;
}) {
  const columns: Column<ProjectMetricRow>[] = [
    { key: 'project', header: 'Project', value: (r) => r.projectName },
    { key: 'cash', header: 'Available Cash', numeric: true, value: (r) => r.availableCash },
    { key: 'receivable', header: 'Receivable Outstanding', numeric: true, value: (r) => r.receivableOutstanding },
    { key: 'boq', header: 'BOQ Outstanding', numeric: true, value: (r) => r.boqOutstanding },
    { key: 'advance', header: 'Advances & Deposits', numeric: true, value: (r) => r.advanceOutstanding },
  ];

  const comparison = byProject.map((row) => ({
    label: row.projectName,
    a: row.receivableOutstanding,
    b: row.boqOutstanding,
  }));

  return (
    <div className="mt-6 grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title="Income vs Expense by month" />
        {summary.incomeByMonth.length > 0 ? (
          <IncomeExpenseChart
            data={summary.incomeByMonth.map((row) => ({
              label: formatMonth(row.label),
              income: row.income,
              expense: row.expense,
            }))}
          />
        ) : (
          <EmptyState title="No dated income or cost records" description="Nothing to plot over time." />
        )}
      </Card>

      <Card>
        <CardHeader title="Cash flow forecast" />
        {projection.months.length > 0 ? (
          <CashflowChart
            data={projection.months.map((m) => ({ month: m.month, closingCash: m.closingCash }))}
          />
        ) : (
          <EmptyState title="No forecast months" description="Nothing dated after the report date." />
        )}
      </Card>

      {!focused && comparison.length > 0 ? (
        <Card className="xl:col-span-2">
          <CardHeader
            title="Receivable and BOQ outstanding by project"
            subtitle="Two measures on one scale — both are amounts in baht"
          />
          <PairedBarChart data={comparison} aLabel="Receivable Outstanding" bLabel="BOQ Outstanding" />
        </Card>
      ) : null}

      <Card className="xl:col-span-2">
        <CardHeader title="Project comparison" />
        <DataTable
          rows={byProject}
          columns={columns}
          exportName="project-comparison"
          emptyMessage="No project-level figures. Imported records may not have matched a project alias."
        />
      </Card>
    </div>
  );
}
