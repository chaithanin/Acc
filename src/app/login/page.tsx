import { redirect } from 'next/navigation';
import { currentUser, purgeExpiredSessions, signIn } from '@/lib/auth';
import { bootstrapDatabase } from '@/lib/db/bootstrap';

/**
 * Sign-in. Financial data is never served without a session (requirement 30).
 *
 * A first run also seeds the database here, so a fresh deployment has projects,
 * templates and an admin account without a separate command.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const seed = bootstrapDatabase();
  purgeExpiredSessions();

  if (await currentUser()) redirect('/');

  const { error } = await searchParams;

  async function authenticate(formData: FormData) {
    'use server';

    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');

    const user = await signIn(email, password);
    // The message stays vague on purpose: saying which half was wrong tells an
    // attacker which addresses exist.
    if (!user) redirect('/login?error=1');
    redirect('/');
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-lg font-semibold tracking-tight text-ink">Global Top Group</h1>
          <p className="mt-1 text-sm text-ink-secondary">Financial Management Dashboard</p>
        </div>

        <form
          action={authenticate}
          className="rounded-[var(--radius-card)] border border-border bg-surface p-6"
        >
          <div className="space-y-4">
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                Email
              </span>
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
                autoFocus
                className="mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-ink"
              />
            </label>

            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                Password
              </span>
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-ink"
              />
            </label>
          </div>

          {error ? (
            <p className="mt-4 rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-xs text-critical">
              Those details were not recognised.
            </p>
          ) : null}

          <button
            type="submit"
            className="mt-5 w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Sign in
          </button>
        </form>

        {seed.createdAdmin ? (
          <div className="mt-4 rounded-[var(--radius-card)] border border-warning/40 bg-warning/10 p-4 text-xs text-ink">
            <p className="font-semibold">An administrator account was just created.</p>
            <p className="mt-1.5">
              Email <span className="font-mono">{seed.createdAdmin.email}</span>
              <br />
              Password <span className="font-mono">{seed.createdAdmin.password}</span>
            </p>
            <p className="mt-1.5 text-ink-secondary">
              This is shown once. Sign in and change it straight away.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
