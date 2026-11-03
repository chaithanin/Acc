import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/primitives';
import { can, currentUser } from '@/lib/auth';
import { ImportCenter } from './import-center';
import { ImportSourceList } from './source-list';

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
      {/*
        Above the upload box rather than below it: three of the files this page
        used to want are now read from the source system, and uploading them as
        well would double-count. That is worth reading before dropping a file,
        not after.
      */}
      <ImportSourceList />
      <ImportCenter />
    </>
  );
}
