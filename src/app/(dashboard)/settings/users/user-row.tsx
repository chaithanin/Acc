'use client';

import { useState } from 'react';
import { Badge, Card, cx } from '@/components/ui/primitives';
import { Button } from '@/components/ui/controls';
import { formatDate } from '@/lib/format/number';
import type { Role } from '@/lib/types';

/**
 * One editable user.
 *
 * Editing and password reset are separate forms on purpose: changing a role or
 * an expiry date is routine, while replacing a password signs the person out
 * everywhere, so it should not be something you do by accident while renaming
 * someone.
 */
export function UserRow({
  user,
  isSelf,
  companies,
  grantedCompanyIds,
  roles,
  roleLabels,
  minPassword,
  updateAction,
  setPasswordAction,
}: {
  user: {
    id: string;
    email: string;
    name: string;
    role: Role;
    active: boolean;
    expiresAt: string | null;
    expired: boolean;
  };
  isSelf: boolean;
  companies: { id: string; name: string; code: string }[];
  grantedCompanyIds: string[];
  roles: Role[];
  roleLabels: Record<Role, string>;
  minPassword: number;
  updateAction: (formData: FormData) => Promise<void>;
  setPasswordAction: (formData: FormData) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink">
            {user.name}
            {isSelf ? <span className="ml-2 text-xs font-normal text-ink-muted">(you)</span> : null}
          </p>
          <p className="text-sm text-ink-secondary">{user.email}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{roleLabels[user.role]}</Badge>

          {/*
            Access is worth showing without opening the row: an account with no
            company can sign in and see nothing, which reads as a broken system
            until someone notices the grant is missing.
          */}
          {grantedCompanyIds.length === 0 ? (
            <Badge tone="critical" icon={<span aria-hidden>▲</span>}>
              No company
            </Badge>
          ) : (
            <Badge tone="neutral">
              {grantedCompanyIds.length === companies.length
                ? 'All companies'
                : `${grantedCompanyIds.length} of ${companies.length} companies`}
            </Badge>
          )}

          {user.expired ? (
            <Badge tone="critical" icon={<span aria-hidden>▲</span>}>
              Expired {formatDate(user.expiresAt)}
            </Badge>
          ) : user.expiresAt ? (
            <Badge tone="warning" icon={<span aria-hidden>◆</span>}>
              Expires {formatDate(user.expiresAt)}
            </Badge>
          ) : null}

          {user.active ? (
            <Badge tone="good" icon={<span aria-hidden>●</span>}>
              Active
            </Badge>
          ) : (
            <Badge tone="neutral">Disabled</Badge>
          )}

          <Button size="sm" onClick={() => { setEditing((v) => !v); setChangingPassword(false); }}>
            {editing ? 'Cancel' : 'Edit'}
          </Button>
          <Button size="sm" onClick={() => { setChangingPassword((v) => !v); setEditing(false); }}>
            {changingPassword ? 'Cancel' : 'Change password'}
          </Button>
        </div>
      </div>

      {editing ? (
        <form action={updateAction} className="mt-4 border-t border-border pt-4">
          <input type="hidden" name="id" value={user.id} />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Name">
              <input
                name="name"
                defaultValue={user.name}
                className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
              />
            </Field>

            <Field label="Email (used to sign in)">
              <input
                name="email"
                type="email"
                defaultValue={user.email}
                className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
              />
            </Field>

            <Field label="Role">
              <select
                name="role"
                defaultValue={user.role}
                className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
              >
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {roleLabels[role]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Expires on">
              <input
                name="expiresAt"
                type="date"
                defaultValue={user.expiresAt ?? ''}
                className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
              />
            </Field>

            <Field label="Status">
              <label className="flex items-center gap-2 py-1.5 text-sm text-ink">
                <input type="checkbox" name="active" defaultChecked={user.active} />
                Account is active
              </label>
            </Field>
          </div>

          <div className="mt-4 border-t border-border pt-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
              Companies this user can open
            </p>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {companies.map((company) => (
                <label key={company.id} className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    name="companies"
                    value={company.id}
                    defaultChecked={grantedCompanyIds.includes(company.id)}
                  />
                  <span className="truncate" title={company.name}>
                    {company.name}
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink-muted">
              Only what is ticked here appears on their company screen. Clearing one takes effect
              at once — if they are working in that company, their next page sends them back to
              the chooser.
            </p>
          </div>

          <p className="mt-2 text-xs text-ink-muted">
            Leave the expiry blank for an account that never expires. Removing access takes effect
            immediately — any session the user has is ended.
          </p>

          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              Save changes
            </button>
            <Button onClick={() => setEditing(false)} type="button">
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {changingPassword ? (
        <form action={setPasswordAction} className="mt-4 border-t border-border pt-4">
          <input type="hidden" name="id" value={user.id} />

          <div className="flex flex-wrap items-end gap-3">
            <Field label={`New password (min ${minPassword} characters)`}>
              <input
                name="password"
                type="password"
                minLength={minPassword}
                required
                autoComplete="new-password"
                className="w-72 rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
              />
            </Field>
            <button
              type="submit"
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              Set password
            </button>
          </div>

          <p
            className={cx(
              'mt-2 text-xs',
              isSelf ? 'text-critical' : 'text-ink-muted',
            )}
          >
            {isSelf
              ? 'This signs you out of every device, including this one — you will need to sign in again.'
              : 'This signs the user out of every device. Tell them the new password through a channel other than this dashboard.'}
          </p>
        </form>
      ) : null}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{label}</span>
      {children}
    </label>
  );
}
