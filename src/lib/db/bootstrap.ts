import { DEFAULT_PROJECTS } from '@/config/projects.default';
import { DEFAULT_TEMPLATES } from '@/config/templates';
import { normalizeKey } from '@/lib/detect/normalize-text';
import { getDb } from './index';
import { createProject, listProjects } from './repositories/projects';
import { createTemplate, listTemplates } from './repositories/templates';
import { countUsers, createUser } from './repositories/users';

/**
 * First-run seeding.
 *
 * Idempotent: each step checks for existing data first, so calling this on
 * every boot is safe and never overwrites what an admin has since edited.
 */

export interface SeedResult {
  createdProjects: number;
  createdTemplates: number;
  createdAdmin: { email: string; password: string } | null;
}

export function bootstrapDatabase(options: { adminPassword?: string } = {}): SeedResult {
  // Touch the connection so the schema is applied before anything reads it.
  getDb();

  const result: SeedResult = { createdProjects: 0, createdTemplates: 0, createdAdmin: null };

  const existingProjects = listProjects(true);
  const existingCodes = new Set(existingProjects.map((p) => p.code));

  for (const project of DEFAULT_PROJECTS) {
    if (existingCodes.has(project.code)) continue;
    createProject({
      code: project.code,
      name: project.name,
      company: project.company,
      sortOrder: project.sortOrder,
      aliases: project.aliases,
    });
    result.createdProjects += 1;
  }

  const projects = listProjects(true);
  const projectByAliasKey = new Map<string, string>();
  for (const project of projects) {
    for (const alias of [project.name, project.code, ...project.aliases]) {
      projectByAliasKey.set(normalizeKey(alias), project.id);
    }
  }

  const existingTemplateNames = new Set(listTemplates().map((t) => t.name));

  for (const template of DEFAULT_TEMPLATES) {
    if (existingTemplateNames.has(template.name)) continue;
    createTemplate({
      name: template.name,
      reportType: template.reportType,
      projectId: template.projectAlias
        ? projectByAliasKey.get(normalizeKey(template.projectAlias)) ?? null
        : null,
      description: template.description,
      matchRules: template.matchRules,
      columnMap: template.columnMap,
      cellMap: template.cellMap,
      priority: template.priority,
    });
    result.createdTemplates += 1;
  }

  if (countUsers() === 0) {
    const email = process.env.GTG_ADMIN_EMAIL ?? 'admin@globaltopgroup.local';
    const password = options.adminPassword ?? process.env.GTG_ADMIN_PASSWORD ?? generatePassword();
    createUser({ email, name: 'Administrator', password, role: 'admin' });
    result.createdAdmin = { email, password };
  }

  return result;
}

/**
 * A random initial password, printed once by the seed script. Preferable to a
 * shipped default that would otherwise survive into production untouched.
 */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}
