import { Badge, Card, CardHeader } from '@/components/ui/primitives';
import type { Project } from '@/lib/types';

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
}: {
  projects: Project[];
  error: string | null;
  addAliasAction: (formData: FormData) => Promise<void>;
  removeAliasAction: (formData: FormData) => Promise<void>;
  createProjectAction: (formData: FormData) => Promise<void>;
  toggleActiveAction: (formData: FormData) => Promise<void>;
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
    </>
  );
}
