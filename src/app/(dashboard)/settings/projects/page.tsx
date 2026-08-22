import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/primitives';
import { activeCompany, can, currentUser } from '@/lib/auth';
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

  /**
   * Resolves a project id posted by a form.
   *
   * Every action re-reads the company rather than trusting the one captured
   * when the page rendered, and answers null for an id outside it. A form is a
   * request; the id in it is not a permission.
   */
  async function ownProjectId(formData: FormData): Promise<string | null> {
    const actorCompany = await activeCompany();
    if (!actorCompany) return null;

    const id = String(formData.get('projectId') ?? '');
    if (!id) return null;

    const owner = listProjects(true).find((p) => p.id === id);
    return owner?.companyId === actorCompany.id ? id : null;
  }

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
    revalidatePath('/settings/projects');
  }

  async function removeAliasAction(formData: FormData) {
    'use server';
    const actor = await currentUser();
    if (!actor || !can(actor, 'projects:edit')) redirect('/');

    const projectId = await ownProjectId(formData);
    if (!projectId) return;

    removeAlias(projectId, String(formData.get('alias') ?? ''));
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
      createProject({ code, name, companyId: actorCompany.id, company, sortOrder: 100 });
    } catch (err) {
      redirect(`/settings/projects?error=${encodeURIComponent((err as Error).message)}`);
    }
    revalidatePath('/settings/projects');
  }

  async function toggleActiveAction(formData: FormData) {
    'use server';
    const actor = await currentUser();
    if (!actor || !can(actor, 'projects:edit')) redirect('/');

    const projectId = await ownProjectId(formData);
    if (!projectId) return;

    updateProject(projectId, { active: formData.get('active') === '1' });
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
      />
    </>
  );
}
