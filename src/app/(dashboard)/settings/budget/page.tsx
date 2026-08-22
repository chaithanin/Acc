import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { activeCompany, can, currentUser } from '@/lib/auth';
import { getBudget, setBudget } from '@/lib/db/repositories/budgets';
import { listProjects } from '@/lib/db/repositories/projects';
import { formatMonth } from '@/lib/format/number';

/**
 * Budget entry.
 *
 * The workbooks contain no budget, so budget-utilisation would otherwise be
 * uncomputable. Rather than invent a denominator, the figures are entered here
 * and stored per month and project.
 */
export default async function BudgetSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; projectId?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!can(user, 'mapping:edit')) redirect('/');

  // The budget belongs to the company in session, and only its projects can
  // be chosen for one.
  const company = await activeCompany();
  if (!company) redirect('/companies');

  const { month: monthParam, projectId: projectParam } = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(monthParam ?? '')
    ? monthParam!
    : new Date().toISOString().slice(0, 7);
  const projects = listProjects().filter((p) => p.companyId === company.id);
  const projectId = projectParam && projects.some((p) => p.id === projectParam) ? projectParam : null;
  const existing = getBudget(company.id, month, projectId);

  async function saveAction(formData: FormData) {
    'use server';
    const actor = await currentUser();
    if (!actor || !can(actor, 'mapping:edit')) redirect('/');

    const targetMonth = String(formData.get('month') ?? '');
    if (!/^\d{4}-\d{2}$/.test(targetMonth)) return;

    // Re-resolved inside the action: the form is a request, and a project id
    // posted here must still be one of this company's.
    const actorCompany = await activeCompany();
    if (!actorCompany) redirect('/companies');

    const posted = String(formData.get('projectId') ?? '') || null;
    const target =
      posted && listProjects(true).some((p) => p.id === posted && p.companyId === actorCompany.id)
        ? posted
        : null;

    const parse = (name: string) => {
      const raw = String(formData.get(name) ?? '').replace(/[,\s฿]/g, '');
      if (raw === '') return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    };

    setBudget({
      companyId: actorCompany.id,
      month: targetMonth,
      projectId: target,
      incomeBudget: parse('incomeBudget'),
      expenseBudget: parse('expenseBudget'),
      userId: actor.id,
    });

    revalidatePath('/settings/budget');
    revalidatePath('/financial');
  }

  return (
    <>
      <PageHeader
        title="Budget"
        description="Budget figures for the income and expense utilisation dials. Leave a field blank to leave that dial unset."
      />

      <Card className="max-w-2xl">
        <CardHeader
          title={`Budget for ${formatMonth(month)}`}
          subtitle={projectId ? projects.find((p) => p.id === projectId)?.name : 'All projects'}
        />

        <form action={saveAction} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                Month
              </span>
              <input
                name="month"
                type="month"
                defaultValue={month}
                required
                className="rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                Project
              </span>
              <select
                name="projectId"
                defaultValue={projectId ?? ''}
                className="rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
              >
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                Income budget (THB)
              </span>
              <input
                name="incomeBudget"
                inputMode="decimal"
                defaultValue={existing?.incomeBudget ?? ''}
                placeholder="e.g. 5000000"
                className="rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                Expense budget (THB)
              </span>
              <input
                name="expenseBudget"
                inputMode="decimal"
                defaultValue={existing?.expenseBudget ?? ''}
                placeholder="e.g. 3500000"
                className="rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
              />
            </label>
          </div>

          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            Save budget
          </button>
        </form>
      </Card>
    </>
  );
}
