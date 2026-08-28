import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/primitives';
import { activeCompany, can, currentUser } from '@/lib/auth';
import { audit } from '@/lib/audit';
import {
  listProjectFinancials,
  setProjectFinancials,
} from '@/lib/db/repositories/project-financials';
import {
  AliasConflictError,
  addAlias,
  createProject,
  listProjects,
  removeAlias,
  updateProject,
} from '@/lib/db/repositories/projects';
import { ProjectSettings } from './project-settings';

/**
 * Resolves a project id posted by a form.
 *
 * Every action re-reads the company rather than trusting the one captured when
 * the page rendered, and answers null for an id outside it. A form is a
 * request; the id in it is not a permission.
 *
 * Defined at module scope, not inside the page. A server action that closes
 * over a function declared in the render scope cannot be serialised, and the
 * page fails at request time with "Functions cannot be passed directly to
 * Client Components" — which nothing in a build or a type-check catches.
 */
async function ownProjectId(formData: FormData): Promise<string | null> {
  const actorCompany = await activeCompany();
  if (!actorCompany) return null;

  const id = String(formData.get('projectId') ?? '');
  if (!id) return null;

  const owner = listProjects(true).find((p) => p.id === id);
  return owner?.companyId === actorCompany.id ? id : null;
}

/**
 * Projects and aliases (requirement 2).
 *
 * This page is the reason no project name is hard-coded anywhere: when Finance
 * receives a file that spells a company differently, they add the spelling
 * here and the next import routes correctly — no code change.
 *
 * It is scoped to the company in session. Projects are what every figure is
 * attributed to and what aliases route imports by, so renaming, deactivating
 * or re-aliasing another company's project would move that company's data —
 * silently, and from a page they never opened.
 */
/**
 * The name to write in the log, so a later rename does not rewrite history.
 *
 * Module scope on purpose: a helper declared inside the component is captured
 * by the server actions below it, and a captured function cannot be
 * serialised — the page then throws at request time with a build that was
 * perfectly green.
 */
function projectName(id: string): string {
  const found = listProjects(true).find((p) => p.id === id);
  return found ? `${found.code} — ${found.name}` : id;
}

export default async function ProjectSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!can(user, 'projects:edit')) redirect('/');

  const company = await activeCompany();
  if (!company) redirect('/companies');

  const { error } = await searchParams;
  const projects = listProjects(true).filter((p) => p.companyId === company.id);
  const financials = new Map(listProjectFinancials(company.id).map((f) => [f.projectId, f]));

  async function addAliasAction(formData: FormData) {
    'use server';
    const actor = await currentUser();
    if (!actor || !can(actor, 'projects:edit')) redirect('/');

    const projectId = await ownProjectId(formData);
    const alias = String(formData.get('alias') ?? '').trim();
    if (!projectId || !alias) return;

    try {
      addAlias(projectId, alias);
    } catch (err) {
      if (err instanceof AliasConflictError) {
        redirect(`/settings/projects?error=${encodeURIComponent(err.message)}`);
      }
      redirect(`/settings/projects?error=${encodeURIComponent((err as Error).message)}`);
    }

    await audit({
      action: 'project.alias_add',
      entity: 'project',
      entityId: projectId,
      summary: `Added the spelling "${alias}" to ${projectName(projectId)}`,
      detail: { alias },
    });
    revalidatePath('/settings/projects');
  }

  async function removeAliasAction(formData: FormData) {
    'use server';
    const actor = await currentUser();
    if (!actor || !can(actor, 'projects:edit')) redirect('/');

    const projectId = await ownProjectId(formData);
    if (!projectId) return;

    const alias = String(formData.get('alias') ?? '');
    removeAlias(projectId, alias);

    await audit({
      action: 'project.alias_remove',
      entity: 'project',
      entityId: projectId,
      summary: `Removed the spelling "${alias}" from ${projectName(projectId)}`,
      detail: { alias },
    });
    revalidatePath('/settings/projects');
  }

  async function createProjectAction(formData: FormData) {
    'use server';
    const actor = await currentUser();
    if (!actor || !can(actor, 'projects:edit')) redirect('/');

    const actorCompany = await activeCompany();
    if (!actorCompany) redirect('/companies');

    const code = String(formData.get('code') ?? '').trim().toUpperCase();
    const name = String(formData.get('name') ?? '').trim();
    const company = String(formData.get('company') ?? '').trim() || null;
    if (!code || !name) return;

    try {
      // Created into the company in session. A project with no company would
      // appear on no dashboard at all, which reads as the import having lost
      // the data.
      const made = createProject({ code, name, companyId: actorCompany.id, company, sortOrder: 100 });
      await audit({
        action: 'project.create',
        entity: 'project',
        entityId: made.id,
        summary: `Created the project ${code} — ${name}`,
        detail: { code, name, company },
      });
    } catch (err) {
      redirect(`/settings/projects?error=${encodeURIComponent((err as Error).message)}`);
    }
    revalidatePath('/settings/projects');
  }

  async function setFinancialsAction(formData: FormData) {
    'use server';
    const actor = await currentUser();
    if (!actor || !can(actor, 'projects:edit')) redirect('/');

    const actorCompany = await activeCompany();
    if (!actorCompany) redirect('/companies');

    const projectId = String(formData.get('projectId') ?? '');
    if (!projectId) return;

    // A blank field means "not set", which is different from zero: zero is a
    // project expected to sell for nothing, and the two must not be confused.
    const amount = (name: string) => {
      const raw = String(formData.get(name) ?? '').replace(/[,\s฿]/g, '');
      if (raw === '') return null;
      const value = Number(raw);
      return Number.isFinite(value) && value >= 0 ? value : null;
    };

    const written = setProjectFinancials({
      companyId: actorCompany.id,
      projectId,
      totalSaleValue: amount('totalSaleValue'),
      costBudget: amount('costBudget'),
      revisedCostBudget: amount('revisedCostBudget'),
      committedCost: amount('committedCost'),
      userId: actor.id,
    });
    if (!written) return;

    // These figures change what every profit line reports, so a change to one
    // is worth as much of a record as a change to an account.
    await audit({
      action: 'project.financials',
      entity: 'project',
      entityId: projectId,
      summary: `Set the expected sale value and cost budget for ${projectName(projectId)}`,
      detail: {
        totalSaleValue: amount('totalSaleValue'),
        costBudget: amount('costBudget'),
        revisedCostBudget: amount('revisedCostBudget'),
        committedCost: amount('committedCost'),
      },
      companyId: actorCompany.id,
    });

    // Every stored profit figure was computed from the old numbers.
    revalidatePath('/settings/projects');
    revalidatePath('/financial');
    revalidatePath('/projects');
    revalidatePath('/');
  }

  async function toggleActiveAction(formData: FormData) {
    'use server';
    const actor = await currentUser();
    if (!actor || !can(actor, 'projects:edit')) redirect('/');

    const projectId = await ownProjectId(formData);
    if (!projectId) return;

    const active = formData.get('active') === '1';
    updateProject(projectId, { active });

    await audit({
      action: 'project.update',
      entity: 'project',
      entityId: projectId,
      summary: `${active ? 'Activated' : 'Deactivated'} ${projectName(projectId)}`,
      detail: { active },
    });
    revalidatePath('/settings/projects');
  }

  return (
    <>
      <PageHeader
        title="Projects & Aliases"
        description={`Projects of ${company.displayName}, and how the importer recognises each one in a spreadsheet. Add a spelling here rather than changing code.`}
      />
      <ProjectSettings
        projects={projects}
        error={error ?? null}
        addAliasAction={addAliasAction}
        removeAliasAction={removeAliasAction}
        createProjectAction={createProjectAction}
        toggleActiveAction={toggleActiveAction}
        financials={financials}
        setFinancialsAction={setFinancialsAction}
        canEdit={can(user, 'projects:edit')}
      />
    </>
  );
}
