import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { CounterpartyResolver } from '@/lib/consolidate/counterparty';
import { consolidate, type CompanyFigures } from '@/lib/consolidate';

/**
 * Group consolidation.
 *
 * Two things have to hold. The group total may never include a company the
 * reader cannot open — that is the isolation guarantee this system is built
 * on, and a consolidation is the one place it would be easy to lose. And a
 * transaction between two group companies has to be removed once, because it
 * appears correctly in both sets of books and adding them produces a group
 * that has earned money from itself.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtg-consolidate-'));
process.env.GTG_DATA_DIR = dir;

let db: typeof import('@/lib/db');
let companies: typeof import('@/lib/db/repositories/companies');
let users: typeof import('@/lib/db/repositories/users');
let group: typeof import('@/lib/db/repositories/group');

before(async () => {
  db = await import('@/lib/db');
  companies = await import('@/lib/db/repositories/companies');
  users = await import('@/lib/db/repositories/users');
  group = await import('@/lib/db/repositories/group');
  db.getDb();
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const GROUP = [
  { id: 'c1', companyCode: 'GTG', legalName: 'บริษัท โกลบอล ท็อป กรุ๊ป จำกัด', displayName: 'Global Top Group', aliases: [] },
  { id: 'c2', companyCode: 'SUN9', legalName: 'บริษัท เดอะ ซัน ไลท์ เรสซิเด้นซ์ 9 จำกัด', displayName: 'Sun Light Residence 9', aliases: ['Hamonia'] },
  { id: 'c3', companyCode: 'MGBV', legalName: 'บริษัท มาริน่า โกลเด้น เบย์ วิคทอเรีย จำกัด', displayName: 'Marina Golden Bay Victoria', aliases: [] },
];

describe('recognising another group company', () => {
  const resolver = new CounterpartyResolver(GROUP);

  it('matches a legal name however it is wrapped', () => {
    assert.equal(resolver.resolve('บริษัท โกลบอล ท็อป กรุ๊ป จำกัด', 'c2'), 'c1');
    assert.equal(resolver.resolve('โกลบอล ท็อป กรุ๊ป', 'c2'), 'c1');
    assert.equal(resolver.resolve('Global Top Group Co., Ltd.', 'c2'), 'c1');
  });

  it('matches a name buried in a vendor field', () => {
    assert.equal(
      resolver.resolve('Global Top Group Co Ltd — management fee, August', 'c2'),
      'c1',
    );
  });

  it('matches a project alias, which is how the files usually name a company', () => {
    assert.equal(resolver.resolve('Hamonia', 'c1'), 'c2');
  });

  it('prefers the longer name when one contains the other', () => {
    // "Marina Golden Bay Victoria" must not resolve to a hypothetical
    // "Marina Golden Bay" — the group has several of those.
    const withParent = new CounterpartyResolver([
      ...GROUP,
      { id: 'c9', companyCode: 'MGB', legalName: 'Marina Golden Bay', displayName: 'Marina Golden Bay', aliases: [] },
    ]);
    assert.equal(withParent.resolve('Marina Golden Bay Victoria', 'c1'), 'c3');
  });

  /**
   * A row naming the company whose books it is in is a bookkeeping label, not
   * an intercompany transaction. Marking it would eliminate the company's own
   * trade against itself.
   */
  it('does not mark a company as its own counterparty', () => {
    assert.equal(resolver.resolve('Global Top Group', 'c1'), null);
  });

  it('ignores an outside vendor', () => {
    assert.equal(resolver.resolve('Somsak Construction Co Ltd', 'c1'), null);
    assert.equal(resolver.resolve('บริษัท ปูนซิเมนต์ไทย จำกัด', 'c1'), null);
  });

  it('ignores a name too short to identify anything', () => {
    assert.equal(resolver.resolve('AB', 'c1'), null);
    assert.equal(resolver.resolve('', 'c1'), null);
    assert.equal(resolver.resolve(null, 'c1'), null);
  });
});

describe('adding the companies up', () => {
  const figures = (id: string, values: Record<string, number>): CompanyFigures => ({
    companyId: id,
    companyCode: id.toUpperCase(),
    displayName: id,
    reportDate: '2026-08-31',
    values: new Map(Object.entries(values)),
  });

  it('sums the money and leaves the ratios alone', () => {
    const result = consolidate(
      [
        figures('a', {
          bank_current_amount: 10_000_000, available_cash: 8_000_000,
          total_receivable_outstanding: 5_000_000, total_owed: 4_000_000,
          recognised_revenue: 6_000_000, net_profit: 600_000,
          advance_outstanding: 0, wip_ytd: 0, quick_ratio: 3.25, net_profit_margin: 10,
        }),
        figures('b', {
          bank_current_amount: 4_000_000, available_cash: 2_000_000,
          total_receivable_outstanding: 3_000_000, total_owed: 4_000_000,
          recognised_revenue: 2_000_000, net_profit: 400_000,
          advance_outstanding: 0, wip_ytd: 0, quick_ratio: 1.25, net_profit_margin: 20,
        }),
      ],
      new Map(),
    );

    assert.equal(result.values.get('bank_current_amount'), 14_000_000);
    assert.equal(result.values.get('net_profit'), 1_000_000);

    // Adding two quick ratios produces a number with no meaning. It is rebuilt
    // from the summed components instead: (10,000,000 available cash +
    // 8,000,000 receivable) ÷ 8,000,000 owed.
    assert.notEqual(result.values.get('quick_ratio'), 4.5);
    assert.equal(result.values.get('quick_ratio'), 2.25);

    // And the margin from the group's own profit over the group's own revenue,
    // not the average of two margins.
    assert.notEqual(result.values.get('net_profit_margin'), 15);
    assert.equal(result.values.get('net_profit_margin'), 12.5);
  });

  it('removes an intercompany balance once, and shows what it removed', () => {
    const result = consolidate(
      [
        figures('a', { total_receivable_outstanding: 5_000_000 }),
        figures('b', { total_receivable_outstanding: 3_000_000 }),
      ],
      new Map([['total_receivable_outstanding', 2_000_000]]),
    );

    assert.equal(result.values.get('total_receivable_outstanding'), 6_000_000);

    const [elimination] = result.eliminations;
    assert.ok(elimination);
    assert.equal(elimination.gross, 8_000_000);
    assert.equal(elimination.amount, 2_000_000);
    assert.equal(elimination.net, 6_000_000);
  });

  it('rebuilds a ratio from the eliminated totals, not the gross ones', () => {
    const result = consolidate(
      [
        figures('a', {
          available_cash: 5_000_000, total_receivable_outstanding: 5_000_000,
          total_owed: 2_000_000, advance_outstanding: 0, wip_ytd: 0, quick_ratio: 5,
        }),
      ],
      new Map([['total_receivable_outstanding', 3_000_000]]),
    );

    // (5,000,000 + 2,000,000 after elimination) ÷ 2,000,000, not 10 ÷ 2.
    assert.equal(result.values.get('quick_ratio'), 3.5);
  });

  it('treats a company that reported nothing as nothing, not as zero everywhere', () => {
    const result = consolidate([figures('a', { bank_current_amount: 1_000_000 })], new Map());
    assert.equal(result.values.get('bank_current_amount'), 1_000_000);
    assert.equal(result.values.has('total_owed'), false);
  });
});

/**
 * The guarantee that matters most. A consolidation is the one place where
 * crossing a company boundary would look like a feature.
 */
describe('the group is only ever what the reader may open', () => {
  let alpha: string;
  let beta: string;
  let gamma: string;
  let partial: string;

  before(() => {
    alpha = companies.createCompany({ companyCode: 'CONA', legalName: 'Consolidate A' }).id;
    beta = companies.createCompany({ companyCode: 'CONB', legalName: 'Consolidate B' }).id;
    gamma = companies.createCompany({ companyCode: 'CONC', legalName: 'Consolidate C' }).id;

    const user = users.createUser({
      email: 'partial@example.com', name: 'Two of three', password: 'a-long-enough-password', role: 'admin',
    });
    partial = user.id;
    companies.grantCompany(partial, alpha);
    companies.grantCompany(partial, beta);
  });

  it('reads only the companies the user is granted', () => {
    const view = group.groupFigures(partial);
    const seen = new Set([
      ...view.companies.map((c) => c.companyId),
      ...view.withoutData.map((c) => c.companyId),
    ]);

    assert.ok(seen.has(alpha));
    assert.ok(seen.has(beta));
    assert.ok(!seen.has(gamma), 'a company the user has no grant for reached the group total');
  });

  it('names the companies that contributed nothing rather than dropping them', () => {
    const view = group.groupFigures(partial);
    // Neither has an import in this test database.
    assert.equal(view.companies.length, 0);
    assert.equal(view.withoutData.length, 2);
  });

  it('gives a user with no grants an empty group rather than everything', () => {
    const nobody = users.createUser({
      email: 'nogrants@example.com', name: 'No grants', password: 'a-long-enough-password', role: 'admin',
    });

    const view = group.groupFigures(nobody.id);
    assert.equal(view.companies.length, 0);
    assert.equal(view.withoutData.length, 0);
    assert.equal(view.values.size, 0);
  });
});
