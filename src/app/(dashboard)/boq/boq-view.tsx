'use client';

import { useMemo } from 'react';
import { AccumulationChart, CategoryBarChart, PairedBarChart } from '@/components/charts';
import { DataTable, type Column } from '@/components/data-table';
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import type { BoqTableRow } from '@/lib/dashboard/queries';
import { formatMonth } from '@/lib/format/number';

export function BoqView({ rows }: { rows: BoqTableRow[] }) {
  const byContractor = useMemo(() => {
    const map = new Map<string, { plan: number; paid: number }>();
    for (const row of rows) {
      const key = row.contractor ?? row.costCategory ?? 'Unassigned';
      const entry = map.get(key) ?? { plan: 0, paid: 0 };
      entry.plan += row.boqAmount;
      entry.paid += row.paidAmount;
      map.set(key, entry);
    }
    return [...map.entries()]
      .map(([label, v]) => ({ label, a: v.plan, b: v.paid }))
      .sort((x, y) => y.a - x.a)
      .slice(0, 12);
  }, [rows]);

  const byMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (!row.month) continue;
      map.set(row.month, (map.get(row.month) ?? 0) + row.outstanding);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  const monthlyRequirement = byMonth.map(([month, value]) => ({
    label: formatMonth(month),
    value,
  }));

  // Running total of committed construction cost across the months present.
  const accumulated = useMemo(() => {
    let running = 0;
    return byMonth.map(([month, value]) => {
      running += value;
      return { label: month, value: running };
    });
  }, [byMonth]);

  const columns: Column<BoqTableRow>[] = [
    { key: 'project', header: 'Project', value: (r) => r.projectName ?? 'Unassigned' },
    { key: 'description', header: 'Item', value: (r) => r.description ?? '—' },
    { key: 'contractor', header: 'Contractor', value: (r) => r.contractor ?? '—' },
    { key: 'category', header: 'Cost Category', value: (r) => r.costCategory ?? '—' },
    {
      key: 'month',
      header: 'Month',
      value: (r) => r.month ?? '',
      render: (r) => (r.month ? formatMonth(r.month) : '—'),
    },
    { key: 'boq', header: 'BOQ Total', numeric: true, value: (r) => r.boqAmount },
    { key: 'toDate', header: 'To Date', numeric: true, value: (r) => r.boqToDate },
    { key: 'paid', header: 'Paid', numeric: true, value: (r) => r.paidAmount },
    { key: 'outstanding', header: 'Outstanding', numeric: true, value: (r) => r.outstanding },
    { key: 'file', header: 'Source File', value: (r) => r.sourceFile ?? '—', defaultHidden: true },
    { key: 'sheet', header: 'Sheet', value: (r) => r.sourceSheet ?? '—', defaultHidden: true },
    {
      key: 'cell',
      header: 'Cell',
      value: (r) => r.sourceCell ?? '—',
      render: (r) => <span className="font-mono text-xs">{r.sourceCell ?? '—'}</span>,
      defaultHidden: true,
    },
  ];

  if (rows.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState
          title="No BOQ records for this period"
          description="Import a BOQ or construction cost sheet and this dashboard will populate. Sheets are recognised by their headers, so the tab name does not need to match anything in particular."
        />
      </div>
    );
  }

  return (
    <>
      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="BOQ plan vs paid" subtitle="Top contractors by contract value" />
          {byContractor.length > 0 ? (
            <PairedBarChart data={byContractor} aLabel="BOQ Total" bLabel="Paid" />
          ) : (
            <EmptyState title="No contractor breakdown" description="BOQ rows carry no contractor." />
          )}
        </Card>

        <Card>
          <CardHeader
            title="Monthly construction cash requirement"
            subtitle="Outstanding BOQ falling due in each month"
          />
          {monthlyRequirement.length > 0 ? (
            <CategoryBarChart data={monthlyRequirement} seriesIndex={1} />
          ) : (
            <EmptyState title="No dated BOQ rows" description="BOQ rows carry no month." />
          )}
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Accumulated construction commitment" />
          {accumulated.length > 0 ? (
            <AccumulationChart data={accumulated} name="Accumulated" />
          ) : (
            <EmptyState title="No dated BOQ rows" description="BOQ rows carry no month." />
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="BOQ detail" subtitle="Grouped by cost category, with subtotals" />
        <DataTable rows={rows} columns={columns} groupBy="category" exportName="boq-detail" />
      </Card>
    </>
  );
}
