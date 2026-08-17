import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { currentUser } from '@/lib/auth';

/**
 * Every dashboard route sits behind this guard, so no financial page can be
 * reached without a session — the check is server-side and cannot be skipped
 * by navigating directly.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');

  return <AppShell user={user}>{children}</AppShell>;
}
