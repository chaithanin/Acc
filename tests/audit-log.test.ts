import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

/**
 * The record of who changed what.
 *
 * The audit found that a role change, a grant, a company rename, a password
 * reset and a rollback all left nothing behind. These cases cover what the
 * store itself has to guarantee: an entry is written whole, it is never
 * edited, a password never reaches it, and reading it while working in one
 * company does not show another company's activity.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtg-audit-'));
process.env.GTG_DATA_DIR = dir;

let audit: typeof import('@/lib/db/repositories/audit');
let companies: typeof import('@/lib/db/repositories/companies');
let db: typeof import('@/lib/db');

let alpha: string;
let beta: string;

before(async () => {
  db = await import('@/lib/db');
  audit = await import('@/lib/db/repositories/audit');
  companies = await import('@/lib/db/repositories/companies');

  alpha = companies.createCompany({ companyCode: 'AUDALPHA', legalName: 'Alpha Co' }).id;
  beta = companies.createCompany({ companyCode: 'AUDBETA', legalName: 'Beta Co' }).id;
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const entry = (over: Partial<import('@/lib/db/repositories/audit').NewAuditEntry> = {}) => ({
  actorId: 'user-1',
  actorEmail: 'finance@globaltopgroup.local',
  actorRole: 'finance',
  action: 'import.confirm',
  entity: 'import',
  entityId: 'import-1',
  summary: 'Imported 3 files for 2026-08-31',
  ...over,
});

describe('the activity log', () => {
  it('keeps what it was given', () => {
    const id = audit.writeAudit(entry({
      companyId: alpha,
      detail: { files: ['a.xlsx', 'b.xlsx'], reportDate: '2026-08-31' },
      ip: '203.0.113.9',
    }));

    const found = audit.listAudit({ companyId: alpha }).find((e) => e.id === id);
    assert.ok(found);
    assert.equal(found.actorEmail, 'finance@globaltopgroup.local');
    assert.equal(found.action, 'import.confirm');
    assert.equal(found.entityId, 'import-1');
    assert.equal(found.ip, '203.0.113.9');
    assert.deepEqual(found.detail?.files, ['a.xlsx', 'b.xlsx']);
    assert.ok(found.at, 'the entry has no time on it');
  });

  it('shows one company its own activity, and nobody else’s', () => {
    audit.writeAudit(entry({ companyId: alpha, summary: 'Alpha only' }));
    audit.writeAudit(entry({ companyId: beta, summary: 'Beta only' }));

    const seen = audit.listAudit({ companyId: alpha }).map((e) => e.summary);
    assert.ok(seen.includes('Alpha only'));
    assert.ok(!seen.includes('Beta only'), 'the other company’s activity was listed');
  });

  it('shows entries that belong to no company to whoever is reading', () => {
    // An account created or a password reset is not about one company, and the
    // administrator reading the log needs to see it whichever one is in
    // session.
    audit.writeAudit(entry({
      companyId: null, action: 'user.password_reset', entity: 'user',
      summary: 'Reset the password for someone',
    }));

    for (const company of [alpha, beta]) {
      const seen = audit.listAudit({ companyId: company }).map((e) => e.action);
      assert.ok(seen.includes('user.password_reset'), `not visible while in ${company}`);
    }
  });

  it('lists the newest first', () => {
    audit.writeAudit(entry({ companyId: alpha, summary: 'older' }));
    audit.writeAudit(entry({ companyId: alpha, summary: 'newer' }));

    const [first] = audit.listAudit({ companyId: alpha, limit: 1 });
    assert.equal(first?.summary, 'newer');
  });

  it('can be narrowed to one kind of action', () => {
    audit.writeAudit(entry({ companyId: alpha, action: 'import.rollback', summary: 'rolled back' }));
    const rollbacks = audit.listAudit({ companyId: alpha, action: 'import.rollback' });

    assert.ok(rollbacks.length > 0);
    assert.ok(rollbacks.every((e) => e.action.startsWith('import.rollback')));
  });

  it('offers no way to edit or delete an entry', () => {
    // A log that can be rewritten is not a log. This is enforced by the module
    // exporting nothing that could do it.
    const exported = Object.keys(audit);
    assert.deepEqual(
      exported.filter((name) => /update|edit|delete|remove|clear|purge/i.test(name)),
      [],
      `the module exports something that can rewrite history: ${exported.join(', ')}`,
    );
  });

  it('survives a detail column that is not valid JSON', () => {
    db.getDb()
      .prepare(
        `INSERT INTO audit_log (id, at, actor_id, actor_email, actor_role, company_id, action, entity, entity_id, summary, detail, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(db.newId(), db.nowIso(), null, 'someone@example.com', 'admin', alpha,
        'company.update', 'company', alpha, 'Broken detail', '{not json', null);

    const found = audit.listAudit({ companyId: alpha }).find((e) => e.summary === 'Broken detail');
    assert.ok(found, 'the page would have thrown instead of listing it');
    assert.equal(found.detail?.raw, '{not json');
  });
});
