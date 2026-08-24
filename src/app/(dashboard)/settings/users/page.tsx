import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, can, currentUser } from '@/lib/auth';
import { audit, changedFields } from '@/lib/audit';
import { writeAudit } from '@/lib/db/repositories/audit';
import {
  companyIdsForUser,
  grantCompany,
  listAllCompanies,
  revokeCompany,
} from '@/lib/db/repositories/companies';
import {
  createUser,
  findUserById,
  isExpired,
  listUsers,
  setUserPassword,
  updateUser,
} from '@/lib/db/repositories/users';
import { MIN_PASSWORD, passwordTooShort } from '@/config/password-policy';
import { formatDate } from '@/lib/format/number';
import type { Role } from '@/lib/types';
import { UserRow } from './user-row';

const ROLES: Role[] = ['admin', 'finance', 'management', 'viewer'];

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
  const companies = listAllCompanies(false);
  const accessByUser = new Map(users.map((u) => [u.id, companyIdsForUser(u.id)]));

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
    if (passwordTooShort(password)) {
      redirect(`/settings/users?error=${encodeURIComponent(`Passwords must be at least ${MIN_PASSWORD} characters.`)}`);
    }

    const grantedIds = formData.getAll('companies').map(String).filter(Boolean);

    // An account with no company sees an empty chooser and can do nothing at
    // all, which looks like a broken system rather than a missing grant. It is
    // refused here instead of being created and then puzzled over.
    if (grantedIds.length === 0) {
      redirect(
        `/settings/users?error=${encodeURIComponent('Choose at least one company. An account with none can see nothing.')}`,
      );
    }

    let created;
    try {
      created = createUser({ email, name, password, role, expiresAt });
    } catch (err) {
      redirect(`/settings/users?error=${encodeURIComponent((err as Error).message)}`);
    }

    for (const companyId of grantedIds) grantCompany(created.id, companyId);

    await audit({
      action: 'user.create',
      entity: 'user',
      entityId: created.id,
      summary: `Created the account ${email} as ${role}`,
      detail: { email, name, role, expiresAt, companies: grantedIds },
      companyId: null,
    });

    revalidatePath('/settings/users');
    redirect(
      `/settings/users?notice=${encodeURIComponent(`Created ${email} with access to ${grantedIds.length} ${grantedIds.length === 1 ? 'company' : 'companies'}.`)}`,
    );
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

    try {
      updateUser(id, {
        name: String(formData.get('name') ?? '').trim() || undefined,
        email: String(formData.get('email') ?? '').trim() || undefined,
        role,
        active,
        expiresAt,
      });
    } catch (err) {
      redirect(`/settings/users?error=${encodeURIComponent((err as Error).message)}`);
    }

    // Company access is replaced with what the form says, rather than added
    // to: a checkbox that is now clear has to mean the grant is gone.
    const wanted = new Set(formData.getAll('companies').map(String).filter(Boolean));
    const held = new Set(companyIdsForUser(id));

    const granted = [...wanted].filter((companyId) => !held.has(companyId));
    const revoked = [...held].filter((companyId) => !wanted.has(companyId));

    for (const companyId of granted) grantCompany(id, companyId);
    for (const companyId of revoked) revokeCompany(id, companyId);

    await audit({
      action: 'user.update',
      entity: 'user',
      entityId: id,
      summary: `Updated the account ${target.email}`,
      detail: {
        changed: changedFields(
          { name: target.name, email: target.email, role: target.role, active: target.active, expiresAt: target.expiresAt },
          { name: String(formData.get('name') ?? '').trim() || undefined,
            email: String(formData.get('email') ?? '').trim() || undefined,
            role, active, expiresAt },
        ),
        granted,
        revoked,
      },
      companyId: null,
    });

    revalidatePath('/settings/users');
    revalidatePath('/companies');
    redirect(`/settings/users?notice=${encodeURIComponent(`Updated ${target.email}.`)}`);
  }

  async function setPasswordAction(formData: FormData) {
    'use server';
    const actor = await guard();

    const id = String(formData.get('id') ?? '');
    const password = String(formData.get('password') ?? '');
    const target = findUserById(id);
    if (!target) return;

    if (passwordTooShort(password)) {
      redirect(`/settings/users?error=${encodeURIComponent(`Passwords must be at least ${MIN_PASSWORD} characters.`)}`);
    }

    // Signs the user out everywhere, which is the point of an admin reset.
    setUserPassword(id, password);

    // Written straight to the log rather than through the request-scoped
    // helper: an administrator resetting their own password has just revoked
    // their own session, and the helper would find nobody signed in and drop
    // the entry. The password itself is never written — only that it was
    // replaced, by whom, and for whom.
    writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'user.password_reset',
      entity: 'user',
      entityId: id,
      summary: `Reset the password for ${target.email} and signed them out everywhere`,
    });

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
            companies={companies.map((c) => ({ id: c.id, name: c.displayName, code: c.companyCode }))}
            grantedCompanyIds={accessByUser.get(row.id) ?? []}
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
            <div className="border-t border-border pt-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                Companies this user may open
              </p>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {companies.map((company) => (
                  <label key={company.id} className="flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" name="companies" value={company.id} />
                    <span className="truncate" title={company.displayName}>
                      {company.displayName}
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-ink-muted">
                At least one is required. An account with none signs in to an empty screen.
              </p>
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
