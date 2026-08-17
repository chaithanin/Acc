import { normalizeKey } from '@/lib/detect/normalize-text';
import type { Project } from '@/lib/types';
import { fromDbBool, getDb, newId, nowIso, toDbBool, transaction } from '../index';

interface ProjectRow {
  id: string;
  code: string;
  name: string;
  company: string | null;
  sort_order: number;
  active: number;
}

export function listProjects(includeInactive = false): Project[] {
  const db = getDb();
  const rows = db
    .prepare<[], ProjectRow>(
      `SELECT id, code, name, company, sort_order, active
         FROM projects
        ${includeInactive ? '' : 'WHERE active = 1'}
        ORDER BY sort_order, name`,
    )
    .all();

  const aliasRows = db
    .prepare<[], { project_id: string; alias: string }>(
      'SELECT project_id, alias FROM project_aliases ORDER BY alias',
    )
    .all();

  const aliases = new Map<string, string[]>();
  for (const row of aliasRows) {
    const list = aliases.get(row.project_id) ?? [];
    list.push(row.alias);
    aliases.set(row.project_id, list);
  }

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    company: row.company,
    sortOrder: row.sort_order,
    active: fromDbBool(row.active),
    aliases: aliases.get(row.id) ?? [],
  }));
}

export function getProject(id: string): Project | null {
  return listProjects(true).find((p) => p.id === id) ?? null;
}

export function createProject(input: {
  code: string;
  name: string;
  company?: string | null;
  sortOrder?: number;
  aliases?: string[];
}): Project {
  const db = getDb();
  const id = newId();
  const now = nowIso();

  transaction(() => {
    db.prepare(
      `INSERT INTO projects (id, code, name, company, sort_order, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(id, input.code, input.name, input.company ?? null, input.sortOrder ?? 100, now, now);

    // The project's own name and code are aliases too, so detection finds them
    // without any special-casing.
    for (const alias of [input.name, input.code, ...(input.aliases ?? [])]) {
      insertAlias(id, alias);
    }
  });

  return getProject(id)!;
}

export function updateProject(
  id: string,
  input: { name?: string; code?: string; company?: string | null; sortOrder?: number; active?: boolean },
): Project | null {
  const db = getDb();
  const existing = getProject(id);
  if (!existing) return null;

  db.prepare(
    `UPDATE projects
        SET name = ?, code = ?, company = ?, sort_order = ?, active = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    input.name ?? existing.name,
    input.code ?? existing.code,
    input.company === undefined ? existing.company : input.company,
    input.sortOrder ?? existing.sortOrder,
    toDbBool(input.active ?? existing.active),
    nowIso(),
    id,
  );

  return getProject(id);
}

export class AliasConflictError extends Error {
  readonly alias: string;
  readonly ownerProjectId: string;

  constructor(alias: string, ownerProjectId: string) {
    super(`The alias "${alias}" is already assigned to another project.`);
    this.name = 'AliasConflictError';
    this.alias = alias;
    this.ownerProjectId = ownerProjectId;
  }
}

/**
 * Adds an alias. Aliases are globally unique on their normalised key so two
 * projects can never both claim the same spelling — an ambiguous alias would
 * silently misroute imported data.
 */
export function addAlias(projectId: string, alias: string): void {
  const key = normalizeKey(alias);
  if (!key) throw new Error('An alias must contain at least one letter or digit.');

  const db = getDb();
  const existing = db
    .prepare<[string], { project_id: string }>(
      'SELECT project_id FROM project_aliases WHERE alias_key = ?',
    )
    .get(key);

  if (existing) {
    if (existing.project_id === projectId) return;
    throw new AliasConflictError(alias, existing.project_id);
  }

  insertAlias(projectId, alias);
}

function insertAlias(projectId: string, alias: string): void {
  const key = normalizeKey(alias);
  if (!key) return;
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO project_aliases (id, project_id, alias, alias_key, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(newId(), projectId, alias.trim(), key, nowIso());
}

export function removeAlias(projectId: string, alias: string): void {
  getDb()
    .prepare('DELETE FROM project_aliases WHERE project_id = ? AND alias_key = ?')
    .run(projectId, normalizeKey(alias));
}
