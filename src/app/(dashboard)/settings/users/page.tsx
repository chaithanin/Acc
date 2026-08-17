import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, can, currentUser } from '@/lib/auth';
import { createUser, listUsers, setUserActive, setUserRole } from '@/lib/db/repositories/users';
import type { Role } from '@/lib/types';

const ROLES: Role[] = ['admin', 'finance', 'management', 'viewer'];

/** Users and roles (requirement 30). */
export default async function UserSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!can(user, 'users:manage')) redirect('/');

  const { error } = await searchParams;
  const users = listUsers();

  async function createUserAction(formData: FormData) {
    'use server';
    const actor = await currentUser();
    if (!actor || !can(actor, 'users:manage')) redirect('/');

    const email = String(formData.get('email') ?? '').trim();
    const name = String(formData.get('name') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    const role = String(formData.get('role') ?? 'viewer') as Role;

    if (!email || !name || !password) return;
    if (password.length < 12) {
      redirect('/settings/users?error=' + encodeURIComponent('Passwords must be at least 12 characters.'));
    }

    try {
      createUser({ email, name, password, role });
    } catch (err) {
      redirect('/settings/users?error=' + encodeURIComponent((err as Error).message));
    }
    revalidatePath('/settings/users');
  }

  async function changeRoleAction(formData: FormData) {
    'use server';
    const actor = await currentUser();
    if (!actor || !can(actor, 'users:manage')) redirect('/');

    const id = String(formData.get('id') ?? '');
    const role = String(formData.get('role') ?? '') as Role;

    // An admin removing their own admin rights would lock themselves out.
    if (id === actor.id && role !== 'admin') {
      redirect('/settings/users?error=' + encodeURIComponent('You cannot change your own role.'));
    }

    setUserRole(id, role);
    revalidatePath('/settings/users');
  }

  async function toggleActiveAction(formData: FormData) {
    'use server';
    const actor = await currentUser();
    if (!actor || !can(actor, 'users:manage')) redirect('/');

    const id = String(formData.get('id') ?? '');
    if (id === actor.id) {
      redirect('/settings/users?error=' + encodeURIComponent('You cannot deactivate your own account.'));
    }

    setUserActive(id, formData.get('active') === '1');
    revalidatePath('/settings/users');
  }

  return (
    <>
      <PageHeader title="Users & Roles" description="Who can see and change financial data." />

      {error ? (
        <p className="mb-4 rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      ) : null}

      <Card className="mb-4" padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead className="bg-surface-sunken">
              <tr>
                {['Name', 'Email', 'Role', 'Status', ''].map((h) => (
                  <th
                    key={h}
                    className="border-b border-border px-3 py-2 text-left text-xs font-semibold text-ink-secondary"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium text-ink">{row.name}</td>
                  <td className="px-3 py-2 text-ink-secondary">{row.email}</td>
                  <td className="px-3 py-2">
                    <form action={changeRoleAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="id" value={row.id} />
                      <select
                        name="role"
                        defaultValue={row.role}
                        className="rounded-md border border-border-strong bg-surface px-2 py-1 text-xs text-ink"
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="rounded-md border border-border-strong px-2 py-1 text-xs text-ink-secondary hover:bg-surface-hover"
                      >
                        Save
                      </button>
                    </form>
                  </td>
                  <td className="px-3 py-2">
                    {row.active ? (
                      <Badge tone="good" icon={<span aria-hidden>●</span>}>
                        Active
                      </Badge>
                    ) : (
                      <Badge tone="neutral">Disabled</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <form action={toggleActiveAction}>
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="active" value={row.active ? '0' : '1'} />
                      <button
                        type="submit"
                        className="rounded-md border border-border-strong px-2.5 py-1 text-xs text-ink-secondary hover:bg-surface-hover"
                      >
                        {row.active ? 'Disable' : 'Enable'}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Add a user" subtitle="Passwords must be at least 12 characters." />
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
              minLength={12}
              required
              className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
            />
            <select
              name="role"
              defaultValue="viewer"
              className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
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
        </Card>
      </div>
    </>
  );
}
