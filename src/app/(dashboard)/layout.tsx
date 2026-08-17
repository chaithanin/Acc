import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { activeCompany, currentUser } from '@/lib/auth';

/**
 * Every dashboard route sits behind this guard, so no financial page can be
 * reached without a session and without a company — both checks are
 * server-side and cannot be skipped by navigating directly.
 *
 * The company is resolved here on every request rather than trusted from the
 * session row, so access removed a moment ago takes effect on the next page
 * load and sends the user back to the chooser.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');

  const company = await activeCompany();
  if (!company) redirect('/companies');

  return (
    <AppShell user={user} company={company}>
      {children}
    </AppShell>
  );
}
