import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { REPORT_TYPE_LABELS } from '@/config/detection-rules';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { can, currentUser } from '@/lib/auth';
import { listProjects } from '@/lib/db/repositories/projects';
import { listTemplates, updateTemplate } from '@/lib/db/repositories/templates';

/**
 * Template mapping (requirement 26).
 *
 * Templates are hints applied on top of header detection, never instead of it,
 * so a template can fill a gap but cannot override what the file itself says.
 */
export default async function TemplateSettingsPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!can(user, 'mapping:edit')) redirect('/');

  const templates = listTemplates();
  const projects = listProjects(true);

  async function toggleAction(formData: FormData) {
    'use server';
    const actor = await currentUser();
    if (!actor || !can(actor, 'mapping:edit')) redirect('/');

    updateTemplate(String(formData.get('id') ?? ''), {
      active: formData.get('active') === '1',
    });
    revalidatePath('/settings/templates');
  }

  return (
    <>
      <PageHeader
        title="Template Mapping"
        description="Known workbook layouts. When one matches, its column hints fill in anything header detection could not resolve."
      />

      <Card className="mb-4">
        <CardHeader title="How mapping is decided" subtitle="Strongest evidence first (requirement 25)" />
        <ol className="space-y-1.5 text-sm text-ink-secondary">
          <li>
            <span className="font-medium text-ink">1. Manual override</span> — anything you set in the
            import preview.
          </li>
          <li>
            <span className="font-medium text-ink">2. Header detection</span> — what the sheet's own
            column labels say, in English or Thai.
          </li>
          <li>
            <span className="font-medium text-ink">3. Template hints</span> — the mappings below, for
            fields detection could not resolve.
          </li>
          <li>
            <span className="font-medium text-ink">4. Cell addresses</span> — a last resort for known
            layouts, never the only strategy.
          </li>
        </ol>
      </Card>

      <div className="space-y-3">
        {templates.map((template) => {
          const project = projects.find((p) => p.id === template.projectId);
          const columns = Object.entries(template.columnMap);
          const cells = Object.entries(template.cellMap);

          return (
            <Card key={template.id}>
              <CardHeader
                title={template.name}
                subtitle={template.description ?? undefined}
                action={
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral">{REPORT_TYPE_LABELS[template.reportType]}</Badge>
                    {project ? <Badge tone="info">{project.name}</Badge> : null}
                    {template.active ? (
                      <Badge tone="good" icon={<span aria-hidden>●</span>}>
                        Active
                      </Badge>
                    ) : (
                      <Badge tone="neutral">Disabled</Badge>
                    )}
                    <form action={toggleAction}>
                      <input type="hidden" name="id" value={template.id} />
                      <input type="hidden" name="active" value={template.active ? '0' : '1'} />
                      <button
                        type="submit"
                        className="rounded-md border border-border-strong px-2.5 py-1 text-xs text-ink-secondary hover:bg-surface-hover"
                      >
                        {template.active ? 'Disable' : 'Enable'}
                      </button>
                    </form>
                  </div>
                }
              />

              <div className="grid gap-4 text-sm lg:grid-cols-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                    Matches on
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs text-ink-secondary">
                    {template.matchRules.fileNamePatterns?.length ? (
                      <li>File name: {template.matchRules.fileNamePatterns.join(', ')}</li>
                    ) : null}
                    {template.matchRules.sheetNamePatterns?.length ? (
                      <li>Sheet name: {template.matchRules.sheetNamePatterns.join(', ')}</li>
                    ) : null}
                    {template.matchRules.requiredHeaders?.length ? (
                      <li>Required headers: {template.matchRules.requiredHeaders.join(', ')}</li>
                    ) : null}
                  </ul>
                </div>

                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                    Column hints
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {columns.length > 0 ? (
                      columns.map(([field, header]) => (
                        <span
                          key={field}
                          className="rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-[11px] text-ink-secondary"
                        >
                          <span className="font-medium text-ink">{field}</span> ← {header}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-ink-muted">None</span>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                    Cell fallbacks
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {cells.length > 0 ? (
                      cells.map(([field, address]) => (
                        <span
                          key={field}
                          className="rounded border border-border bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-secondary"
                        >
                          {field} ← {address}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-ink-muted">None</span>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
