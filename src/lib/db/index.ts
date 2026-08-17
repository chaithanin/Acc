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

  instance = db;
  return db;
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
