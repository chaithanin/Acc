import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { activeCompany, can, currentUser } from '@/lib/auth';
import { getReportDetail } from '@/lib/db/repositories/customer-card-reports';
import { formatDate, formatDateTime, formatTHB } from '@/lib/format/number';
import { CheckTable } from './check-table';

/**
 * One report, as it was produced.
 *
 * The reconciliation is read from what the run recorded rather than
 * recalculated: the customer card it was made from may have changed since, and
 * a page that quietly answered differently from the workbook it sits beside
 * would be worse than no page.
 */
export default async function CustomerCardReportDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!can(user, 'import:run')) redirect('/');

  const company = await activeCompany();
  if (!company) redirect('/companies');

  // The id is from the URL, so it is looked up within this company. Another
  // company's report is not found, exactly as one that does not exist.
  const { id } = await params;
  const report = getReportDetail(company.id, id);
  if (!report) notFound();

  const figures: [string, string][] = [
    ['Units', String(report.units)],
    ['Contracts', String(report.contracts)],
    ['Source rows read', String(report.sourceRows)],
    ['Total net selling price', formatTHB(report.totalSalePrice)],
    ['Total expected selling price', formatTHB(report.totalExpected)],
    ['Total installment plan', formatTHB(report.totalPlan)],
    ['Total actual paid', formatTHB(report.totalPaid)],
    ['Total outstanding', formatTHB(report.totalOutstanding)],
    ['Total interest expense', formatTHB(report.totalInterest)],
  ];

  return (
    <>
      <PageHeader
        title={`${report.projectLabel} — as at ${formatDate(report.reportDate)}`}
        description={`Produced ${formatDateTime(report.createdAt)}${report.createdByName ? ` by ${report.createdByName}` : ''} from "${report.sourceFileName}".`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          href="/reports/customer-card"
          className="rounded-md border border-border-strong px-2.5 py-1.5 text-sm text-ink-secondary hover:bg-surface-hover"
        >
          ← All reports
        </Link>
        {report.fileExists ? (
          <a
            href={`/api/reports/customer-card/${report.id}`}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            Download the workbook
          </a>
        ) : (
          <span className="rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-sm text-warning">
            The workbook is no longer on disk — run it again from the card.
          </span>
        )}
        <Badge tone="good">{report.okCount} OK</Badge>
        {report.checkCount > 0 ? <Badge tone="warning">{report.checkCount} CHECK</Badge> : null}
        {report.errorCount > 0 ? <Badge tone="critical">{report.errorCount} ERROR</Badge> : null}
      </div>

      <Card>
        <CardHeader title="Totals" subtitle="As the run reported them" />
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {figures.map(([label, value]) => (
            <div
              key={label}
              className="flex items-baseline justify-between border-b border-border py-1.5"
            >
              <dt className="text-sm text-ink-secondary">{label}</dt>
              <dd className="tnum text-sm font-medium text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="What it was made from"
          subtitle="Enough to prove which file produced these figures"
        />
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {[
            ['Source file', report.sourceFileName],
            ['Sheet', `${report.sheetName ?? '—'}, header on row ${report.headerRow ?? '—'}`],
            ['SHA-256 of the card', report.sourceHash],
            ['Expected building completion', formatDate(report.completionDate)],
            ['Selling-price uplift', `${(report.maxUplift * 100).toFixed(2)}%`],
            ['Workbook size', `${(report.fileSize / 1024 / 1024).toFixed(2)} MB`],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-1.5">
              <dt className="text-ink-secondary">{label}</dt>
              <dd className="break-all font-mono text-xs text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="Still to be confirmed"
          subtitle="Assumptions the customer card does not contain"
        />
        <ul className="space-y-1.5 text-sm text-ink-secondary">
          {report.needsConfirmation.map((note) => (
            <li key={note} className="flex gap-2">
              <span aria-hidden className="text-warning">●</span>
              <span>{note}</span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="mt-4">
        <CheckTable checks={report.checks} issues={report.issues} />
      </div>
    </>
  );
}
