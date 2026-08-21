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

/**
 * Is this a deployment serving real data?
 *
 * Read from the environment each time rather than captured at module load, so
 * a test can set it around a single call.
 */
const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * The administrator secret, or null when it was not really supplied.
 *
 * An empty string and a string of spaces are both "not supplied". Treating
 * them as a password is how a deployment ends up with an administrator whose
 * password is nothing at all — the compose file defaults this variable to an
 * empty string, so it arrives set on every deploy that forgot it.
 */
function adminSecret(override?: string): string | null {
  const raw = override ?? process.env.GTG_ADMIN_PASSWORD ?? '';
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
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
    const email = (process.env.GTG_ADMIN_EMAIL ?? 'admin@globaltopgroup.local').trim();
    const supplied = adminSecret(options.adminPassword);

    // In production the secret must be provided. Generating one instead would
    // mean the security of a system holding six companies' financial records
    // depended on someone reading a log line, and a blank one would mean it
    // depended on nothing at all. Failing to start is recoverable; an
    // administrator account with no password is not.
    if (!supplied && isProduction()) {
      throw new Error(
        'GTG_ADMIN_PASSWORD is not set. The first administrator cannot be created without it. ' +
          'Set it in the deployment environment and start again.',
      );
    }

    const password = supplied ?? generatePassword();
    const admin = createUser({ email, name: 'Administrator', password, role: 'admin' });
    result.createdAdmin = { email, password };

    // The first administrator is granted every company. Grants are what the
    // company chooser lists, so without this the only account that exists
    // would sign in to an empty screen with no way to grant itself anything.
    for (const company of listAllCompanies()) grantCompany(admin.id, company.id);

    // Printed only when this is not production and the password was generated
    // here, so a real credential never reaches a log file. Nothing is printed
    // when the password was supplied: it is already known to whoever set it.
    if (!supplied && !isProduction()) {
      console.warn(
        `\n[gtg] Created the first administrator account (development only).\n` +
          `[gtg]   email:    ${email}\n` +
          `[gtg]   password: ${password}\n` +
          `[gtg] Set GTG_ADMIN_PASSWORD to choose your own.\n`,
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
