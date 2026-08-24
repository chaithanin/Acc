import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Slowing down someone guessing at the sign-in form.
 *
 * The audit found the form answering a wrong password in about fifty
 * milliseconds and counting nothing, so a password list could be worked
 * through against a known address indefinitely. These are the cases that
 * matter: the limit has to bite, it has to bite on the address typed *and* on
 * the caller's address separately, it must not lock out someone who mistyped
 * and then got it right, and it must not be a way to lock a colleague out.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtg-throttle-'));
process.env.GTG_DATA_DIR = dir;

let throttle: typeof import('@/lib/auth/throttle');
let db: typeof import('@/lib/db');

before(async () => {
  db = await import('@/lib/db');
  throttle = await import('@/lib/auth/throttle');
  db.getDb();
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  db.getDb().prepare('DELETE FROM sign_in_attempts').run();
});

const EMAIL = throttleKeyEmail('finance@globaltopgroup.local');
function throttleKeyEmail(email: string) {
  return `email:${email}`;
}

describe('sign-in rate limit', () => {
  it('allows the failures a person actually makes', () => {
    for (let i = 0; i < throttle.MAX_ATTEMPTS - 1; i += 1) {
      assert.equal(throttle.lockedForSeconds(EMAIL), 0, `locked after ${i} failures`);
      throttle.recordFailure([EMAIL]);
    }
    assert.equal(throttle.lockedForSeconds(EMAIL), 0);
  });

  it('refuses the next attempt once the limit is reached', () => {
    for (let i = 0; i < throttle.MAX_ATTEMPTS; i += 1) throttle.recordFailure([EMAIL]);

    const wait = throttle.lockedForSeconds(EMAIL);
    assert.ok(wait > 0, 'the limit did not bite');
    assert.ok(wait <= throttle.LOCKOUT_MINUTES * 60);
  });

  it('counts the address typed and the caller separately', () => {
    // A guesser working through a list of addresses from one machine makes one
    // failure per address, so counting the address alone would never notice.
    const client = throttle.clientKey('203.0.113.9');
    for (let i = 0; i < throttle.MAX_CLIENT_ATTEMPTS; i += 1) {
      throttle.recordFailure([throttle.emailKey(`victim${i}@example.com`), client]);
    }

    assert.equal(throttle.lockedForSeconds(throttle.emailKey('victim0@example.com')), 0,
      'a single failure locked an address');
    assert.ok(throttle.lockedForSeconds(client) > 0, 'the caller was not noticed');
    assert.ok(throttle.lockoutFor([throttle.emailKey('victim99@example.com'), client]) > 0,
      'an attempt from a locked caller was allowed through');
  });

  it('does not let one person’s mistakes lock out the office they share an address with', () => {
    // Everyone behind one NAT looks like one caller. If the caller limit were
    // the same as the address limit, one colleague mistyping their password
    // eight times would stop the whole floor signing in.
    const client = throttle.clientKey('198.51.100.4');
    for (let i = 0; i < throttle.MAX_ATTEMPTS; i += 1) {
      throttle.recordFailure([throttle.emailKey('clumsy@example.com'), client]);
    }

    assert.ok(throttle.lockedForSeconds(throttle.emailKey('clumsy@example.com')) > 0,
      'the address that was being guessed at was not locked');
    assert.equal(throttle.lockoutFor([throttle.emailKey('colleague@example.com'), client]), 0,
      'a colleague at the same address was locked out too');
  });

  it('forgets the failures once the password is right', () => {
    for (let i = 0; i < throttle.MAX_ATTEMPTS - 1; i += 1) throttle.recordFailure([EMAIL]);
    throttle.clearFailures([EMAIL]);

    assert.equal(throttle.failuresFor(EMAIL), 0);
    assert.equal(throttle.lockedForSeconds(EMAIL), 0);
  });

  it('extends the lockout when someone keeps guessing through it', () => {
    for (let i = 0; i < throttle.MAX_ATTEMPTS; i += 1) throttle.recordFailure([EMAIL]);
    const first = throttle.lockedForSeconds(EMAIL);

    // Measured from the most recent failure, so guessing through a lockout
    // does not run it down.
    throttle.recordFailure([EMAIL]);
    assert.ok(throttle.lockedForSeconds(EMAIL) >= first);
  });

  it('lets attempts outside the window go', () => {
    const old = new Date(Date.now() - (throttle.WINDOW_MINUTES + 5) * 60_000).toISOString();
    const insert = db.getDb().prepare(
      'INSERT INTO sign_in_attempts (id, identifier, attempted_at) VALUES (?, ?, ?)',
    );
    for (let i = 0; i < throttle.MAX_ATTEMPTS * 3; i += 1) insert.run(db.newId(), EMAIL, old);

    assert.equal(throttle.failuresFor(EMAIL), 0, 'attempts from an hour ago still counted');
    assert.equal(throttle.lockedForSeconds(EMAIL), 0);

    throttle.purgeOldAttempts();
    const left = db.getDb()
      .prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM sign_in_attempts')
      .get()?.n;
    assert.equal(left, 0, 'old attempts were not cleared away');
  });

  it('describes the wait in words a person can act on', () => {
    assert.equal(throttle.describeWait(900), '15 minutes');
    assert.equal(throttle.describeWait(60), '1 minute');
    assert.equal(throttle.describeWait(30), '30 seconds');
  });
});
