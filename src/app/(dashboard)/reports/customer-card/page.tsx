import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/primitives';
import { activeCompany, can, currentUser } from '@/lib/auth';
import { listReports } from '@/lib/db/repositories/customer-card-reports';
import { DEFAULT_OPTIONS } from '@/lib/reports/customer-card/types';
import { CustomerCardReport } from './customer-card-report';
import { ReportHistory } from './report-history';

/**
 * Customer Card Report.
 *
 * Turns the sales system's outstanding-receivable export into the
 * Interest / Advance-received workbook that Finance keeps by hand today —
 * installment plan, cash received, the selling-price assumption, and the
 * interest recognition that follows from them.
 *
 * Every run is kept — the workbook and what it said — so a report can be found
 * again without re-running it against a card Finance may no longer have. The
 * uploaded card itself is deleted once read; it is a list of buyers and what
 * they still owe, and the hash is enough to prove which file a report came
 * from.
 */
export default async function CustomerCardReportPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!can(user, 'import:run')) redirect('/');

  const company = await activeCompany();
  if (!company) redirect('/companies');

  const history = listReports(company.id, 50);

  return (
    <>
      <PageHeader
        title="Customer Card Report"
        description="Upload the ลูกหนี้คงค้าง customer card and get back the Interest / Advance-received workbook, reconciled unit by unit. Every run is kept."
      />
      <CustomerCardReport
        defaultProjectLabel={company.companyCode}
        defaultCompletionDate={DEFAULT_OPTIONS.completionDate}
        defaultUplift={DEFAULT_OPTIONS.maxUplift * 100}
      />
      <ReportHistory reports={history} canDelete={can(user, 'import:rollback')} />
    </>
  );
}
