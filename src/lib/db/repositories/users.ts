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
  expires_at: string | null;
  password_hash: string;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: fromDbBool(row.active),
    expiresAt: row.expires_at ?? null,
  };
}

/**
 * Whether an account has passed its expiry date.
 *
 * Compared on calendar date rather than timestamp, so an account set to expire
 * on the 31st is usable for the whole of the 31st.
 */
export function isExpired(user: Pick<User, 'expiresAt'>, today = new Date()): boolean {
  if (!user.expiresAt) return false;
  return user.expiresAt < today.toISOString().slice(0, 10);
}

/** An account may sign in only if it is active and not past its expiry. */
export function canSignIn(user: Pick<User, 'active' | 'expiresAt'>): boolean {
  return user.active && !isExpired(user);
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
  expiresAt?: string | null;
}): User {
  const id = newId();
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO users (id, email, name, password_hash, role, active, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .run(
      id,
      input.email.trim().toLowerCase(),
      input.name,
      hashPassword(input.password),
      input.role,
      input.expiresAt || null,
      now,
      now,
    );
  return findUserById(id)!;
}

/**
 * Replaces a user's password and signs them out everywhere.
 *
 * Revoking sessions is the point: a password is usually changed because the
 * old one may be known to someone else, and leaving their sessions alive would
 * defeat the change entirely.
 */
export function setUserPassword(id: string, password: string): void {
  const db = getDb();
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(hashPassword(password), nowIso(), id);
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(id);
}

/** Sets or clears the expiry date. Passing null removes it. */
export function setUserExpiry(id: string, expiresAt: string | null): void {
  getDb()
    .prepare('UPDATE users SET expires_at = ?, updated_at = ? WHERE id = ?')
    .run(expiresAt || null, nowIso(), id);

  // An account expiring today or earlier should not keep a live session.
  const user = findUserById(id);
  if (user && isExpired(user)) {
    getDb().prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(id);
  }
}

/** Updates the editable profile fields in one go. */
export function updateUser(
  id: string,
  input: {
    name?: string;
    email?: string;
    role?: Role;
    expiresAt?: string | null;
    active?: boolean;
  },
): User | null {
  const existing = findUserById(id);
  if (!existing) return null;

  // The email is the sign-in name, so a change to it changes how someone gets
  // in. Normalised the same way it is at sign-in, or a stray capital would
  // lock the account out of itself.
  const email = input.email?.trim().toLowerCase() || existing.email;

  if (email !== existing.email) {
    const taken = findUserByEmail(email);
    if (taken && taken.id !== id) {
      throw new Error(`${email} is already used by another account.`);
    }
  }

  getDb()
    .prepare(
      `UPDATE users SET name = ?, email = ?, role = ?, expires_at = ?, active = ?, updated_at = ?
        WHERE id = ?`,
    )
    .run(
      input.name?.trim() || existing.name,
      email,
      input.role ?? existing.role,
      input.expiresAt === undefined ? existing.expiresAt : input.expiresAt || null,
      toDbBool(input.active ?? existing.active),
      nowIso(),
      id,
    );

  const updated = findUserById(id);
  // Anything that removes access takes effect now rather than at next sign-in.
  if (updated && !canSignIn(updated)) {
    getDb().prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(id);
  }
  return updated;
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
