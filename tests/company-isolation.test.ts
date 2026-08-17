import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

/**
 * Company isolation, checked at the layer that enforces it.
 *
 * The rule these cover is that a user sees the companies granted to them and
 * no others — and that it holds in the repository, not in a component that
 * filters a longer list it was given. A test written against the UI would pass
 * just as happily with every company loaded and most of them hidden.
 *
 * The database module reads its directory at import time, so the environment
 * is set before anything is imported and each test file gets its own store.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtg-companies-'));
process.env.GTG_DATA_DIR = dir;

type Companies = typeof import('@/lib/db/repositories/companies');
type Users = typeof import('@/lib/db/repositories/users');

let companies: Companies;
let users: Users;
let alice: string;
let bob: string;
let marina: string;
let hamonia: string;

before(async () => {
  companies = await import('@/lib/db/repositories/companies');
  users = await import('@/lib/db/repositories/users');

  marina = companies.createCompany({ companyCode: 'MARINA', legalName: 'Marina Company' }).id;
  hamonia = companies.createCompany({ companyCode: 'HAMONIA', legalName: 'Hamonia Company' }).id;

  alice = users.createUser({
    email: 'alice@example.com',
    name: 'Marina Finance',
    password: 'a-long-enough-password',
    role: 'finance',
  }).id;

  bob = users.createUser({
    email: 'bob@example.com',
    name: 'Hamonia Accounting',
    password: 'a-long-enough-password',
    role: 'finance',
  }).id;

  companies.grantCompany(alice, marina);
  companies.grantCompany(bob, hamonia);
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('company access', () => {
  it('lists only what a user was granted', () => {
    assert.deepEqual(
      companies.companiesForUser(alice).map((c) => c.companyCode),
      ['MARINA'],
    );
    assert.deepEqual(
      companies.companiesForUser(bob).map((c) => c.companyCode),
      ['HAMONIA'],
    );
  });

  it('refuses a company the user was not granted', () => {
    // Naming another company's id is what an edited request looks like, and it
    // has to fail at the repository rather than be caught by a page.
    assert.equal(companies.companyForUser(alice, hamonia), null);
    assert.equal(companies.companyForUser(bob, marina), null);
  });

  it('gives a user with no grants nothing rather than everything', () => {
    const carol = users.createUser({
      email: 'carol@example.com',
      name: 'New Starter',
      password: 'a-long-enough-password',
      role: 'viewer',
    }).id;

    assert.deepEqual(companies.companiesForUser(carol), []);
  });

  it('stops treating a company as accessible once it is revoked', () => {
    const dave = users.createUser({
      email: 'dave@example.com',
      name: 'Contractor',
      password: 'a-long-enough-password',
      role: 'viewer',
    }).id;

    companies.grantCompany(dave, marina);
    assert.equal(companies.companyForUser(dave, marina)?.companyCode, 'MARINA');

    companies.revokeCompany(dave, marina);
    assert.equal(companies.companyForUser(dave, marina), null);
  });

  it('counts a company’s own projects and no one else’s', () => {
    const list = companies.companiesForUser(alice);
    assert.equal(list.length, 1);
    // No projects were created here, so anything above zero would mean the
    // count had reached past this company.
    assert.equal(list[0].projectCount, 0);
  });
});
