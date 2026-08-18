import { DEFAULT_PROJECTS } from '@/config/projects.default';
import { DEFAULT_TEMPLATES } from '@/config/templates';
import { normalizeKey } from '@/lib/detect/normalize-text';
import { backfillCompanies, getDb } from './index';
import { logoFor } from '@/config/company-logos';
import { grantCompany, listAllCompanies, updateCompany } from './repositories/companies';
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

  // Companies are derived from the projects just seeded. On a fresh database
  // the migration step runs before any project exists, so this is the call
  // that actually creates them; on an upgrade it has already happened and this
  // returns immediately.
  backfillCompanies();
  applyCompanyLogos();

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
    const supplied = options.adminPassword ?? process.env.GTG_ADMIN_PASSWORD;
    const password = supplied ?? generatePassword();
    const admin = createUser({ email, name: 'Administrator', password, role: 'admin' });
    result.createdAdmin = { email, password };

    // The first administrator is granted every company. Grants are what the
    // company chooser lists, so without this the only account that exists
    // would sign in to an empty screen with no way to grant itself anything.
    for (const company of listAllCompanies()) grantCompany(admin.id, company.id);

    // Also written to the server log. The sign-in page shows this once, but
    // whoever triggers that first render may be a health check rather than a
    // person — in which case the only copy of the password would be discarded.
    // Nothing is logged when the password was supplied, since it is already known.
    if (!supplied) {
      console.warn(
        `\n[gtg] Created the first administrator account.\n` +
          `[gtg]   email:    ${email}\n` +
          `[gtg]   password: ${password}\n` +
          `[gtg] Shown once. Sign in and change it, or set GTG_ADMIN_PASSWORD to choose your own.\n`,
      );
    }
  }

  return result;
}

/**
 * Gives each company its logo, where a rule covers it.
 *
 * Only fills a logo that is unset, so a logo chosen by an administrator later
 * is never overwritten by a rule on the next boot.
 */
function applyCompanyLogos(): void {
  for (const company of listAllCompanies()) {
    if (company.logo) continue;
    const logo = logoFor(company);
    if (logo) updateCompany(company.id, { logo });
  }
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
