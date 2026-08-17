import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, can, currentUser } from '@/lib/auth';
import {
  createUser,
  findUserById,
  isExpired,
  listUsers,
  setUserPassword,
  updateUser,
} from '@/lib/db/repositories/users';
import { formatDate } from '@/lib/format/number';
import type { Role } from '@/lib/types';
import { UserRow } from './user-row';

const ROLES: Role[] = ['admin', 'finance', 'management', 'viewer'];
const MIN_PASSWORD = 12;

/** Users, roles, account expiry and passwords (requirement 30). */
export default async function UserSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!can(user, 'users:manage')) redirect('/');

  const { error, notice } = await searchParams;
  const users = listUsers();

  async function guard() {
    'use server';
    const actor = await currentUser();
    if (!actor || !can(actor, 'users:manage')) redirect('/');
    return actor;
  }

  async function createUserAction(formData: FormData) {
    'use server';
    await guard();

    const email = String(formData.get('email') ?? '').trim();
    const name = String(formData.get('name') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    const role = String(formData.get('role') ?? 'viewer') as Role;
    const expiresAt = String(formData.get('expiresAt') ?? '').trim() || null;

    if (!email || !name || !password) return;
    if (password.length < MIN_PASSWORD) {
      redirect(`/settings/users?error=${encodeURIComponent(`Passwords must be at least ${MIN_PASSWORD} characters.`)}`);
    }

    try {
      createUser({ email, name, password, role, expiresAt });
    } catch (err) {
      redirect(`/settings/users?error=${encodeURIComponent((err as Error).message)}`);
    }
    revalidatePath('/settings/users');
    redirect(`/settings/users?notice=${encodeURIComponent(`Created ${email}.`)}`);
  }

  async function updateUserAction(formData: FormData) {
    'use server';
    const actor = await guard();

    const id = String(formData.get('id') ?? '');
    const target = findUserById(id);
    if (!target) return;

    const role = String(formData.get('role') ?? '') as Role;
    const active = formData.get('active') === 'on';
    const expiresAt = String(formData.get('expiresAt') ?? '').trim() || null;

    // An admin editing their own row must not be able to lock themselves out;
    // with a single admin that would leave nobody able to undo it.
    if (id === actor.id) {
      const locksOut =
        role !== 'admin' || !active || (expiresAt !== null && expiresAt < new Date().toISOString().slice(0, 10));
      if (locksOut) {
        redirect(
          `/settings/users?error=${encodeURIComponent('You cannot remove your own access. Ask another admin to make that change.')}`,
        );
      }
    }

    updateUser(id, {
      name: String(formData.get('name') ?? '').trim() || undefined,
      role,
      active,
      expiresAt,
    });

    revalidatePath('/settings/users');
    redirect(`/settings/users?notice=${encodeURIComponent(`Updated ${target.email}.`)}`);
  }

  async function setPasswordAction(formData: FormData) {
    'use server';
    await guard();

    const id = String(formData.get('id') ?? '');
    const password = String(formData.get('password') ?? '');
    const target = findUserById(id);
    if (!target) return;

    if (password.length < MIN_PASSWORD) {
      redirect(`/settings/users?error=${encodeURIComponent(`Passwords must be at least ${MIN_PASSWORD} characters.`)}`);
    }

    // Signs the user out everywhere, which is the point of an admin reset.
    setUserPassword(id, password);

    revalidatePath('/settings/users');
    redirect(
      `/settings/users?notice=${encodeURIComponent(`Password changed for ${target.email}. They have been signed out of any active sessions.`)}`,
    );
  }

  return (
    <>
      <PageHeader
        title="Users & Roles"
        description="Who can see and change financial data, and until when."
      />

      {error ? (
        <p className="mb-4 rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-4 rounded-md border border-good/30 bg-good/10 px-3 py-2 text-sm text-good">
          {notice}
        </p>
      ) : null}

      <div className="space-y-3">
        {users.map((row) => (
          <UserRow
            key={row.id}
            user={{
              id: row.id,
              email: row.email,
              name: row.name,
              role: row.role,
              active: row.active,
              expiresAt: row.expiresAt,
              expired: isExpired(row),
            }}
            isSelf={row.id === user.id}
            roles={ROLES}
            roleLabels={ROLE_LABELS}
            minPassword={MIN_PASSWORD}
            updateAction={updateUserAction}
            setPasswordAction={setPasswordAction}
          />
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Add a user"
            subtitle={`Passwords must be at least ${MIN_PASSWORD} characters. Leave the expiry blank for an account that does not expire.`}
          />
          <form action={createUserAction} className="space-y-2">
            <input
              name="name"
              placeholder="Full name"
              required
              className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
            />
            <input
              name="email"
              type="email"
              placeholder="Email"
              required
              className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
            />
            <input
              name="password"
              type="password"
              placeholder="Initial password"
              minLength={MIN_PASSWORD}
              required
              className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Role</span>
                <select
                  name="role"
                  defaultValue="viewer"
                  className="rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                  Expires (optional)
                </span>
                <input
                  name="expiresAt"
                  type="date"
                  className="rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
                />
              </label>
            </div>
            <button
              type="submit"
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              Create user
            </button>
          </form>
        </Card>

        <Card>
          <CardHeader title="What each role can do" />
          <dl className="space-y-2 text-sm">
            {ROLES.map((role) => (
              <div key={role}>
                <dt className="font-medium text-ink">{ROLE_LABELS[role]}</dt>
                <dd className="text-ink-secondary">{ROLE_DESCRIPTIONS[role]}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 border-t border-border pt-4 text-sm">
            <p className="font-medium text-ink">Account expiry</p>
            <p className="mt-1 text-ink-secondary">
              An expired account cannot sign in, and any session it already had stops working — the
              check runs on every request, not only at sign-in. Useful for auditors and contractors.
              Today is {formatDate(new Date().toISOString().slice(0, 10))}.
            </p>
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Changing your own password"
          subtitle="Every signed-in user can do this from Account, whatever their role."
        />
        <p className="text-sm text-ink-secondary">
          Changing a password signs that user out of every device. That is deliberate: a password is
          usually changed because the old one may be known to someone else.
        </p>
      </Card>
    </>
  );
}
