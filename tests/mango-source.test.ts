import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkBundleSchema, credentialsFromEnv, MangoError } from '@/lib/sources/mango/client';
import { mangoDate, mapMangoBundle } from '@/lib/sources/mango/map';
import { mangoFixture } from './fixtures/mango-bundle';
import { calculateMetrics } from '@/lib/calc/kpi';

/**
 * Reading Mango RE.
 *
 * These endpoints are somebody else's internal ones with no published
 * contract, and the data behind them is live customer money. Every figure this
 * pull produces is worked out by hand in the fixture, so a mapping that drifts
 * says which arithmetic changed rather than only that a number moved.
 */

const REPORT_DATE = '2026-08-31';
const run = () => mapMangoBundle(mangoFixture(), { reportDate: REPORT_DATE });

describe('dates, as Mango actually sends them', () => {
  it('reads an ISO date', () => {
    assert.equal(mangoDate('2026-06-30'), '2026-06-30');
    assert.equal(mangoDate('2026-06-30T00:00:00'), '2026-06-30');
  });

  it('reads the day-first form the Thai screens use', () => {
    assert.equal(mangoDate('01/02/2026'), '2026-02-01');
    assert.equal(mangoDate('15/03/2026'), '2026-03-15');
  });

  /**
   * A Buddhist year left alone would put every due date 543 years out, and
   * every receivable would read as not yet due — an ageing report of nothing
   * overdue, on a ledger that is months behind.
   */
  it('converts a Buddhist year rather than accepting it', () => {
    assert.equal(mangoDate('30/06/2569'), '2026-06-30');
    assert.equal(mangoDate('2569-06-30'), '2026-06-30');
  });

  it('returns nothing for what it cannot read, rather than guessing', () => {
    assert.equal(mangoDate(''), null);
    assert.equal(mangoDate(null), null);
    assert.equal(mangoDate('ไม่ระบุ'), null);
    assert.equal(mangoDate('30/06/1400'), null);
  });
});

describe('contracts', () => {
  const result = run();

  /**
   * The decision that matters most. Mango keeps cancelled bookings in the same
   * list with cancel_status set; summing the list without checking reports
   * money nobody owes.
   */
  it('drops cancelled bookings, however the flag is spelled', () => {
    assert.equal(result.counts.cancelled, 2);

    const customers = result.data.receivable.map((r) => r.customer);
    assert.ok(!customers.includes('Cancelled Buyer'));
    assert.ok(!customers.includes('Also Cancelled'));
  });

  it('drops a row with no money on it, which is a placeholder', () => {
    assert.ok(!result.data.receivable.some((r) => r.unit === 'V-203'));
  });

  it('keeps the six that are real', () => {
    assert.equal(result.counts.contracts, 5);
    assert.equal(result.data.receivable.length, 5);
  });

  it('reads money whether it arrives as a number or a comma string', () => {
    const contracted = result.data.receivable.reduce((sum, r) => sum + r.contractualAmount, 0);
    // 3,000,000 + 2,500,000 + 1,800,000 + 5,000,000 + 1,000,000
    assert.equal(contracted, 13_300_000);
  });

  /**
   * What has been collected is the receipts. `transaction` carries no received
   * column at all, so reading one would have produced zero on every contract.
   */
  it('collects from the receipts, not from a column', () => {
    const byUnit = new Map(result.data.receivable.map((r) => [r.unit, r]));

    // 50,000 + 450,000 + 2,500,000
    assert.equal(byUnit.get('A-101')?.receiveAmount, 3_000_000);
    // 50,000 + 450,000 + 100,000 + 25,000 (the undated receipt still counts as
    // money received — it just cannot be placed in a month)
    assert.equal(byUnit.get('A-102')?.receiveAmount, 625_000);
    assert.equal(byUnit.get('A-103')?.receiveAmount, 50_000);
  });

  it('derives what is still owed rather than reading it', () => {
    const byUnit = new Map(result.data.receivable.map((r) => [r.unit, r]));

    assert.equal(byUnit.get('A-101')?.accrueAmount, 0);
    assert.equal(byUnit.get('A-102')?.accrueAmount, 1_875_000);
    assert.equal(byUnit.get('A-103')?.accrueAmount, 1_750_000);
  });

  it('files each contract under the furthest stage it has reached', () => {
    const byUnit = new Map(result.data.receivable.map((r) => [r.unit, r]));

    assert.equal(byUnit.get('A-101')?.category, 'transfer_fee');
    assert.equal(byUnit.get('A-102')?.category, 'down_payment');
    assert.equal(byUnit.get('A-103')?.category, 'reservation');
  });

  it('carries a due date, so the balance can be aged', () => {
    const byUnit = new Map(result.data.receivable.map((r) => [r.unit, r]));

    assert.equal(byUnit.get('A-101')?.dueDate, '2026-06-30');
    assert.equal(byUnit.get('A-102')?.dueDate, '2026-07-31');
    assert.ok(result.data.receivable.every((r) => r.dueDate !== undefined));
  });

  it('says so when receipts exceed the contract they are against', () => {
    const overpaid = result.issues.find((i) => i.code === 'MANGO_OVERPAID');
    assert.ok(overpaid, 'a contract was overpaid and nothing said so');
    assert.match(overpaid.message, /V-202/);
  });

  /**
   * A receipt whose contract is not in the pull is usually a refunded
   * cancellation or a project this account cannot see. Counting it as a
   * collection would overstate cash; dropping it silently would hide a
   * permissions gap.
   */
  it('reports receipts whose contract is missing, and does not count them', () => {
    // The cancelled booking's refunded receipt, and one whose contract is not
    // in this pull at all.
    assert.equal(result.counts.orphanReceipts, 2);

    const orphan = result.issues.find((i) => i.code === 'MANGO_ORPHAN_RECEIPT');
    assert.ok(orphan);
    assert.match(orphan.message, /not counted as collections/);
  });
});

describe('collections', () => {
  const result = run();

  /**
   * Mango RE is one ledger: transactions are the receivables and details are
   * the payments against them. This system has two, and writing the receipts
   * into the second one would count the same money twice — revenue would read
   * as the contracts plus the payments for those contracts. So the monthly
   * figure is returned for reporting rather than filed as income.
   */
  it('does not turn the receipts into a second ledger', () => {
    assert.deepEqual(result.data.income, [],
      'the receipts were written as income and are now counted twice');
  });

  it('totals what was banked in each month', () => {
    // 50,000 (BK-0003) + 100,000 (BK-0002) + 1,000,000 (BK-0005)
    // + 500,000 (BK-0006) + 75,000 (the orphan) = 1,725,000
    assert.equal(result.collectedByMonth.get('2026-08'), 1_725_000);
    // 50,000 + 450,000 in November and December 2025.
    assert.equal(result.collectedByMonth.get('2025-11'), 50_000);
    assert.equal(result.collectedByMonth.get('2025-12'), 450_000);
  });

  it('says how much it could not place in a month, rather than dropping it quietly', () => {
    const undated = result.issues.find((i) => i.code === 'MANGO_UNDATED_RECEIPT');
    assert.ok(undated, 'a receipt had no date and nothing said so');
    assert.match(undated.message, /short by their value/);
  });

  it('still counts an undated receipt towards what the customer has paid', () => {
    const byUnit = new Map(result.data.receivable.map((r) => [r.unit, r]));
    // RC-2004 is undated and worth 25,000; A-102 has paid 625,000 in total.
    assert.equal(byUnit.get('A-102')?.receiveAmount, 625_000);
  });
});

describe('what a project expects to sell for', () => {
  const result = run();

  /**
   * This is the figure revenue recognition needs and that somebody has been
   * typing in by hand. Mango has it: the active price list.
   */
  it('sums the active price list per project', () => {
    // 3,000,000 revised + 2,600,000 + 1,800,000. A-104 is withdrawn from sale.
    assert.equal(result.saleValueByProject.get('HAMONIA'), 7_400_000);
    assert.equal(result.saleValueByProject.get('MARINA_VTR'), 6_000_000);
  });

  it('prefers a revised price over the original', () => {
    // A-101 asks 3,200,000 and was revised to 3,000,000.
    const hamonia = result.saleValueByProject.get('HAMONIA') ?? 0;
    assert.ok(hamonia < 3_200_000 + 2_600_000 + 1_800_000);
  });

  it('leaves out units withdrawn from sale', () => {
    assert.equal(result.counts.units, 5);
  });
});

describe('monthly targets', () => {
  const result = run();

  it('reads the sales target and the marketing budget', () => {
    const august = result.targets.find((t) => t.projectCode === 'HAMONIA' && t.month === '2026-08');
    assert.ok(august);
    assert.equal(august.income, 12_000_000);
    assert.equal(august.expense, 800_000);
  });

  it('converts a Buddhist year on the target too', () => {
    assert.ok(result.targets.some((t) => t.month === '2026-09'));
    assert.ok(!result.targets.some((t) => t.month.startsWith('2569')));
  });

  it('drops a target with no month rather than filing it under one', () => {
    assert.equal(result.targets.length, 3);
  });
});

describe('the figures the dashboard would show', () => {
  /**
   * The point of the whole exercise: what Mango returns has to reconcile once
   * it reaches the engine, not only once it reaches the database.
   */
  it('reconciles receivables end to end', () => {
    const { data } = run();
    const calc = calculateMetrics(data, REPORT_DATE);

    // 0 + 1,875,000 + 1,750,000 + 4,000,000 − 200,000 (V-202 is overpaid).
    assert.equal(calc.byKey.get('total_receivable_outstanding')?.value, 7_425_000);
    // 3,000,000 + 625,000 + 50,000 + 1,000,000 + 1,200,000
    assert.equal(calc.byKey.get('received_income')?.value, 5_875_000);
    assert.equal(calc.byKey.get('total_contractual_income')?.value, 13_300_000);

    // Contracted less collected, across every live contract.
    const contracted = calc.byKey.get('total_contractual_income')?.value ?? 0;
    const received = calc.byKey.get('received_income')?.value ?? 0;
    assert.equal(calc.byKey.get('accrued_income')?.value, Math.round((contracted - received) * 100) / 100);
  });

  it('ages the balance, because every contract carries a due date', () => {
    const { data } = run();
    const calc = calculateMetrics(data, REPORT_DATE);

    // A-102 is due 2026-07-31, so on 2026-08-31 it is 31 days late.
    assert.equal(calc.byKey.get('receivable_aged_31_60')?.value, 1_875_000);
    assert.equal(calc.byKey.get('receivable_undated')?.value, 0);
  });
});

describe('noticing when Mango changes underneath', () => {
  it('passes a bundle shaped the way the survey found it', () => {
    assert.deepEqual(checkBundleSchema(mangoFixture()), []);
  });

  it('reports a list that has gone missing', () => {
    const bundle = mangoFixture();
    delete bundle.pricelist;

    const findings = checkBundleSchema(bundle);
    assert.ok(findings.some((f) => f.table === 'pricelist' && f.level === 'missing_table'));
  });

  /**
   * A renamed column would otherwise arrive as undefined, coerce to zero, and
   * become a silently wrong figure rather than a loud failure.
   */
  it('reports a column that has been renamed', () => {
    const bundle = mangoFixture();
    bundle.transaction = bundle.transaction!.map(({ netamount, ...rest }) => {
      void netamount;
      return rest;
    });

    const findings = checkBundleSchema(bundle);
    assert.ok(findings.some((f) => f.level === 'missing_column' && /netamount/.test(f.detail)));
  });

  it('tells an empty list apart from a missing one', () => {
    const bundle = mangoFixture();
    bundle.sale_target = [];

    const findings = checkBundleSchema(bundle);
    const target = findings.find((f) => f.table === 'sale_target');
    assert.equal(target?.level, 'empty_table');
    assert.match(target.detail, /no rights/);
  });
});

describe('credentials', () => {
  it('names exactly what is missing', () => {
    assert.throws(
      () => credentialsFromEnv({ MANGO_BASE_URL: 'https://example.com' } as unknown as NodeJS.ProcessEnv),
      (err: unknown) => err instanceof MangoError && /MANGO_USER, MANGO_PASS/.test((err as Error).message),
    );
  });

  it('trims the base URL so a trailing slash cannot double up a path', () => {
    const creds = credentialsFromEnv({
      MANGO_BASE_URL: 'https://chaithanin.mangoanywhere.com/production.re/',
      MANGO_USER: 'svc', MANGO_PASS: 'x',
    } as unknown as NodeJS.ProcessEnv);

    assert.equal(creds.baseUrl, 'https://chaithanin.mangoanywhere.com/production.re');
  });
});

/**
 * The check that the mapping did not quietly reintroduce the defect the
 * reconciliation rules were written to catch.
 */
describe('a Mango pull passes the system’s own reconciliation rules', () => {
  it('raises nothing', async () => {
    const { runValidations } = await import('@/lib/validate/rules');
    const { data } = run();
    const calc = calculateMetrics(data, REPORT_DATE);

    const failures = runValidations(data, calc, null)
      .filter((r) => r.status === 'error' || r.status === 'warning')
      .map((r) => `${r.ruleKey}: ${r.message}`);

    assert.deepEqual(failures, []);
  });

  it('in particular, the sales ledger does not restate the receivable ledger', async () => {
    const { runValidations } = await import('@/lib/validate/rules');
    const { data } = run();

    const overlap = runValidations(data, calculateMetrics(data, REPORT_DATE), null)
      .find((r) => r.ruleKey === 'income_components');

    // Skipped, because only one of the two ledgers is populated — which is the
    // correct outcome for a source that has only one.
    assert.equal(overlap?.status, 'skipped');
  });
});
