import { redirect } from 'next/navigation';
import { currentUser, purgeExpiredSessions, signIn } from '@/lib/auth';

/**
 * Sign-in. Financial data is never served without a session (requirement 30).
 *
 * Seeding happens at server startup, not here. Rendering a public page must
 * not be what creates the first administrator, and this page must never show
 * a credential — the two go together, since the reason to display one was that
 * this render was the only place it existed.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; changed?: string }>;
}) {
  purgeExpiredSessions();

  if (await currentUser()) redirect('/');

  const { error, changed } = await searchParams;

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

          {changed ? (
            <p className="mb-4 rounded-md border border-good/30 bg-good/10 px-3 py-2 text-xs text-good">
              Your password was changed. Sign in with the new one.
            </p>
          ) : null}

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

      </div>
    </div>
  );
}
