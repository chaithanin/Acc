'use client';

import { CashflowChart } from '@/components/charts';
import { DataTable, type Column } from '@/components/data-table';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import type { CashflowMonth, CashflowProjection } from '@/lib/calc/cashflow';
import { formatMonth, formatTHB } from '@/lib/format/number';

export function CashflowView({ projection }: { projection: CashflowProjection }) {
  if (projection.months.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState
          title="No forecast months found"
          description="A projection needs either a cash-flow sheet, or income, expense and BOQ rows dated after the report date. Nothing in the imported files carried a future month."
        />
      </div>
    );
  }

  const columns: Column<CashflowMonth>[] = [
    {
      key: 'month',
      header: 'Month',
      value: (r) => r.month,
      render: (r) => formatMonth(r.month),
    },
    { key: 'opening', header: 'Opening Cash', numeric: true, value: (r) => r.openingCash },
    { key: 'income', header: 'Expected Income', numeric: true, value: (r) => r.expectedIncome },
    { key: 'expense', header: 'Expected Expense', numeric: true, value: (r) => r.expectedExpense },
    { key: 'net', header: 'Net Cash Flow', numeric: true, value: (r) => r.netCashFlow },
    { key: 'closing', header: 'Closing Cash', numeric: true, value: (r) => r.closingCash },
    {
      key: 'status',
      header: 'Status',
      value: (r) => r.status,
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: 'stated',
      header: 'Stated Closing (source)',
      numeric: true,
      value: (r) => r.statedClosing,
      defaultHidden: true,
    },
  ];

  return (
    <>
      <Card className="mt-6">
        <CardHeader
          title="Closing cash by month"
          subtitle="The zero line marks the point at which the group would need funding"
          action={
            projection.hasShortfall ? (
              <Badge tone="critical" icon={<span aria-hidden>▲</span>}>
                Shortfall — {formatTHB(projection.requiredFunding, 'millions')} required
              </Badge>
            ) : (
              <Badge tone="good" icon={<span aria-hidden>●</span>}>
                Positive throughout
              </Badge>
            )
          }
        />
        <CashflowChart
          data={projection.months.map((m) => ({ month: m.month, closingCash: m.closingCash }))}
        />
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="Monthly cash flow"
          subtitle="Closing cash is recalculated here; a closing figure stated in the source file is kept only for reconciliation and can be shown from the column selector."
        />
        <DataTable
          rows={projection.months}
          columns={columns}
          exportName="cash-flow-forecast"
          pageSize={36}
        />
      </Card>
    </>
  );
}

function StatusBadge({ status }: { status: CashflowMonth['status'] }) {
  // Icon plus label, never colour alone.
  if (status === 'shortfall') {
    return (
      <Badge tone="critical" icon={<span aria-hidden>▲</span>}>
        Shortfall
      </Badge>
    );
  }
  if (status === 'tight') {
    return (
      <Badge tone="warning" icon={<span aria-hidden>◆</span>}>
        Tight
      </Badge>
    );
  }
  return (
    <Badge tone="good" icon={<span aria-hidden>●</span>}>
      Healthy
    </Badge>
  );
}
