import { getDb, newId, nowIso } from '@/lib/db';

/**
 * Slowing down someone guessing at the sign-in form.
 *
 * The form was answering a wrong password in about fifty milliseconds and
 * counting nothing, so a list of common passwords could be worked through
 * against a known address indefinitely. Six companies' financial records are
 * behind it.
 *
 * Attempts are counted twice over: against the address that was typed, and
 * against the caller's own address. Counting only the first lets a guesser
 * work through a list of addresses one attempt each; counting only the second
 * lets one behind a rotating address through. Both have to be under the limit.
 *
 * A lockout is deliberately short. The point is to make guessing cost hours
 * per password rather than to lock a person out of their own account for the
 * afternoon — and a long lockout keyed on an address is itself a way to deny
 * someone their account.
 */

/**
 * Failures allowed against one address inside the window.
 *
 * Eight is well past what a person mistypes and nowhere near enough to work
 * through a password list.
 */
export const MAX_ATTEMPTS = 8;

/**
 * Failures allowed from one caller inside the window.
 *
 * Much higher, and deliberately so. Caddy passes the real client address
 * through, but a whole office can still share one — and if one person's eight
 * mistakes locked everybody out of the building, the limit would be a way to
 * stop the company working rather than a way to protect it. It is high enough
 * to be invisible to a floor of people having a bad morning and low enough to
 * stop someone working through a list of addresses from one machine.
 */
export const MAX_CLIENT_ATTEMPTS = 40;

/** How far back failures are counted, in minutes. */
export const WINDOW_MINUTES = 15;

/** How long a locked identifier stays locked, in minutes. */
export const LOCKOUT_MINUTES = 15;

const windowStart = () => new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();

export const emailKey = (email: string) => `email:${email.trim().toLowerCase()}`;
export const clientKey = (ip: string) => `client:${ip.trim()}`;

/** Failures recorded against one identifier inside the window. */
export function failuresFor(identifier: string): number {
  return (
    getDb()
      .prepare<[string, string], { n: number }>(
        'SELECT COUNT(*) AS n FROM sign_in_attempts WHERE identifier = ? AND attempted_at >= ?',
      )
      .get(identifier, windowStart())?.n ?? 0
  );
}

/** How many failures this kind of identifier is allowed. */
const limitFor = (identifier: string) =>
  identifier.startsWith('client:') ? MAX_CLIENT_ATTEMPTS : MAX_ATTEMPTS;

/**
 * Seconds until this identifier may try again, or 0 when it may try now.
 *
 * Measured from the most recent failure rather than the first, so continuing
 * to guess while locked out extends the lockout instead of running it down.
 */
export function lockedForSeconds(identifier: string): number {
  if (failuresFor(identifier) < limitFor(identifier)) return 0;

  const last = getDb()
    .prepare<[string], { at: string }>(
      'SELECT MAX(attempted_at) AS at FROM sign_in_attempts WHERE identifier = ?',
    )
    .get(identifier)?.at;
  if (!last) return 0;

  const until = new Date(last).getTime() + LOCKOUT_MINUTES * 60_000;
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

/** The longest lockout across every identifier involved in one attempt. */
export function lockoutFor(identifiers: string[]): number {
  return identifiers.reduce((worst, id) => Math.max(worst, lockedForSeconds(id)), 0);
}

export function recordFailure(identifiers: string[]): void {
  const db = getDb();
  const insert = db.prepare(
    'INSERT INTO sign_in_attempts (id, identifier, attempted_at) VALUES (?, ?, ?)',
  );
  const at = nowIso();
  const write = db.transaction((ids: string[]) => {
    for (const id of ids) insert.run(newId(), id, at);
  });
  write(identifiers);
}

/**
 * Forgets the failures for these identifiers.
 *
 * Called after a correct password: someone who mistyped theirs four times and
 * then got it right is not part-way to a lockout on their next visit.
 */
export function clearFailures(identifiers: string[]): void {
  const db = getDb();
  const remove = db.prepare('DELETE FROM sign_in_attempts WHERE identifier = ?');
  const write = db.transaction((ids: string[]) => {
    for (const id of ids) remove.run(id);
  });
  write(identifiers);
}

/** Drops attempts older than the window. Cheap enough to call on sign-in. */
export function purgeOldAttempts(): void {
  getDb().prepare('DELETE FROM sign_in_attempts WHERE attempted_at < ?').run(windowStart());
}

/** "15 minutes", "45 seconds" — for the message the form shows. */
export function describeWait(seconds: number): string {
  if (seconds >= 60) {
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  return `${Math.max(1, seconds)} second${seconds === 1 ? '' : 's'}`;
}
