'use client';

import { CategoryBarChart } from '@/components/charts';
import { DataTable, type Column } from '@/components/data-table';
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import type { AccountSummaryRow, LedgerTableRow } from '@/lib/dashboard/queries';
import { formatDate } from '@/lib/format/number';

export function LedgerView({
  accounts,
  entries,
  totalEntries,
  truncated,
}: {
  accounts: AccountSummaryRow[];
  entries: LedgerTableRow[];
  /** Postings in this period, which may exceed the rows loaded. */
  totalEntries: number;
  truncated: boolean;
}) {
  const accountColumns: Column<AccountSummaryRow>[] = [
    { key: 'project', header: 'Company', value: (r) => r.projectName ?? 'Unassigned' },
    { key: 'code', header: 'Account Code', value: (r) => r.accountCode ?? '—' },
    { key: 'name', header: 'Account Name', value: (r) => r.accountName ?? '—' },
    { key: 'movement', header: 'Movement (period)', numeric: true, value: (r) => r.currentPeriod },
    { key: 'closing', header: 'Closing Balance', numeric: true, value: (r) => r.closing },
  ];

  const entryColumns: Column<LedgerTableRow>[] = [
    {
      key: 'date',
      header: 'Date',
      value: (r) => r.entryDate ?? '',
      render: (r) => (r.entryDate ? formatDate(r.entryDate) : '—'),
    },
    { key: 'voucher', header: 'Voucher No.', value: (r) => r.voucherNo ?? '—' },
    { key: 'account', header: 'Account', value: (r) => r.accountCode ?? '—' },
    { key: 'vendor', header: 'Vendor / Customer', value: (r) => r.vendor ?? '—' },
    {
      key: 'description',
      header: 'Description',
      value: (r) => r.description ?? '—',
      // Ledger descriptions run to several hundred characters; left unbounded
      // they push Debit, Credit and Balance off the visible area entirely.
      render: (r) => (
        <span className="block max-w-80 truncate" title={r.description ?? undefined}>
          {r.description ?? '—'}
        </span>
      ),
    },
    { key: 'costCode', header: 'Cost Code', value: (r) => r.costCode ?? '—', defaultHidden: true },
    { key: 'debit', header: 'Debit', numeric: true, value: (r) => r.debit },
    { key: 'credit', header: 'Credit', numeric: true, value: (r) => r.credit },
    { key: 'balance', header: 'Balance', numeric: true, value: (r) => r.balance },
    { key: 'project', header: 'Company', value: (r) => r.projectName ?? 'Unassigned', defaultHidden: true },
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

  // Several companies use the same account code, so the label has to carry the
  // company too or two different balances look like one account twice.
  const byAccount = accounts
    .map((a) => ({
      label: `${a.projectName ?? 'Unassigned'} · ${a.accountCode ?? '—'}`,
      value: a.closing,
    }))
    .filter((a) => a.value !== 0);

  if (accounts.length === 0 && entries.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState
          title="No ledger data for this period"
          description="Import a GL report and its accounts and postings will appear here. The reader recognises the export by its columns, so the sheet name does not matter."
        />
      </div>
    );
  }

  return (
    <>
      <Card className="mt-6">
        <CardHeader
          title="Closing balance by account"
          subtitle="Advance and deposit accounts still to be cleared"
        />
        {byAccount.length > 0 ? (
          <CategoryBarChart data={byAccount} horizontal seriesIndex={2} />
        ) : (
          <EmptyState title="No account balances" description="Nothing to chart." />
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="Account summary"
          subtitle="Movement for the period and the closing balance, recomputed from the postings rather than read from the report footer"
        />
        <DataTable rows={accounts} columns={accountColumns} exportName="ledger-accounts" />
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="Ledger postings"
          subtitle={
            truncated
              ? `${totalEntries.toLocaleString()} transactions in this period; the ${entries.length.toLocaleString()} most recent are listed. Enable the source columns to trace any line back to its cell.`
              : `${totalEntries.toLocaleString()} transactions. Enable the source columns to trace any line back to its cell.`
          }
        />
        <DataTable
          rows={entries}
          columns={entryColumns}
          exportName="ledger-postings"
          pageSize={50}
          initialSort={{ key: 'date', direction: 'asc' }}
        />
      </Card>
    </>
  );
}
