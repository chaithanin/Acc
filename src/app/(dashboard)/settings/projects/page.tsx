import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/primitives';
import { can, currentUser } from '@/lib/auth';
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
 */
export default async function ProjectSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!can(user, 'projects:edit')) redirect('/');

  const { error } = await searchParams;
  const projects = listProjects(true);

  async function addAliasAction(formData: FormData) {
    'use server';
    const actor = await currentUser();
    if (!actor || !can(actor, 'projects:edit')) redirect('/');

    const projectId = String(formData.get('projectId') ?? '');
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

    removeAlias(String(formData.get('projectId') ?? ''), String(formData.get('alias') ?? ''));
    revalidatePath('/settings/projects');
  }

  async function createProjectAction(formData: FormData) {
    'use server';
    const actor = await currentUser();
    if (!actor || !can(actor, 'projects:edit')) redirect('/');

    const code = String(formData.get('code') ?? '').trim().toUpperCase();
    const name = String(formData.get('name') ?? '').trim();
    const company = String(formData.get('company') ?? '').trim() || null;
    if (!code || !name) return;

    try {
      createProject({ code, name, company, sortOrder: 100 });
    } catch (err) {
      redirect(`/settings/projects?error=${encodeURIComponent((err as Error).message)}`);
    }
    revalidatePath('/settings/projects');
  }

  async function toggleActiveAction(formData: FormData) {
    'use server';
    const actor = await currentUser();
    if (!actor || !can(actor, 'projects:edit')) redirect('/');

    updateProject(String(formData.get('projectId') ?? ''), {
      active: formData.get('active') === '1',
    });
    revalidatePath('/settings/projects');
  }

  return (
    <>
      <PageHeader
        title="Projects & Aliases"
        description="How the importer recognises each company in a spreadsheet. Add a spelling here rather than changing code."
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
