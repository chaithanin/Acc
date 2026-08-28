import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Single shared SQLite connection.
 *
 * The rest of the codebase talks to this through repository functions only, so
 * swapping in a PostgreSQL driver later means rewriting `src/lib/db/*` and
 * nothing else. See `docs/DATABASE.md` for the migration notes.
 */

export const DATA_DIR = process.env.GTG_DATA_DIR
  ? path.resolve(process.env.GTG_DATA_DIR)
  : path.join(process.cwd(), 'data');

export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'gtg-financial.db');

let instance: Database.Database | null = null;

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export function getDb(): Database.Database {
  if (instance) return instance;

  ensureDirs();
  const db = new Database(DB_PATH);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const schema = fs.readFileSync(path.join(process.cwd(), 'src/lib/db/schema.sql'), 'utf8');
  db.exec(schema);
  applyMigrations(db);

  instance = db;
  return db;
}

/**
 * Additive migrations for databases created by an earlier version.
 *
 * `CREATE TABLE IF NOT EXISTS` leaves an existing table exactly as it was, so
 * a column added to the schema never reaches a deployment that already has
 * data. Each entry below is checked against the live table and added if
 * missing, which is safe to run on every start.
 */
/**
 * Tables whose rows belong to exactly one company.
 *
 * Listed once so a new fact table cannot be added to the schema and quietly
 * left out of the isolation — the migration, the backfill and the index all
 * read from here.
 */
export const COMPANY_SCOPED_TABLES = [
  'imports',
  'bank_balances',
  'income_records',
  'expense_records',
  'receivable_records',
  'payable_records',
  'boq_records',
  'wip_records',
  'gl_entries',
  'cashflow_forecasts',
  'calculated_metrics',
  'financial_snapshots',
] as const;

function applyMigrations(db: Database.Database): void {
  const columns: { table: string; column: string; definition: string }[] = [
    { table: 'users', column: 'expires_at', definition: 'TEXT' },
    { table: 'wip_records', column: 'stated_closing', definition: 'NUMERIC' },
    { table: 'projects', column: 'company_id', definition: 'TEXT REFERENCES companies(id)' },
    // Master data is company data too. A budget without a company was the
    // group's budget, so the second company to enter one overwrote the first;
    // a template without one belonged to everybody, so disabling it disabled
    // it for everybody.
    { table: 'budgets', column: 'company_id', definition: 'TEXT REFERENCES companies(id)' },
    { table: 'template_mappings', column: 'company_id', definition: 'TEXT REFERENCES companies(id)' },
    { table: 'import_previews', column: 'company_id', definition: 'TEXT REFERENCES companies(id)' },
    {
      table: 'auth_sessions',
      column: 'active_company_id',
      definition: 'TEXT REFERENCES companies(id)',
    },
    // Every fact table carries the company as its own column. It could be
    // reached through project_id each time, but a record whose project is
    // unassigned would then belong to no company and fall out of every scoped
    // query — and a join is one more place a filter can be left off.
    ...COMPANY_SCOPED_TABLES.map((table) => ({
      table,
      column: 'company_id',
      definition: 'TEXT REFERENCES companies(id)',
    })),
  ];

  for (const { table, column, definition } of columns) {
    const existing = db
      .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
      .all()
      .map((c) => c.name);

    if (existing.length === 0) continue; // table not created yet
    if (existing.includes(column)) continue;

    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  // Indexes on migrated columns belong here rather than in the schema file,
  // which runs before these columns exist on an upgraded database.
  db.exec('CREATE INDEX IF NOT EXISTS idx_projects_company ON projects(company_id)');

  // The budget key gained the company. An index of that name may already exist
  // over (month, project) alone, and CREATE ... IF NOT EXISTS would leave it
  // there — so it is dropped and rewritten. Dropping an index loses no data.
  db.exec('DROP INDEX IF EXISTS idx_budget_period');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_period
             ON budgets(IFNULL(company_id, ''), month, IFNULL(project_id, ''))`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_templates_company ON template_mappings(company_id)');
  for (const table of COMPANY_SCOPED_TABLES) {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_company ON ${table}(company_id)`);
  }

  backfillCompanies(db);
  backfillRecordCompanies(db);
}

/**
 * Fills company_id on data imported before companies existed.
 *
 * Derived from the project each record already names. A record with no project
 * is left null rather than guessed at: it belongs to no company, and no
 * company's dashboard should quietly acquire it.
 */
function backfillRecordCompanies(db: Database.Database): void {
  for (const table of COMPANY_SCOPED_TABLES) {
    const columns = db
      .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
      .all()
      .map((c) => c.name);

    if (!columns.includes('company_id') || !columns.includes('project_id')) continue;

    db.exec(`
      UPDATE ${table}
         SET company_id = (SELECT p.company_id FROM projects p WHERE p.id = ${table}.project_id)
       WHERE company_id IS NULL AND project_id IS NOT NULL
    `);
  }

  // A snapshot belongs to whichever company its import does. Done before the
  // imports backfill below, which is the weaker inference of the two.
  const snapshotColumns = db
    .prepare<[], { name: string }>('PRAGMA table_info(financial_snapshots)')
    .all()
    .map((c) => c.name);

  if (snapshotColumns.includes('company_id')) {
    db.exec(`
      UPDATE financial_snapshots
         SET company_id = (SELECT i.company_id FROM imports i WHERE i.id = financial_snapshots.import_id)
       WHERE company_id IS NULL
    `);
  }

  // A budget or template naming a project belongs to that project's company.
  // One naming no project cannot be placed — it was the group's — and is left
  // null: a budget nobody sees is a visible gap, a budget the wrong company
  // sees is not.
  for (const table of ['budgets', 'template_mappings']) {
    const columns = db
      .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
      .all()
      .map((c) => c.name);
    if (!columns.includes('company_id')) continue;

    db.exec(`
      UPDATE ${table}
         SET company_id = (SELECT p.company_id FROM projects p WHERE p.id = ${table}.project_id)
       WHERE company_id IS NULL AND project_id IS NOT NULL
    `);
  }

  // An import predating companies has no company of its own; it takes the one
  // its records agree on, and stays null when they do not agree.
  const importColumns = db
    .prepare<[], { name: string }>('PRAGMA table_info(imports)')
    .all()
    .map((c) => c.name);

  if (importColumns.includes('company_id')) {
    db.exec(`
      UPDATE imports
         SET company_id = (
           SELECT MIN(company_id) FROM income_records r
            WHERE r.import_id = imports.id AND r.company_id IS NOT NULL
              AND (SELECT COUNT(DISTINCT company_id) FROM income_records x
                    WHERE x.import_id = imports.id AND x.company_id IS NOT NULL) = 1
         )
       WHERE company_id IS NULL
    `);

    // Imports may have just learned their company from their records, so
    // snapshots get a second chance at inheriting it.
    if (snapshotColumns.includes('company_id')) {
      db.exec(`
        UPDATE financial_snapshots
           SET company_id = (SELECT i.company_id FROM imports i WHERE i.id = financial_snapshots.import_id)
         WHERE company_id IS NULL
      `);
    }
  }
}

/**
 * Turns the old free-text `projects.company` into real company rows.
 *
 * Companies used to exist only as a label repeated on each project. A
 * deployment that already holds a year of data cannot be asked to re-enter
 * them, so each distinct spelling becomes a company and its projects are
 * linked to it.
 *
 * Everyone who could already sign in is granted every company that results.
 * The alternative — starting with no grants — would lock every existing user
 * out of their own data at the moment of upgrade, which is a worse failure
 * than the permissive default an administrator can narrow afterwards.
 */
export function backfillCompanies(db: Database.Database = getDb()): void {
  const hasCompanies = db
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='companies'")
    .get();
  if (!hasCompanies) return;

  const alreadyDone = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM companies').get();
  if ((alreadyDone?.n ?? 0) > 0) return;

  const labels = db
    .prepare<[], { company: string }>(
      "SELECT DISTINCT company FROM projects WHERE company IS NOT NULL AND TRIM(company) <> ''",
    )
    .all();

  if (labels.length === 0) return;

  const now = new Date().toISOString();

  db.transaction(() => {
    for (const [index, { company }] of labels.entries()) {
      const id = crypto.randomUUID();

      // The old data has no company codes, so one is derived. A Thai company
      // name yields nothing under this rule, and most of these names are Thai,
      // so the fallback is the code of a project the company owns — MARINA_VTR
      // reads as that company far better than COMPANY_4 does. An administrator
      // can rename it either way.
      const candidate = company
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 24);

      // A Thai name that happens to contain a digit — "…เรสซิเด้นซ์ 9 จำกัด" —
      // would otherwise reduce to the code "9". A usable code has a letter in
      // it and is more than one character; anything else falls through.
      const fromName = /[A-Z]/.test(candidate) && candidate.length > 1 ? candidate : '';

      const projectCode = db
        .prepare<[string], { code: string }>(
          'SELECT code FROM projects WHERE company = ? ORDER BY sort_order, code LIMIT 1',
        )
        .get(company)?.code;

      const code = fromName || projectCode?.toUpperCase().slice(0, 24) || `COMPANY_${index + 1}`;

      db.prepare(
        `INSERT INTO companies
           (id, company_code, legal_name, display_name, logo, sort_order, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, 1, ?, ?)`,
      ).run(id, code, company, company, (index + 1) * 10, now, now);

      db.prepare('UPDATE projects SET company_id = ? WHERE company = ?').run(id, company);

      db.prepare(
        `INSERT OR IGNORE INTO user_companies (id, user_id, company_id, created_at)
         SELECT lower(hex(randomblob(16))), id, ?, ? FROM users`,
      ).run(id, now);
    }
  })();
}

/** Runs `fn` inside a transaction; any throw rolls the whole thing back. */
export function transaction<T>(fn: () => T): T {
  const db = getDb();
  return db.transaction(fn)();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

/** SQLite has no boolean type; these keep the 0/1 convention in one place. */
export function toDbBool(value: boolean): number {
  return value ? 1 : 0;
}

export function fromDbBool(value: unknown): boolean {
  return value === 1 || value === true || value === '1';
}

/** Safely parses a JSON column, returning `fallback` on any problem. */
export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
