import { PageHeader } from '@/components/ui/primitives';
import { activeCompany, can, currentUser } from '@/lib/auth';
import { listImports } from '@/lib/db/repositories/imports';
import { redirect } from 'next/navigation';
import { HistoryTable } from './history-table';

/** Import History (requirement 24). */
export default async function ImportHistoryPage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  // History is per company. Without this the page would list every company's
  // uploads — file names, project labels and upload times included — to anyone
  // who can reach it.
  const company = await activeCompany();
  if (!company) redirect('/companies');

  const imports = listImports(company.id);

  return (
    <>
      <PageHeader
        title="Import History"
        description="Every import that has been run, what it produced, and what can still be done with it."
      />
      <HistoryTable imports={imports} canManage={can(user, 'import:rollback')} />
    </>
  );
}
