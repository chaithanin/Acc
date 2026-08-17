import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/primitives';
import { can, currentUser } from '@/lib/auth';
import { ImportCenter } from './import-center';

/** Data Import (requirement 13). */
export default async function ImportPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!can(user, 'import:run')) redirect('/');

  return (
    <>
      <PageHeader
        title="Data Import"
        description="Upload financial workbooks. Everything is parsed and previewed before anything is saved, and the original files are never modified."
      />
      <ImportCenter />
    </>
  );
}
