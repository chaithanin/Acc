import { cookies } from 'next/headers';
import { getDb, newId, nowIso } from '@/lib/db';
import { companyForUser, type Company } from '@/lib/db/repositories/companies';
import { canSignIn, findUserById, findUserByEmail, verifyPassword } from '@/lib/db/repositories/users';
import {
  clearFailures,
  clientKey,
  emailKey,
  lockoutFor,
  purgeOldAttempts,
  recordFailure,
} from './throttle';
import type { Role, User } from '@/lib/types';

/**
 * Session-cookie authentication (requirement 30).
 *
 * Sessions are opaque random ids stored server-side, so a session can be
 * revoked and nothing sensitive travels in the cookie itself.
 */

export const SESSION_COOKIE = 'gtg_session';
const SESSION_DAYS = 7;

/**
 * The outcome of an attempt at the sign-in form.
 *
 * A refusal says whether it was the password or the rate limit, because the
 * caller has to show a different message; it never says whether the address
 * exists, which is the thing worth hiding.
 */
export type SignInResult =
  | { ok: true; user: User }
  | { ok: false; reason: 'refused' }
  | { ok: false; reason: 'throttled'; retryAfterSeconds: number };

export async function attemptSignIn(
  email: string,
  password: string,
  clientAddress: string | null,
): Promise<SignInResult> {
  purgeOldAttempts();

  // Counted against the address typed and the caller's own address. A guesser
  // has to stay under the limit on both.
  const identifiers = [emailKey(email), ...(clientAddress ? [clientKey(clientAddress)] : [])];

  const locked = lockoutFor(identifiers);
  if (locked > 0) return { ok: false, reason: 'throttled', retryAfterSeconds: locked };

  const user = findUserByEmail(email);
  // An expired or deactivated account is refused before the password is even
  // checked, and refused identically either way so the response cannot be used
  // to work out which accounts exist.
  if (!user || !canSignIn(user)) {
    recordFailure(identifiers);
    return { ok: false, reason: 'refused' };
  }
  if (!verifyPassword(password, user.passwordHash)) {
    recordFailure(identifiers);
    return { ok: false, reason: 'refused' };
  }

  // Someone who mistyped their password four times and then got it right is
  // not part-way to a lockout on their next visit.
  clearFailures(identifiers);

  return { ok: true, user: await openSession(user) };
}

/**
 * Signs in without the rate limit.
 *
 * Kept for callers that are not the sign-in form and have already established
 * who they are talking to.
 */
export async function signIn(email: string, password: string): Promise<User | null> {
  const user = findUserByEmail(email);
  if (!user || !canSignIn(user)) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return openSession(user);
}

/** Opens a session for a user whose password has already been checked. */
async function openSession(user: User & { passwordHash: string }): Promise<User> {
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

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    active: user.active,
    expiresAt: user.expiresAt,
  };
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (sessionId) {
    getDb().prepare('DELETE FROM auth_sessions WHERE id = ?').run(sessionId);
  }
  store.delete(SESSION_COOKIE);
}

interface SessionRow {
  user_id: string;
  expires_at: string;
  active_company_id: string | null;
}

/** The live session row, or null when signed out, lapsed, or barred. */
async function currentSession(): Promise<{ id: string; row: SessionRow; user: User } | null> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const row = getDb()
    .prepare<[string], SessionRow>(
      'SELECT user_id, expires_at, active_company_id FROM auth_sessions WHERE id = ?',
    )
    .get(sessionId);

  if (!row) return null;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    getDb().prepare('DELETE FROM auth_sessions WHERE id = ?').run(sessionId);
    return null;
  }

  const user = findUserById(row.user_id);
  // Re-checked on every request rather than only at sign-in, so an account
  // that expires or is disabled mid-session loses access immediately.
  if (!user || !canSignIn(user)) return null;

  return { id: sessionId, row, user };
}

/** Current user, or null when signed out or the session has lapsed. */
export async function currentUser(): Promise<User | null> {
  return (await currentSession())?.user ?? null;
}

/**
 * The company this session is working in — re-checked against the user's
 * grants on every request, not trusted from the session row alone.
 *
 * A grant removed while someone is signed in therefore takes effect at once,
 * and a session row that names a company the user can no longer see resolves
 * to nothing rather than to that company.
 */
export async function activeCompany(): Promise<Company | null> {
  const session = await currentSession();
  if (!session?.row.active_company_id) return null;
  return companyForUser(session.user.id, session.row.active_company_id);
}

/**
 * Chooses the company for this session.
 *
 * Refuses a company the user has no grant for, so the choice cannot be made by
 * posting an id — the request names a company, the server decides whether it
 * is allowed.
 */
export async function setActiveCompany(companyId: string): Promise<Company | null> {
  const session = await currentSession();
  if (!session) return null;

  const company = companyForUser(session.user.id, companyId);
  if (!company) return null;

  getDb()
    .prepare('UPDATE auth_sessions SET active_company_id = ? WHERE id = ?')
    .run(company.id, session.id);

  return company;
}

/** Returns to the company chooser without ending the session. */
export async function clearActiveCompany(): Promise<void> {
  const session = await currentSession();
  if (!session) return;

  getDb()
    .prepare('UPDATE auth_sessions SET active_company_id = NULL WHERE id = ?')
    .run(session.id);
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
