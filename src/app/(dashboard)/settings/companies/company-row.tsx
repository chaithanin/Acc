'use client';

import { useState } from 'react';
import { Badge, Card } from '@/components/ui/primitives';
import { Button } from '@/components/ui/controls';

/**
 * One company, with its mark and the fields that name it.
 *
 * The logo form is separate from the details form: replacing a mark is a
 * different act from renaming a company, and neither should happen because
 * someone was doing the other.
 */
export function CompanyRow({
  company,
  limits,
  uploadAction,
  removeAction,
  updateAction,
}: {
  company: {
    id: string;
    companyCode: string;
    displayName: string;
    legalName: string;
    logo: string | null;
    sortOrder: number;
    active: boolean;
    projectCount: number;
  };
  limits: string;
  uploadAction: (formData: FormData) => Promise<void>;
  removeAction: (formData: FormData) => Promise<void>;
  updateAction: (formData: FormData) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="grid h-14 w-24 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-white">
            {company.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={company.logo}
                alt={company.displayName}
                className="max-h-12 max-w-[5.5rem] object-contain"
              />
            ) : (
              <span className="text-sm font-semibold text-ink-muted">{company.companyCode.slice(0, 3)}</span>
            )}
          </div>

          <div className="min-w-0">
            <p className="font-medium text-ink">{company.displayName}</p>
            <p className="truncate text-sm text-ink-secondary">{company.legalName}</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              {company.companyCode} · {company.projectCount}{' '}
              {company.projectCount === 1 ? 'project' : 'projects'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {company.active ? (
            <Badge tone="good" icon={<span aria-hidden>●</span>}>
              Active
            </Badge>
          ) : (
            <Badge tone="neutral">Disabled</Badge>
          )}
          <Button size="sm" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Cancel' : 'Edit'}
          </Button>
        </div>
      </div>

      <form action={uploadAction} className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
        <input type="hidden" name="id" value={company.id} />
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
            Logo
          </span>
          <input
            type="file"
            name="logo"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            required
            className="w-72 text-sm text-ink-secondary file:mr-3 file:rounded-md file:border-0 file:bg-surface-sunken file:px-3 file:py-1.5 file:text-sm file:text-ink"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          Upload
        </button>
        {company.logo ? (
          <button
            type="submit"
            formAction={removeAction}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm text-ink-secondary hover:bg-surface-hover"
          >
            Remove
          </button>
        ) : null}
        <span className="pb-1.5 text-xs text-ink-muted">{limits}</span>
      </form>

      {editing ? (
        <form action={updateAction} className="mt-4 border-t border-border pt-4">
          <input type="hidden" name="id" value={company.id} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Display name">
              <input
                name="displayName"
                defaultValue={company.displayName}
                className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
              />
            </Field>
            <Field label="Code">
              <input
                name="companyCode"
                defaultValue={company.companyCode}
                className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
              />
            </Field>
            <Field label="Order">
              <input
                name="sortOrder"
                type="number"
                defaultValue={company.sortOrder}
                className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
              />
            </Field>
            <Field label="Status">
              <label className="flex items-center gap-2 py-1.5 text-sm text-ink">
                <input type="checkbox" name="active" defaultChecked={company.active} />
                Selectable
              </label>
            </Field>
          </div>

          <p className="mt-2 text-xs text-ink-muted">
            A disabled company disappears from the chooser. Its data is untouched — nothing is
            deleted here.
          </p>

          <button
            type="submit"
            className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            Save changes
          </button>
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
