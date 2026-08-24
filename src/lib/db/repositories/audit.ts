import { getDb, newId, nowIso } from '@/lib/db';

/**
 * Who changed what.
 *
 * The import tables already name the person who ran an import, but until this
 * existed a role change, a grant, a company rename, a password reset and a
 * rollback left nothing behind that said who did it. For a system holding six
 * companies' financial records that is the difference between "the figure
 * changed" and "the figure changed because Somsak re-ran the August import at
 * four o'clock".
 *
 * Entries are written and read; nothing edits or deletes one. That is the
 * point of a log, and it is enforced here by there being no such function.
 */

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string | null;
  actorEmail: string;
  actorRole: string;
  companyId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  summary: string;
  detail: Record<string, unknown> | null;
  ip: string | null;
}

export interface NewAuditEntry {
  actorId: string | null;
  actorEmail: string;
  actorRole: string;
  companyId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  summary: string;
  detail?: Record<string, unknown> | null;
  ip?: string | null;
}

interface Row {
  id: string;
  at: string;
  actor_id: string | null;
  actor_email: string;
  actor_role: string;
  company_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  summary: string;
  detail: string | null;
  ip: string | null;
}

function toEntry(row: Row): AuditEntry {
  let detail: Record<string, unknown> | null = null;
  if (row.detail) {
    // A malformed entry is still an entry. It is shown as text rather than
    // throwing and taking the whole page down with it.
    try {
      detail = JSON.parse(row.detail) as Record<string, unknown>;
    } catch {
      detail = { raw: row.detail };
    }
  }

  return {
    id: row.id,
    at: row.at,
    actorId: row.actor_id,
    actorEmail: row.actor_email,
    actorRole: row.actor_role,
    companyId: row.company_id,
    action: row.action,
    entity: row.entity,
    entityId: row.entity_id,
    summary: row.summary,
    detail,
    ip: row.ip,
  };
}

export function writeAudit(entry: NewAuditEntry): string {
  const id = newId();
  getDb()
    .prepare(
      `INSERT INTO audit_log
         (id, at, actor_id, actor_email, actor_role, company_id, action, entity, entity_id, summary, detail, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      nowIso(),
      entry.actorId,
      entry.actorEmail,
      entry.actorRole,
      entry.companyId ?? null,
      entry.action,
      entry.entity,
      entry.entityId ?? null,
      entry.summary,
      entry.detail ? JSON.stringify(entry.detail) : null,
      entry.ip ?? null,
    );
  return id;
}

/**
 * The log, newest first.
 *
 * Entries that name no company are the ones that are not about one — an
 * account created, a password reset — and they are included whatever company
 * is being viewed, because whoever is reading the log needs to see them.
 */
export function listAudit(
  options: { companyId?: string | null; limit?: number; action?: string } = {},
): AuditEntry[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.companyId) {
    where.push('(company_id = ? OR company_id IS NULL)');
    params.push(options.companyId);
  }
  if (options.action) {
    where.push('action LIKE ?');
    params.push(`${options.action}%`);
  }

  const sql =
    'SELECT * FROM audit_log'
    + (where.length ? ` WHERE ${where.join(' AND ')}` : '')
    + ' ORDER BY at DESC, rowid DESC LIMIT ?';
  params.push(options.limit ?? 200);

  return getDb().prepare<unknown[], Row>(sql).all(...params).map(toEntry);
}

export function countAudit(): number {
  return getDb().prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM audit_log').get()?.n ?? 0;
}
