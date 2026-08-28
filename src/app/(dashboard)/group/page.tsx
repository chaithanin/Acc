import { redirect } from 'next/navigation';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/primitives';
import { currentUser, isGroupView } from '@/lib/auth';
import { groupFigures } from '@/lib/db/repositories/group';
import { formatDate, formatTHB } from '@/lib/format/number';
import { KPI_DEFINITIONS } from '@/config/kpi-definitions';

/**
 * The group.
 *
 * Built by reading each company the user is granted, one at a time, with the
 * same scoped queries every other page uses, and adding the results up. No
 * query crosses a company boundary — a user granted three of six would see the
 * total of three, and the page says which companies are in it.
 *
 * Trade between two companies in the consolidation is removed once. A
 * management fee charged by one subsidiary to another is an expense in one set
 * of books and income in the other; both are correct, and adding them produces
 * a group that has earned money from itself.
 */

const HEADLINE: { key: string; label: string }[] = [
  { key: 'bank_current_amount', label: 'Cash in the bank' },
  { key: 'available_cash', label: 'Available cash' },
  { key: 'total_receivable_outstanding', label: 'Owed to the group' },
  { key: 'receivable_overdue', label: 'Of which overdue' },
  { key: 'total_owed', label: 'Owed by the group' },
  { key: 'payable_overdue', label: 'Of which overdue' },
  { key: 'recognised_revenue', label: 'Revenue earned' },
  { key: 'net_profit', label: 'Net profit' },
];

const PER_COMPANY: { key: string; label: string }[] = [
  { key: 'bank_current_amount', label: 'Cash' },
  { key: 'total_receivable_outstanding', label: 'Receivable' },
  { key: 'accounts_payable', label: 'Payable' },
  { key: 'recognised_revenue', label: 'Revenue' },
  { key: 'net_profit', label: 'Net profit' },
];

export default async function GroupPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!(await isGroupView())) redirect('/companies');

  const group = groupFigures(user.id);
  const value = (key: string) => group.values.get(key) ?? null;

  return (
    <>
      <PageHeader
        title="Group"
        description={`${group.companies.length} companies, consolidated. Trade between them is removed once rather than counted twice.`}
        action={
          group.newestReportDate ? (
            <Badge tone={group.newestReportDate === group.oldestReportDate ? 'info' : 'warning'}>
              {group.newestReportDate === group.oldestReportDate
                ? formatDate(group.newestReportDate)
                : `${formatDate(group.oldestReportDate!)} – ${formatDate(group.newestReportDate)}`}
            </Badge>
          ) : null
        }
      />

      {group.companies.length === 0 ? (
        <EmptyState
          title="No company in the group has imported anything yet"
          description="The group total is the sum of each company's live snapshot. Import a workbook for at least one company and this fills in."
        />
      ) : (
        <>
          {group.newestReportDate !== group.oldestReportDate ? (
            <p className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              These companies are not all reporting the same month. The oldest is{' '}
              {formatDate(group.oldestReportDate!)} and the newest is{' '}
              {formatDate(group.newestReportDate!)}, so this total mixes periods. Import the missing
              months before taking a decision on it.
            </p>
          ) : null}

          {group.withoutData.length > 0 ? (
            <p className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              Not in this total: {group.withoutData.map((c) => c.displayName).join(', ')}. Nothing
              has been imported for {group.withoutData.length === 1 ? 'it' : 'them'}.
            </p>
          ) : null}

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {HEADLINE.map(({ key, label }) => (
              <Card key={key}>
                <div className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                  {label}
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-ink">
                  {formatTHB(value(key))}
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  {KPI_DEFINITIONS[key]?.meaning ?? ''}
                </p>
              </Card>
            ))}
          </section>

          <Card className="mt-4">
            <CardHeader
              title="By company"
              subtitle="Before elimination — each column is that company's own books."
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-ink-muted">
                    <th className="py-2 pr-3 font-medium">Company</th>
                    <th className="py-2 pr-3 font-medium">As at</th>
                    {PER_COMPANY.map((c) => (
                      <th key={c.key} className="py-2 pr-3 text-right font-medium">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.companies.map((company) => (
                    <tr key={company.companyId} className="border-b border-border/60">
                      <td className="py-2 pr-3 text-ink">{company.displayName}</td>
                      <td className="py-2 pr-3 text-ink-secondary">
                        {company.reportDate ? formatDate(company.reportDate) : '—'}
                      </td>
                      {PER_COMPANY.map((c) => (
                        <td key={c.key} className="py-2 pr-3 text-right tabular-nums text-ink">
                          {formatTHB(company.values.get(c.key) ?? null)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="mt-4">
            <CardHeader
              title="Eliminated"
              subtitle="Trade between two companies in this consolidation, removed once."
            />
            {group.eliminations.length === 0 ? (
              <p className="text-sm text-ink-secondary">
                No transaction in any company&rsquo;s books names another company in this group as
                its counterparty, so nothing has been eliminated. If the group does trade with
                itself, the vendor and customer names in the imported files are not being recognised
                — check them against the company names in Settings.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-ink-muted">
                      <th className="py-2 pr-3 font-medium">Figure</th>
                      <th className="py-2 pr-3 text-right font-medium">Sum of companies</th>
                      <th className="py-2 pr-3 text-right font-medium">Intercompany</th>
                      <th className="py-2 pr-3 text-right font-medium">Group</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.eliminations.map((e) => (
                      <tr key={e.metricKey} className="border-b border-border/60">
                        <td className="py-2 pr-3 text-ink">{e.metricKey}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ink-secondary">{formatTHB(e.gross)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-critical">−{formatTHB(e.amount)}</td>
                        <td className="py-2 pr-3 text-right font-medium tabular-nums text-ink">{formatTHB(e.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {group.mismatches.length > 0 ? (
            <Card className="mt-4">
              <CardHeader
                title="Intercompany balances that do not agree"
                subtitle="One company's receivable should equal the other's payable. These do not."
              />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-ink-muted">
                      <th className="py-2 pr-3 font-medium">Owed to</th>
                      <th className="py-2 pr-3 font-medium">Owed by</th>
                      <th className="py-2 pr-3 text-right font-medium">Receivable</th>
                      <th className="py-2 pr-3 text-right font-medium">Payable</th>
                      <th className="py-2 pr-3 text-right font-medium">Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.mismatches.map((m) => (
                      <tr key={`${m.fromCompany}-${m.toCompany}`} className="border-b border-border/60">
                        <td className="py-2 pr-3 text-ink">{m.fromCompany}</td>
                        <td className="py-2 pr-3 text-ink">{m.toCompany}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ink-secondary">{formatTHB(m.receivable)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ink-secondary">{formatTHB(m.payable)}</td>
                        <td className="py-2 pr-3 text-right font-medium tabular-nums text-critical">{formatTHB(m.difference)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-sm text-ink-secondary">
                The two sides of an intercompany balance are recorded independently, in different
                books, often by different people. When they disagree the group has a real problem,
                and netting the difference away silently is how it stays hidden for a year.
              </p>
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}
