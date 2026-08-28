import { Badge, Card, CardHeader } from '@/components/ui/primitives';
import { REVENUE_BASIS_LABELS, REVENUE_BASIS_NOTES, POLICY } from '@/config/accounting-policy';
import type { ProjectFinancials } from '@/lib/db/repositories/project-financials';
import type { Project } from '@/lib/types';

const money = 'w-40 rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink tabular-nums';
const fieldLabel = 'text-[11px] font-medium uppercase tracking-wide text-ink-muted';

/**
 * Alias management.
 *
 * Rendered on the server and driven by form actions, so it works without
 * client-side state — the data here changes rarely and correctness matters
 * more than interactivity.
 */
export function ProjectSettings({
  projects,
  error,
  addAliasAction,
  removeAliasAction,
  createProjectAction,
  toggleActiveAction,
  financials,
  setFinancialsAction,
  canEdit,
}: {
  projects: Project[];
  error: string | null;
  addAliasAction: (formData: FormData) => Promise<void>;
  removeAliasAction: (formData: FormData) => Promise<void>;
  createProjectAction: (formData: FormData) => Promise<void>;
  toggleActiveAction: (formData: FormData) => Promise<void>;
  financials: Map<string, ProjectFinancials>;
  setFinancialsAction: (formData: FormData) => Promise<void>;
  canEdit: boolean;
}) {
  return (
    <>
      {error ? (
        <p className="mb-4 rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      ) : null}

      <div className="space-y-3">
        {projects.map((project) => (
          <Card key={project.id}>
            <CardHeader
              title={project.name}
              subtitle={project.company ?? undefined}
              action={
                <div className="flex items-center gap-2">
                  <Badge tone="neutral">{project.code}</Badge>
                  {project.active ? (
                    <Badge tone="good" icon={<span aria-hidden>●</span>}>
                      Active
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Inactive</Badge>
                  )}
                  <form action={toggleActiveAction}>
                    <input type="hidden" name="projectId" value={project.id} />
                    <input type="hidden" name="active" value={project.active ? '0' : '1'} />
                    <button
                      type="submit"
                      className="rounded-md border border-border-strong px-2.5 py-1 text-xs text-ink-secondary hover:bg-surface-hover"
                    >
                      {project.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </form>
                </div>
              }
            />

            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
              Aliases ({project.aliases.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {project.aliases.map((alias) => (
                <form
                  key={alias}
                  action={removeAliasAction}
                  className="inline-flex items-center gap-1 rounded border border-border bg-surface-sunken py-0.5 pl-2 pr-1 text-xs text-ink-secondary"
                >
                  <span>{alias}</span>
                  <input type="hidden" name="projectId" value={project.id} />
                  <input type="hidden" name="alias" value={alias} />
                  <button
                    type="submit"
                    aria-label={`Remove alias ${alias}`}
                    className="rounded px-1 text-ink-muted hover:bg-surface-hover hover:text-critical"
                  >
                    ✕
                  </button>
                </form>
              ))}
            </div>

            <form action={addAliasAction} className="mt-3 flex flex-wrap gap-2">
              <input type="hidden" name="projectId" value={project.id} />
              <input
                name="alias"
                placeholder="Add another spelling, English or Thai"
                required
                className="min-w-64 flex-1 rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
              />
              <button
                type="submit"
                className="rounded-md border border-border-strong px-3 py-1.5 text-sm text-ink hover:bg-surface-hover"
              >
                Add alias
              </button>
            </form>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Add a project"
          subtitle="Its name and code become aliases automatically; add any other spellings afterwards."
        />
        <form action={createProjectAction} className="flex flex-wrap gap-2">
          <input
            name="code"
            placeholder="Code, e.g. MARINA_ELYA"
            required
            className="w-52 rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
          />
          <input
            name="name"
            placeholder="Project name"
            required
            className="w-56 rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
          />
          <input
            name="company"
            placeholder="Legal entity (optional)"
            className="min-w-64 flex-1 rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
          />
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            Create project
          </button>
        </form>
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="What each project is expected to sell for, and to cost"
          subtitle="The board's own figures. No export carries them, and revenue cannot be recognised without the first."
        />

        <p className="mb-4 max-w-prose text-sm text-ink-secondary">
          Revenue is recognised on the basis of{' '}
          <span className="font-medium text-ink">
            {REVENUE_BASIS_LABELS[POLICY.revenueBasis].toLowerCase()}
          </span>
          . {REVENUE_BASIS_NOTES[POLICY.revenueBasis]} The cost charged against that revenue is the
          certified construction of the units actually sold — which needs the total sale value below
          to separate from the construction still sitting in inventory. Until it is set, the
          dashboard reports revenue earned and says gross profit is not calculable, rather than
          reporting a margin it cannot support.
        </p>

        <div className="space-y-3">
          {projects.map((project) => {
            const held = financials.get(project.id);
            return (
              <form
                key={project.id}
                action={setFinancialsAction}
                className="flex flex-wrap items-end gap-3 border-t border-border pt-3"
              >
                <input type="hidden" name="projectId" value={project.id} />

                <div className="min-w-40 flex-1">
                  <div className="text-sm font-medium text-ink">{project.name}</div>
                  <div className="text-xs text-ink-muted">{project.code}</div>
                </div>

                <label className="flex flex-col gap-1">
                  <span className={fieldLabel}>Total sale value</span>
                  <input
                    name="totalSaleValue"
                    defaultValue={held?.totalSaleValue ?? ''}
                    placeholder="e.g. 1200000000"
                    inputMode="decimal"
                    disabled={!canEdit}
                    className={money}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className={fieldLabel}>Approved cost budget</span>
                  <input
                    name="costBudget"
                    defaultValue={held?.costBudget ?? ''}
                    inputMode="decimal"
                    disabled={!canEdit}
                    className={money}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className={fieldLabel}>Revised budget</span>
                  <input
                    name="revisedCostBudget"
                    defaultValue={held?.revisedCostBudget ?? ''}
                    inputMode="decimal"
                    disabled={!canEdit}
                    className={money}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className={fieldLabel}>Committed cost</span>
                  <input
                    name="committedCost"
                    defaultValue={held?.committedCost ?? ''}
                    inputMode="decimal"
                    disabled={!canEdit}
                    className={money}
                  />
                </label>

                {canEdit ? (
                  <button
                    type="submit"
                    className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
                  >
                    Save
                  </button>
                ) : null}
              </form>
            );
          })}
        </div>

        <p className="mt-4 border-t border-border pt-3 text-xs text-ink-muted">
          Committed cost is money promised by signed contract and not yet spent. It is deducted from
          the remaining budget alongside actual cost, because a budget that looks healthy until the
          commitments land is how an overrun is found too late to do anything about it.
        </p>
      </Card>
    </>
  );
}
