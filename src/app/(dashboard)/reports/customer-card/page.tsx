import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/primitives';
import { activeCompany, can, currentUser } from '@/lib/auth';
import { DEFAULT_OPTIONS } from '@/lib/reports/customer-card/types';
import { CustomerCardReport } from './customer-card-report';

/**
 * Customer Card Report.
 *
 * Turns the sales system's outstanding-receivable export into the
 * Interest / Advance-received workbook that Finance keeps by hand today —
 * installment plan, cash received, the selling-price assumption, and the
 * interest recognition that follows from them.
 *
 * Nothing is saved. The uploaded card is read, the workbook is handed back, and
 * the card is deleted; it is a list of buyers and what they still owe, and this
 * report has no reason to keep one.
 */
export default async function CustomerCardReportPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!can(user, 'import:run')) redirect('/');

  const company = await activeCompany();
  if (!company) redirect('/companies');

  return (
    <>
      <PageHeader
        title="Customer Card Report"
        description="Upload the ลูกหนี้คงค้าง customer card and get back the Interest / Advance-received workbook, reconciled unit by unit."
      />
      <CustomerCardReport
        defaultProjectLabel={company.companyCode}
        defaultCompletionDate={DEFAULT_OPTIONS.completionDate}
        defaultUplift={DEFAULT_OPTIONS.maxUplift * 100}
      />
    </>
  );
}
