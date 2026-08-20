import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

/**
 * Editing a user, and what company access they end up with.
 *
 * The grant is the part worth testing: an account with none can sign in and
 * see nothing, which reads as a broken system rather than a missing
 * permission, and nothing about the sign-in itself says which it is.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtg-user-admin-'));
process.env.GTG_DATA_DIR = dir;

let users: typeof import('@/lib/db/repositories/users');
let companies: typeof import('@/lib/db/repositories/companies');
let marina: string;
let hamonia: string;

before(async () => {
  users = await import('@/lib/db/repositories/users');
  companies = await import('@/lib/db/repositories/companies');

  marina = companies.createCompany({ companyCode: 'MARINA', legalName: 'Marina Company' }).id;
  hamonia = companies.createCompany({ companyCode: 'HAMONIA', legalName: 'Hamonia Company' }).id;
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

const makeUser = (email: string) =>
  users.createUser({ email, name: 'Test User', password: 'a-long-enough-password', role: 'finance' })
    .id;

describe('editing a user', () => {
  it('changes the email, which is what they sign in with', () => {
    const id = makeUser('before@example.com');
    users.updateUser(id, { email: 'after@example.com' });

    assert.equal(users.findUserById(id)?.email, 'after@example.com');
    assert.ok(users.findUserByEmail('after@example.com'));
    assert.equal(users.findUserByEmail('before@example.com'), null);
  });

  it('lowercases a new email so a stray capital cannot lock the account out', () => {
    const id = makeUser('mixed@example.com');
    users.updateUser(id, { email: '  Somchai@Example.COM ' });

    assert.equal(users.findUserById(id)?.email, 'somchai@example.com');
    assert.ok(users.findUserByEmail('somchai@example.com'));
  });

  it('refuses an email another account already uses', () => {
    const taken = makeUser('taken@example.com');
    const other = makeUser('other@example.com');

    assert.throws(() => users.updateUser(other, { email: 'taken@example.com' }), /already used/);
    // And leaves the first account alone.
    assert.equal(users.findUserById(taken)?.email, 'taken@example.com');
  });

  it('keeps the rest of the record when only one field is given', () => {
    const id = makeUser('partial@example.com');
    users.updateUser(id, { name: 'Renamed' });

    const after = users.findUserById(id);
    assert.equal(after?.name, 'Renamed');
    assert.equal(after?.email, 'partial@example.com');
    assert.equal(after?.role, 'finance');
  });
});

describe('company access', () => {
  it('starts empty, so access is something granted rather than assumed', () => {
    const id = makeUser('fresh@example.com');
    assert.deepEqual(companies.companyIdsForUser(id), []);
  });

  it('grants and revokes without disturbing the other companies', () => {
    const id = makeUser('access@example.com');

    companies.grantCompany(id, marina);
    companies.grantCompany(id, hamonia);
    assert.equal(companies.companyIdsForUser(id).length, 2);

    companies.revokeCompany(id, hamonia);
    assert.deepEqual(companies.companyIdsForUser(id), [marina]);
  });

  it('is idempotent, so re-saving a form does not duplicate a grant', () => {
    const id = makeUser('repeat@example.com');

    companies.grantCompany(id, marina);
    companies.grantCompany(id, marina);

    assert.deepEqual(companies.companyIdsForUser(id), [marina]);
  });
});
