import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

/**
 * How the first administrator is created.
 *
 * This is the account that reaches six companies' financial records, and it is
 * created by a machine with no one watching. The cases below are the ways that
 * went wrong: a blank secret that looked supplied, and a generated one whose
 * only copy was a log line or a rendered page.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtg-bootstrap-'));
process.env.GTG_DATA_DIR = dir;

let bootstrap: typeof import('@/lib/db/bootstrap');
let users: typeof import('@/lib/db/repositories/users');

const originalEnv = { ...process.env };

before(async () => {
  bootstrap = await import('@/lib/db/bootstrap');
  users = await import('@/lib/db/repositories/users');
});

after(() => {
  process.env.NODE_ENV = originalEnv.NODE_ENV;
  delete process.env.GTG_ADMIN_PASSWORD;
  fs.rmSync(dir, { recursive: true, force: true });
});

function asProduction(password: string | undefined) {
  process.env.NODE_ENV = 'production';
  if (password === undefined) delete process.env.GTG_ADMIN_PASSWORD;
  else process.env.GTG_ADMIN_PASSWORD = password;
}

describe('first administrator', () => {
  it('refuses to start in production with no secret', () => {
    asProduction(undefined);
    assert.throws(() => bootstrap.bootstrapDatabase(), /GTG_ADMIN_PASSWORD is not set/);
    assert.equal(users.countUsers(), 0);
  });

  it('refuses a blank secret, which is what an unset variable looks like', () => {
    // The compose file used to default this to an empty string, so it arrived
    // set on every deploy that had forgotten it.
    for (const blank of ['', '   ', '\t']) {
      asProduction(blank);
      assert.throws(() => bootstrap.bootstrapDatabase(), /GTG_ADMIN_PASSWORD is not set/);
    }
    assert.equal(users.countUsers(), 0);
  });

  it('creates the administrator when a real secret is supplied', () => {
    asProduction('a-properly-long-secret');
    const result = bootstrap.bootstrapDatabase();

    assert.equal(users.countUsers(), 1);
    assert.equal(result.createdAdmin?.email, 'admin@globaltopgroup.local');

    const admin = users.findUserByEmail('admin@globaltopgroup.local');
    assert.ok(admin);
    assert.equal(admin.role, 'admin');
    assert.ok(users.verifyPassword('a-properly-long-secret', admin.passwordHash));
  });

  it('does nothing on a second run, secret or not', () => {
    asProduction(undefined);
    const result = bootstrap.bootstrapDatabase();

    // No throw: the secret is only needed while there is no administrator.
    assert.equal(result.createdAdmin, null);
    assert.equal(users.countUsers(), 1);
  });
});

describe('password policy', () => {
  it('is enforced where passwords are stored, not only in the form', () => {
    // The form is one caller. The seed path and the command-line tool are
    // others, and each could otherwise write a password the policy refuses.
    assert.throws(
      () => users.createUser({ email: 'a@example.com', name: 'A', password: '', role: 'viewer' }),
      /password is required/i,
    );
    assert.throws(
      () => users.createUser({ email: 'b@example.com', name: 'B', password: 'short', role: 'viewer' }),
      /at least/i,
    );
  });

  it('refuses to replace a password with a blank one', () => {
    const admin = users.findUserByEmail('admin@globaltopgroup.local');
    assert.ok(admin);
    assert.throws(() => users.setUserPassword(admin.id, '   '), /password is required/i);
  });
});
