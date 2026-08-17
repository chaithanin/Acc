import { cookies } from 'next/headers';
import { getDb, newId, nowIso } from '@/lib/db';
import { findUserById, findUserByEmail, verifyPassword } from '@/lib/db/repositories/users';
import type { Role, User } from '@/lib/types';

/**
 * Session-cookie authentication (requirement 30).
 *
 * Sessions are opaque random ids stored server-side, so a session can be
 * revoked and nothing sensitive travels in the cookie itself.
 */

export const SESSION_COOKIE = 'gtg_session';
const SESSION_DAYS = 7;

export async function signIn(email: string, password: string): Promise<User | null> {
  const user = findUserByEmail(email);
  if (!user || !user.active) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;

  const sessionId = newId();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);

  getDb()
    .prepare('INSERT INTO auth_sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(sessionId, user.id, expiresAt.toISOString(), nowIso());

  const store = await cookies();
  store.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });

  return { id: user.id, email: user.email, name: user.name, role: user.role, active: user.active };
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (sessionId) {
    getDb().prepare('DELETE FROM auth_sessions WHERE id = ?').run(sessionId);
  }
  store.delete(SESSION_COOKIE);
}

/** Current user, or null when signed out or the session has lapsed. */
export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const row = getDb()
    .prepare<[string], { user_id: string; expires_at: string }>(
      'SELECT user_id, expires_at FROM auth_sessions WHERE id = ?',
    )
    .get(sessionId);

  if (!row) return null;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    getDb().prepare('DELETE FROM auth_sessions WHERE id = ?').run(sessionId);
    return null;
  }

  const user = findUserById(row.user_id);
  return user?.active ? user : null;
}

/**
 * Permission matrix (requirement 30).
 *
 * Kept as data so a new capability is one entry here rather than a scatter of
 * role checks across route handlers.
 */
export const PERMISSIONS = {
  'dashboard:view': ['admin', 'finance', 'management', 'viewer'],
  'export:run': ['admin', 'finance', 'management'],
  'import:run': ['admin', 'finance'],
  'import:rollback': ['admin', 'finance'],
  'mapping:edit': ['admin', 'finance'],
  'projects:edit': ['admin', 'finance'],
  'users:manage': ['admin'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(user: User | null, permission: Permission): boolean {
  if (!user) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(user.role);
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  finance: 'Finance',
  management: 'Management',
  viewer: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Full control, including user management.',
  finance: 'Upload, mapping, editing and recalculation.',
  management: 'View dashboards and export.',
  viewer: 'Read only.',
};

/** Removes lapsed sessions. Cheap enough to call on sign-in. */
export function purgeExpiredSessions(): void {
  getDb().prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(nowIso());
}
