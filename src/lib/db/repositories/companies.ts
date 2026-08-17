import { getDb, newId, nowIso, toDbBool } from '@/lib/db';

/**
 * Companies, and who may see them.
 *
 * Every read here takes the user whose data it is. There is deliberately no
 * `listCompanies()` that ignores permission: a function that returns every
 * company is the one that eventually gets called from a page, and one call
 * like that undoes the isolation everywhere else.
 */

export interface Company {
  id: string;
  companyCode: string;
  legalName: string;
  displayName: string;
  logo: string | null;
  sortOrder: number;
  active: boolean;
  /** Active projects belonging to it. Shown on the selection card. */
  projectCount: number;
}

interface CompanyRow {
  id: string;
  company_code: string;
  legal_name: string;
  display_name: string;
  logo: string | null;
  sort_order: number;
  active: number;
  project_count: number;
}

const toCompany = (row: CompanyRow): Company => ({
  id: row.id,
  companyCode: row.company_code,
  legalName: row.legal_name,
  displayName: row.display_name,
  logo: row.logo,
  sortOrder: row.sort_order,
  active: row.active === 1,
  projectCount: row.project_count,
});

const SELECT = `
  SELECT c.id, c.company_code, c.legal_name, c.display_name, c.logo, c.sort_order, c.active,
         (SELECT COUNT(*) FROM projects p WHERE p.company_id = c.id AND p.active = 1) AS project_count
    FROM companies c
`;

/** Companies this user may work in, for the selection screen. */
export function companiesForUser(userId: string, includeInactive = false): Company[] {
  return getDb()
    .prepare<[string], CompanyRow>(
      `${SELECT}
        JOIN user_companies uc ON uc.company_id = c.id AND uc.user_id = ?
        ${includeInactive ? '' : 'WHERE c.active = 1'}
       ORDER BY c.sort_order, c.display_name`,
    )
    .all(userId)
    .map(toCompany);
}

/**
 * A company by id, only if this user may see it.
 *
 * Returns null rather than throwing, and returns the same null whether the
 * company does not exist or is merely not granted — a caller that told those
 * apart would let someone probe for which companies exist.
 */
export function companyForUser(userId: string, companyId: string): Company | null {
  const row = getDb()
    .prepare<[string, string], CompanyRow>(
      `${SELECT}
        JOIN user_companies uc ON uc.company_id = c.id AND uc.user_id = ?
       WHERE c.id = ? AND c.active = 1`,
    )
    .get(userId, companyId);

  return row ? toCompany(row) : null;
}

/** Same, by the code that appears in URLs. */
export function companyByCodeForUser(userId: string, code: string): Company | null {
  const row = getDb()
    .prepare<[string, string], CompanyRow>(
      `${SELECT}
        JOIN user_companies uc ON uc.company_id = c.id AND uc.user_id = ?
       WHERE UPPER(c.company_code) = UPPER(?) AND c.active = 1`,
    )
    .get(userId, code);

  return row ? toCompany(row) : null;
}

/** Every company, for administration screens only. */
export function listAllCompanies(includeInactive = true): Company[] {
  return getDb()
    .prepare<[], CompanyRow>(
      `${SELECT} ${includeInactive ? '' : 'WHERE c.active = 1'} ORDER BY c.sort_order, c.display_name`,
    )
    .all()
    .map(toCompany);
}

export function createCompany(input: {
  companyCode: string;
  legalName: string;
  displayName?: string;
  logo?: string | null;
  sortOrder?: number;
}): Company {
  const id = newId();
  const now = nowIso();

  getDb()
    .prepare(
      `INSERT INTO companies
         (id, company_code, legal_name, display_name, logo, sort_order, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      id,
      input.companyCode.trim().toUpperCase(),
      input.legalName.trim(),
      (input.displayName ?? input.legalName).trim(),
      input.logo ?? null,
      input.sortOrder ?? 100,
      now,
      now,
    );

  return listAllCompanies().find((c) => c.id === id)!;
}

export function updateCompany(
  id: string,
  changes: Partial<{
    companyCode: string;
    legalName: string;
    displayName: string;
    logo: string | null;
    sortOrder: number;
    active: boolean;
  }>,
): void {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if (changes.companyCode !== undefined) {
    sets.push('company_code = ?');
    values.push(changes.companyCode.trim().toUpperCase());
  }
  if (changes.legalName !== undefined) {
    sets.push('legal_name = ?');
    values.push(changes.legalName.trim());
  }
  if (changes.displayName !== undefined) {
    sets.push('display_name = ?');
    values.push(changes.displayName.trim());
  }
  if (changes.logo !== undefined) {
    sets.push('logo = ?');
    values.push(changes.logo);
  }
  if (changes.sortOrder !== undefined) {
    sets.push('sort_order = ?');
    values.push(changes.sortOrder);
  }
  if (changes.active !== undefined) {
    sets.push('active = ?');
    values.push(toDbBool(changes.active));
  }

  if (sets.length === 0) return;

  sets.push('updated_at = ?');
  values.push(nowIso(), id);

  getDb()
    .prepare(`UPDATE companies SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values);
}

/** Grants access. Idempotent, so re-granting is not an error. */
export function grantCompany(userId: string, companyId: string): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO user_companies (id, user_id, company_id, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(newId(), userId, companyId, nowIso());
}

export function revokeCompany(userId: string, companyId: string): void {
  getDb()
    .prepare('DELETE FROM user_companies WHERE user_id = ? AND company_id = ?')
    .run(userId, companyId);

  // A session working in a company the user just lost access to would keep
  // serving it until the session expired, so its selection is cleared and the
  // next request sends them back to the company chooser.
  getDb()
    .prepare(
      `UPDATE auth_sessions SET active_company_id = NULL
        WHERE user_id = ? AND active_company_id = ?`,
    )
    .run(userId, companyId);
}

export function companyIdsForUser(userId: string): string[] {
  return getDb()
    .prepare<[string], { company_id: string }>(
      'SELECT company_id FROM user_companies WHERE user_id = ?',
    )
    .all(userId)
    .map((r) => r.company_id);
}
