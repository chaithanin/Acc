import { redirect } from 'next/navigation';
import { Card, CardHeader, PageHeader, Stat } from '@/components/ui/primitives';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, currentUser, signOut } from '@/lib/auth';
import { writeAudit } from '@/lib/db/repositories/audit';
import { findUserByEmail, setUserPassword, verifyPassword } from '@/lib/db/repositories/users';
import { MIN_PASSWORD, passwordTooShort } from '@/config/password-policy';
import { formatDate } from '@/lib/format/number';

/**
 * Self-service account page.
 *
 * Available to every signed-in user whatever their role — a Viewer must be
 * able to change their own password without asking an administrator.
 */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');

  const { error } = await searchParams;

  async function changePasswordAction(formData: FormData) {
    'use server';

    const actor = await currentUser();
    if (!actor) redirect('/login');

    const current = String(formData.get('currentPassword') ?? '');
    const next = String(formData.get('newPassword') ?? '');
    const confirm = String(formData.get('confirmPassword') ?? '');

    const fail = (message: string) =>
      redirect(`/account?error=${encodeURIComponent(message)}`);

    if (next !== confirm) fail('The new passwords do not match.');
    if (passwordTooShort(next)) fail(`Passwords must be at least ${MIN_PASSWORD} characters.`);
    if (next === current) fail('The new password is the same as the current one.');

    // The current password is required so that someone who walks up to an
    // unlocked screen cannot take the account over.
    const stored = findUserByEmail(actor.email);
    if (!stored || !verifyPassword(current, stored.passwordHash)) {
      fail('The current password is not correct.');
    }

    setUserPassword(actor.id, next);

    // Written straight to the log rather than through the request-scoped
    // helper: setUserPassword has just revoked every session including this
    // one, so there is no longer a signed-in user for the helper to find and
    // the entry would be dropped in silence. The password itself is never
    // recorded — only that it was replaced, and by whom.
    writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'user.password_change',
      entity: 'user',
      entityId: actor.id,
      summary: `${actor.email} changed their own password`,
    });

    // setUserPassword revokes every session, including this one, so the cookie
    // is cleared too rather than left pointing at a session that no longer
    // exists.
    await signOut();
    redirect('/login?changed=1');
  }

  return (
    <>
      <PageHeader title="Account" description="Your sign-in details." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Your details" />
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Name" value={user.name} />
            <Stat label="Email" value={user.email} />
            <Stat label="Role" value={ROLE_LABELS[user.role]} hint={ROLE_DESCRIPTIONS[user.role]} />
            <Stat
              label="Account expires"
              value={user.expiresAt ? formatDate(user.expiresAt) : 'Never'}
              hint={user.expiresAt ? 'Access ends after this date.' : undefined}
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Change your password"
            subtitle={`At least ${MIN_PASSWORD} characters.`}
          />

          {error ? (
            <p className="mb-3 rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical">
              {error}
            </p>
          ) : null}

          <form action={changePasswordAction} className="space-y-2">
            <input
              name="currentPassword"
              type="password"
              placeholder="Current password"
              autoComplete="current-password"
              required
              className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
            />
            <input
              name="newPassword"
              type="password"
              placeholder="New password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              required
              className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
            />
            <input
              name="confirmPassword"
              type="password"
              placeholder="Confirm new password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              required
              className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
            />
            <button
              type="submit"
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              Change password
            </button>
          </form>

          <p className="mt-3 text-xs text-ink-muted">
            You will be signed out of every device, including this one, and will need to sign in
            again with the new password.
          </p>
        </Card>
      </div>
    </>
  );
}
