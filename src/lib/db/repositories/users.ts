import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Role, User } from '@/lib/types';
import { fromDbBool, getDb, newId, nowIso, toDbBool } from '../index';

/**
 * User accounts and password hashing.
 *
 * scrypt with a per-user random salt; verification is constant-time. The
 * parameters are encoded into the stored hash so they can be raised later
 * without invalidating existing passwords.
 */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');

  let derived: Buffer;
  try {
    derived = scryptSync(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
  } catch {
    return false;
  }

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: number;
  password_hash: string;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: fromDbBool(row.active),
  };
}

export function findUserByEmail(email: string): (User & { passwordHash: string }) | null {
  const row = getDb()
    .prepare<[string], UserRow>('SELECT * FROM users WHERE lower(email) = lower(?)')
    .get(email.trim());
  return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
}

export function findUserById(id: string): User | null {
  const row = getDb().prepare<[string], UserRow>('SELECT * FROM users WHERE id = ?').get(id);
  return row ? toUser(row) : null;
}

export function listUsers(): User[] {
  return getDb()
    .prepare<[], UserRow>('SELECT * FROM users ORDER BY name')
    .all()
    .map(toUser);
}

export function createUser(input: {
  email: string;
  name: string;
  password: string;
  role: Role;
}): User {
  const id = newId();
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(id, input.email.trim().toLowerCase(), input.name, hashPassword(input.password), input.role, now, now);
  return findUserById(id)!;
}

export function setUserActive(id: string, active: boolean): void {
  getDb()
    .prepare('UPDATE users SET active = ?, updated_at = ? WHERE id = ?')
    .run(toDbBool(active), nowIso(), id);
}

export function setUserRole(id: string, role: Role): void {
  getDb().prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, nowIso(), id);
}

export function countUsers(): number {
  const row = getDb().prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM users').get();
  return row?.n ?? 0;
}
