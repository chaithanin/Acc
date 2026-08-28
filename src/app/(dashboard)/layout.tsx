import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { activeCompany, currentUser, isGroupView } from '@/lib/auth';
import { companiesForUser } from '@/lib/db/repositories/companies';

/**
 * Every dashboard route sits behind this guard, so no financial page can be
 * reached without a session and without a scope — both checks are server-side
 * and cannot be skipped by navigating directly.
 *
 * The scope is resolved here on every request rather than trusted from the
 * session row, so access removed a moment ago takes effect on the next page
 * load and sends the user back to the chooser. That applies to the group view
 * as well: it is only a group view while the reader may still open every
 * company in it.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');

  const group = await isGroupView();
  const company = group ? null : await activeCompany();
  if (!group && !company) redirect('/companies');

  return (
    <AppShell
      user={user}
      company={company}
      group={group ? { companyCount: companiesForUser(user.id).length } : null}
    >
      {children}
    </AppShell>
  );
}
