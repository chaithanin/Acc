import { PageHeader } from '@/components/ui/primitives';
import { can, currentUser } from '@/lib/auth';
import { listImports } from '@/lib/db/repositories/imports';
import { redirect } from 'next/navigation';
import { HistoryTable } from './history-table';

/** Import History (requirement 24). */
export default async function ImportHistoryPage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const imports = listImports();

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
