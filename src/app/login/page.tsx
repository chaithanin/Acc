import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { attemptSignIn, currentUser, purgeExpiredSessions } from '@/lib/auth';
import { describeWait } from '@/lib/auth/throttle';
import { writeAudit } from '@/lib/db/repositories/audit';

/**
 * The caller's address, as far as it can be known.
 *
 * Behind the reverse proxy the socket address is the proxy's, so the
 * forwarded header is read first and only its first entry is used — the rest
 * are whatever the caller chose to send. When nothing is knowable the sign-in
 * rate limit falls back to counting against the address typed alone.
 */
async function clientAddress(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim() || null;
  return h.get('x-real-ip')?.trim() || null;
}

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
  searchParams: Promise<{ error?: string; changed?: string; wait?: string }>;
}) {
  purgeExpiredSessions();

  if (await currentUser()) redirect('/');

  const { error, changed, wait } = await searchParams;

  async function authenticate(formData: FormData) {
    'use server';

    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');

    const result = await attemptSignIn(email, password, await clientAddress());

    if (!result.ok && result.reason === 'throttled') {
      // Saying how long is not a disclosure — it happens to an address that
      // exists and one that does not alike — and without it the form looks
      // broken rather than protective.
      redirect(`/login?wait=${encodeURIComponent(describeWait(result.retryAfterSeconds))}`);
    }
    // The message stays vague on purpose: saying which half was wrong tells an
    // attacker which addresses exist.
    if (!result.ok) redirect('/login?error=1');

    // Written directly rather than through the request-scoped helper: the
    // session cookie was set moments ago in this same response and is not yet
    // readable back, so the actor is taken from what signing in returned.
    writeAudit({
      actorId: result.user.id,
      actorEmail: result.user.email,
      actorRole: result.user.role,
      action: 'session.sign_in',
      entity: 'session',
      summary: `${result.user.email} signed in`,
      ip: await clientAddress(),
    });

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

          {wait ? (
            <p className="mt-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              Too many attempts. Try again in {wait}.
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
