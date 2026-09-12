import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkBundleSchema, companiesFrom, credentialsFromEnv, MangoError, unwrapRows } from '@/lib/sources/mango/client';
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
    assert.match(undated.message, /the monthly collection figure is short/);
  });

  /**
   * The fixture has exactly one undated receipt, and a warning that reads
   * "1 receipts carry" is the kind of thing that makes a reader wonder what
   * else was written without being looked at.
   */
  it('reads as a sentence when it is talking about one receipt', () => {
    const undated = result.issues.find((i) => i.code === 'MANGO_UNDATED_RECEIPT');
    assert.match(undated!.message, /^1 receipt carries no usable date\. It still counts/);

    const orphan = result.issues.find((i) => i.code === 'MANGO_ORPHAN_RECEIPT');
    assert.match(orphan!.message, /^2 receipts belong to no contract/);
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
    // 3,200,000 + 2,600,000 + 1,800,000. A-104 is withdrawn from sale.
    assert.equal(result.saleValueByProject.get('HAMONIA'), 7_600_000);
    assert.equal(result.saleValueByProject.get('MARINA_VTR'), 6_000_000);
  });

  /**
   * `revise` sits beside `asking_price` and sounds like a revised price. It is
   * the revision number. Preferring it priced 1,839 real units at 24,035 baht
   * in total — thirteen baht each — and published that as what a project
   * expects to sell for.
   */
  it('ignores the revision number, which is not a price', () => {
    const hamonia = result.saleValueByProject.get('HAMONIA') ?? 0;
    assert.equal(hamonia, 7_600_000, 'the revision number was read as money');
    assert.ok(hamonia > 1_000, 'the sale value collapsed to the size of a revision counter');
  });

  it('refuses to publish a sale value that is obviously not money', () => {
    const bundle = mangoFixture();
    // What the old reading produced: revision numbers where prices belong.
    for (const row of bundle.pricelist ?? []) row.asking_price = 2;

    const mapped = mapMangoBundle(bundle, { reportDate: '2026-09-11' });
    const issue = mapped.issues.find((i) => i.code === 'MANGO_IMPLAUSIBLE_PRICE');
    assert.ok(issue, 'a project priced at two baht a unit was reported as a figure');
    assert.equal(issue!.severity, 'error');
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

/**
 * What goes wrong in practice, and whether the message sends the right person
 * to the right place.
 */
describe('failing usefully', () => {
  it('spots a pasted placeholder instead of failing later as a bad password', () => {
    assert.throws(
      () => credentialsFromEnv({
        MANGO_BASE_URL: 'https://chaithanin.mangoanywhere.com/production.re',
        MANGO_USER: '<service account>',
        MANGO_PASS: '<password>',
      } as unknown as NodeJS.ProcessEnv),
      (err: unknown) =>
        err instanceof MangoError
        && /placeholder/.test((err as Error).message)
        && /MANGO_USER, MANGO_PASS/.test((err as Error).message),
    );
  });

  /**
   * Found by watching somebody run it. The instructions wrote MANGO_USER=…
   * and the ellipsis was exported verbatim, which the check let through — so
   * the run went on to fail as a rejected sign-in, which is the exact wrong
   * turn this check exists to prevent. Documentation writes ellipses, so the
   * check has to know about them.
   */
  it('spots the ellipsis that documentation puts in the example', () => {
    for (const value of ['…', '...', '-', '***']) {
      assert.throws(
        () => credentialsFromEnv({
          MANGO_BASE_URL: 'https://chaithanin.mangoanywhere.com/production.re',
          MANGO_USER: value, MANGO_PASS: value,
        } as unknown as NodeJS.ProcessEnv),
        (err: unknown) => err instanceof MangoError && /placeholder/.test((err as Error).message),
        `${JSON.stringify(value)} was accepted as a credential`,
      );
    }
  });

  it('accepts credentials that merely look unusual', () => {
    const creds = credentialsFromEnv({
      MANGO_BASE_URL: 'https://chaithanin.mangoanywhere.com/production.re',
      MANGO_USER: 'svc.dashboard', MANGO_PASS: 'xY<z>9!',
    } as unknown as NodeJS.ProcessEnv);

    assert.equal(creds.username, 'svc.dashboard');
  });
});

/**
 * What the Booking team found when they connected to the same Mango, written
 * down here as tests so this connector cannot drift back.
 */
describe('rows Mango has retired', () => {
  const result = run();

  it('does not count a superseded booking as a second contract', () => {
    const v201 = result.data.receivable.filter((r) => r.unit === 'V-201');
    assert.equal(v201.length, 1, 'the replaced booking was counted alongside the live one');
    assert.equal(v201[0].contractualAmount, 5_000_000, 'the retired row won over the live one');
  });

  it('says how many it set aside rather than dropping them silently', () => {
    assert.equal(result.counts.superseded, 1);
  });

  /**
   * Deliberately not "keep only the rows marked active". A build that stops
   * sending the column would then retire every row at once, and a whole
   * company would read as zero with no error anywhere — the failure mode this
   * connector exists to avoid.
   */
  it('keeps a row that carries no active flag at all', () => {
    const bundle = mangoFixture();
    for (const row of bundle.transaction ?? []) delete (row as Record<string, unknown>).active;

    const mapped = mapMangoBundle(bundle, { reportDate: '2026-09-11' });
    assert.ok(mapped.counts.contracts > 0, 'dropping the column emptied the pull');
    assert.equal(mapped.counts.superseded, 0);
  });

  it('applies the same rule to the price list', () => {
    const bundle = mangoFixture();
    for (const row of bundle.pricelist ?? []) delete (row as Record<string, unknown>).active;

    const mapped = mapMangoBundle(bundle, { reportDate: '2026-09-11' });
    assert.ok((mapped.saleValueByProject.get('HAMONIA') ?? 0) > 0,
      'a price list with no active column priced the project at nothing');
  });
});

/**
 * The company picker.
 *
 * Mango is multi-company and the login carries the company alongside the
 * username. The list is printed into the login page, so a wrong one can be
 * named rather than arriving as a sign-in failure that reads like a bad
 * password.
 */
describe('reading the company list off the login page', () => {
  it('reads the list the Vue page ships', () => {
    const html = 'new Vue({ data: { compData: JSON.parse(`'
      + JSON.stringify([
        { maincode: 'MG1', compname: 'บริษัท ไชยธนินทร์ จำกัด' },
        { maincode: 'MG2', compname: 'Second' },
      ])
      + '`) } })';

    const companies = companiesFrom(html);
    assert.deepEqual(companies.map((c) => c.code), ['MG1', 'MG2']);
    assert.equal(companies[0].name, 'บริษัท ไชยธนินทร์ จำกัด');
  });

  it('gives up quietly on a page it cannot read, rather than refusing the login', () => {
    assert.deepEqual(companiesFrom('<html><body>nothing here</body></html>'), []);
    assert.deepEqual(companiesFrom('compData: JSON.parse(`not json`)'), []);
  });
});

describe('the company the pull signs in to', () => {
  it('defaults to MG1, which is Chaithanin', () => {
    const creds = credentialsFromEnv({
      MANGO_BASE_URL: 'https://chaithanin.mangoanywhere.com/production.re',
      MANGO_USER: 'svc.dashboard', MANGO_PASS: 'secret',
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(creds.maincode, 'MG1');
  });

  it('takes another company from the environment, in upper case', () => {
    const creds = credentialsFromEnv({
      MANGO_BASE_URL: 'https://chaithanin.mangoanywhere.com/production.re',
      MANGO_USER: 'svc.dashboard', MANGO_PASS: 'secret', MANGO_MAINCODE: 'mg3',
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(creds.maincode, 'MG3');
  });
});

/**
 * Surveying a module nobody has mapped yet is the opposite job from reading
 * one that is mapped: an HTML answer is a finding, not an exception.
 */
describe('reading raw, for a module with no contract yet', () => {
  const serve = async (body: string, contentType: string) => {
    const http = await import('node:http');
    const server = http.createServer((req, res) => {
      if (req.url?.includes('Login')) {
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end('<script>new Vue({data:{formData:{userid:"",userpass:"",maincode:""}},'
          + 'methods:{go(){$_post(f,"authentication/login_do")}}})</script>');
      }
      if (req.url?.includes('login_do')) {
        res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'mg=1; Path=/' });
        return res.end(JSON.stringify({ success: true }));
      }
      if (req.url?.includes('AuthStatus')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ success: true, data: { user: 'svc' } }));
      }
      res.writeHead(200, { 'content-type': contentType });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    return { base: `http://127.0.0.1:${port}`, close: () => server.close() };
  };

  it('hands back an HTML answer instead of throwing on it', async () => {
    const { base, close } = await serve('<html>signed out</html>', 'text/html');
    try {
      const { MangoClient } = await import('@/lib/sources/mango/client');
      const client = await new MangoClient({
        baseUrl: base, username: 'u', password: 'p', maincode: 'MG1',
      }).login();

      const answer = await client.raw('unknown_data/whatever');
      assert.equal(answer.status, 200);
      assert.match(answer.contentType, /text\/html/);
      assert.match(answer.text, /signed out/);

      // The mapped-endpoint reader still refuses it, which is the point of
      // having both.
      await assert.rejects(() => client.get('unknown_data/whatever'));
    } finally {
      close();
    }
  });
});

/**
 * Shapes the live service actually answered with, kept here so the guesses
 * that were wrong cannot come back.
 */
describe('answers that are not the shape the caller assumed', () => {
  it('takes the rows out of a grid wrapper', () => {
    const rows = unwrapRows<{ pre_event2: string }>(
      { data: [{ pre_event2: 'HAMONIA' }, { pre_event2: 'MARINA_VTR' }], total: 2 },
      'projectmodal3',
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].pre_event2, 'HAMONIA');
  });

  it('takes a plain list as it is', () => {
    assert.equal(unwrapRows([{ a: 1 }], 'x').length, 1);
  });

  /**
   * The bundle is an object holding several named lists. Unwrapping it as a
   * paging wrapper would keep one list and throw the rest away, which is worse
   * than failing — it would report a pull that worked and was mostly empty.
   */
  it('refuses to unwrap an object that holds several lists', () => {
    assert.throws(
      () => unwrapRows({ transaction: [], pricelist: [], sale_target: [] }, 'All_Transaction_Data'),
      (err: unknown) => err instanceof MangoError
        && /holds: transaction, pricelist, sale_target/.test((err as Error).message),
    );
  });

  it('says what it got when the answer is nothing at all', () => {
    assert.throws(
      () => unwrapRows(null, 'projectmodal3'),
      (err: unknown) => err instanceof MangoError && /answered null/.test((err as Error).message),
    );
  });
});

/**
 * A 404 on the login page and a blocked request are opposite problems, and
 * telling somebody the wrong one costs an evening: one means the address is
 * wrong, the other means nothing reached Mango at all.
 */
describe('when the login page is not there', () => {
  const serveStatus = async (status: number) => {
    const http = await import('node:http');
    const server = http.createServer((_req, res) => {
      res.writeHead(status, { 'content-type': 'text/html' });
      res.end('nope');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    return { base: `http://127.0.0.1:${port}`, close: () => server.close() };
  };

  const signIn = async (status: number) => {
    const { base, close } = await serveStatus(status);
    try {
      const { MangoClient } = await import('@/lib/sources/mango/client');
      await new MangoClient({ baseUrl: base, username: 'u', password: 'p', maincode: 'MG1' }).login();
      assert.fail('signing in against a broken page succeeded');
    } catch (err) {
      return (err as Error).message;
    } finally {
      close();
    }
  };

  it('calls a 404 a wrong address, not a blocked request', async () => {
    const message = await signIn(404);
    assert.match(message, /does not exist/);
    assert.match(message, /wrong rather than blocked/);
  });

  it('still calls a refusal a refusal', async () => {
    const message = await signIn(403);
    assert.match(message, /network or proxy refusal/);
  });
});


/**
 * Orphan receipts have several causes and only one of them is alarming.
 *
 * A refund against a cancelled booking is meant to sit outside the receivable
 * list. A receipt against a contract that is simply absent means somebody paid
 * against a contract this account cannot see — the pull is short, and so is
 * every figure taken from it. A real pull reported 318 of these as one number,
 * which could have been either.
 */
describe('telling a refund from a pull that is short', () => {
  const result = run();

  it('counts a receipt against a contract that is not in the pull at all', () => {
    assert.equal(result.counts.receiptsWithoutContract, 1);
    // And does not fold the refunded one in with it.
    assert.equal(result.counts.orphanReceipts, 2);
  });

  it('raises it as an error of its own, not as a line in the orphan tally', () => {
    const issue = result.issues.find((i) => i.code === 'MANGO_INCOMPLETE_PULL');
    assert.ok(issue, 'a contract this account cannot see went unreported');
    assert.equal(issue!.severity, 'error');
    assert.match(issue!.message, /short by whatever those contracts hold/);
  });

  it('separates the causes in the orphan warning rather than adding them up', () => {
    const orphan = result.issues.find((i) => i.code === 'MANGO_ORPHAN_RECEIPT');
    assert.match(orphan!.message, /against cancelled bookings/);
    assert.match(orphan!.message, /absent from this pull entirely/);
  });

  it('says nothing about a short pull when every orphan is accounted for', () => {
    const bundle = mangoFixture();
    bundle.transaction_detail = (bundle.transaction_detail ?? []).filter((r) => r.docno !== 'BK-9999');

    const mapped = mapMangoBundle(bundle, { reportDate: '2026-09-11' });
    assert.equal(mapped.counts.receiptsWithoutContract, 0);
    assert.equal(mapped.issues.find((i) => i.code === 'MANGO_INCOMPLETE_PULL'), undefined);
    // The refund on the cancelled booking is still reported, as it should be.
    assert.ok(mapped.issues.find((i) => i.code === 'MANGO_ORPHAN_RECEIPT'));
  });
});

/**
 * A total that cannot be true.
 *
 * The first real pull reported 2.71bn collected against 2.59bn contracted, and
 * an outstanding balance of minus 118 million — presented as a debt. Per
 * contract, receipts exceeding the contract value is a warning worth a look.
 * Across a whole pull it is not: it means the two sides are measuring
 * different things, and no figure derived from them is usable.
 */
describe('collecting more than was ever owed', () => {
  it('raises it as an error, not as a negative balance', () => {
    const bundle = mangoFixture();
    // A payment far beyond any contract in the pull, as fees and tax filed
    // against a contract would produce at scale.
    (bundle.transaction_detail ?? []).push({
      docno: 'BK-0001', rcptno: 'RC-1999', rcptdate: '2026-08-30',
      amount: 500_000_000, doctype: 'ค่าธรรมเนียมการโอน',
    });

    const mapped = mapMangoBundle(bundle, { reportDate: '2026-09-11' });
    const issue = mapped.issues.find((i) => i.code === 'MANGO_COLLECTED_EXCEEDS_CONTRACTED');
    assert.ok(issue, 'more was collected than contracted and nothing said so');
    assert.equal(issue!.severity, 'error');
    // It names the kinds, because which of them are payments of the contract
    // price is the question that has to be answered next.
    assert.match(issue!.message, /ค่าธรรมเนียมการโอน/);
  });

  it('says nothing when the pull is coherent', () => {
    const mapped = mapMangoBundle(mangoFixture(), { reportDate: '2026-09-11' });
    assert.equal(mapped.issues.find((i) => i.code === 'MANGO_COLLECTED_EXCEEDS_CONTRACTED'), undefined);
  });

  it('reports the kinds of receipt rather than choosing between them', () => {
    const mapped = mapMangoBundle(mangoFixture(), { reportDate: '2026-09-11' });
    assert.ok(mapped.collectedByDoctype.size > 1, 'the receipt kinds were not reported');

    const total = [...mapped.collectedByDoctype.values()].reduce((sum, held) => sum + held.count, 0);
    assert.equal(total, (mangoFixture().transaction_detail ?? []).length,
      'some receipts were left out of the breakdown');
  });
});

/**
 * Which receipts are payments of the contract price.
 *
 * A live pull came back with six kinds of receipt filed against contracts,
 * named by single letters, totalling more than was ever contracted. Only
 * somebody who knows the system can say which are instalments and which are
 * transfer fees, so the decision is an input rather than a guess.
 */
describe('choosing which receipts count', () => {
  const withFee = () => {
    const bundle = mangoFixture();
    (bundle.transaction_detail ?? []).push({
      docno: 'BK-0001', rcptno: 'RC-1999', rcptdate: '2026-08-30',
      amount: 90_000, doctype: 'T',
    });
    return bundle;
  };

  it('counts every kind when nobody has said otherwise', () => {
    const all = mapMangoBundle(withFee(), { reportDate: '2026-09-11' });
    const bk1 = all.data.receivable.find((r) => r.unit === 'A-101');
    assert.ok(bk1);
    assert.ok(bk1!.receiveAmount >= 90_000, 'the unspecified kind was silently dropped');
  });

  it('counts only the kinds it was given', () => {
    const chosen = mapMangoBundle(withFee(), {
      reportDate: '2026-09-11',
      // Every kind in the fixture except the fee added above — including
      // โอนกรรมสิทธิ์, which is the balance paid at transfer and very much a
      // payment of the contract.
      paymentDoctypes: ['เงินจอง', 'เงินดาวน์', 'โอนกรรมสิทธิ์', 'งวดที่ 1', 'งวดที่ 2'],
    });
    const bk1 = chosen.data.receivable.find((r) => r.unit === 'A-101');
    assert.ok(bk1);

    const all = mapMangoBundle(withFee(), { reportDate: '2026-09-11' });
    const before = all.data.receivable.find((r) => r.unit === 'A-101')!.receiveAmount;
    assert.equal(before - bk1!.receiveAmount, 90_000, 'the excluded kind was still counted');
  });

  it('matches the kind whatever case it arrives in', () => {
    const bundle = mangoFixture();
    (bundle.transaction_detail ?? []).push({
      docno: 'BK-0001', rcptno: 'RC-1998', rcptdate: '2026-08-30', amount: 10_000, doctype: 'd',
    });

    const chosen = mapMangoBundle(bundle, { reportDate: '2026-09-11', paymentDoctypes: ['D'] });
    const bk1 = chosen.data.receivable.find((r) => r.unit === 'A-101');
    assert.equal(bk1?.receiveAmount, 10_000);
  });

  /**
   * The reason this is a choice and not a default: excluding a kind that is a
   * real instalment would overstate what is still owed, which is the same
   * error in the opposite direction.
   */
  it('still reports every kind it saw, including the ones not counted', () => {
    const chosen = mapMangoBundle(withFee(), { reportDate: '2026-09-11', paymentDoctypes: ['T'] });
    assert.ok(chosen.collectedByDoctype.has('T'));
    assert.ok(chosen.collectedByDoctype.size > 1, 'the kinds left out went unreported');
  });
});

/**
 * Overpayment at scale is a different finding from overpayment once.
 *
 * A live pull raised 749 of these, then 217 after the fee-shaped receipts were
 * excluded — 22% of every contract. At that rate it is not a handful of
 * mistyped contracts, and two hundred identical warnings bury whatever else
 * the run had to say.
 */
describe('overpayment, one contract and many', () => {
  it('gathers them into one finding with the total', () => {
    const result = run();
    const overpaid = result.issues.filter((i) => i.code === 'MANGO_OVERPAID');
    assert.equal(overpaid.length, 1, 'one message per contract, not one per pull');
    assert.match(overpaid[0].message, /of \d+ contracts/);
    assert.match(overpaid[0].message, /in total/);
  });

  it('counts them, so the scale is a number rather than a line count', () => {
    assert.equal(run().counts.overpaid, 1);
  });

  /**
   * One in a small pull is a warning about that contract. A fifth of every
   * contract is a warning about the pull, and should not be filed at the same
   * severity as a single revised price.
   */
  it('raises it as an error once it stops being a handful', () => {
    const bundle = mangoFixture();
    // Pay every contract double.
    for (const row of bundle.transaction ?? []) {
      const paid = (bundle.transaction_detail ?? []).filter((d) => d.docno === row.docno);
      for (const receipt of paid) receipt.amount = Number(receipt.amount) * 10;
    }

    const mapped = mapMangoBundle(bundle, { reportDate: '2026-09-11' });
    const overpaid = mapped.issues.find((i) => i.code === 'MANGO_OVERPAID');
    assert.ok(overpaid);
    assert.equal(overpaid!.severity, 'error');
    assert.match(overpaid!.message, /not a handful of mistyped contracts/);
  });
});

/**
 * A document number carried by two contracts.
 *
 * Receipts are matched on the document number alone, so a number used twice
 * credits both contracts with the whole set — the same money counted twice,
 * every contract sharing it reading as overpaid, and the collected total
 * inflated. A live pull showed contracts that had taken three to six times
 * their value, which is the shape this makes.
 */
describe('a document number used more than once', () => {
  const shared = () => {
    const bundle = mangoFixture();
    const first = (bundle.transaction ?? [])[0];
    (bundle.transaction ?? []).push({
      ...first,
      pre_event: 'A-999',
      customer_name: 'Another buyer entirely',
    });
    return bundle;
  };

  it('is reported, and named', () => {
    const mapped = mapMangoBundle(shared(), { reportDate: '2026-09-11' });
    const issue = mapped.issues.find((i) => i.code === 'MANGO_DUPLICATE_DOCNO');
    assert.ok(issue, 'two contracts shared a document number and nothing said so');
    assert.equal(issue!.severity, 'error');
    assert.match(issue!.message, /BK-0001/);
    assert.equal(mapped.counts.sharedDocnos, 1);
  });

  it('says that the money is counted more than once', () => {
    const mapped = mapMangoBundle(shared(), { reportDate: '2026-09-11' });
    const issue = mapped.issues.find((i) => i.code === 'MANGO_DUPLICATE_DOCNO');
    assert.match(issue!.message, /counted more than once/);
  });

  /**
   * The symptom this explains: both contracts are credited with the full set,
   * so the collected total counts those receipts twice.
   */
  it('is what inflates the collected total', () => {
    const plain = mapMangoBundle(mangoFixture(), { reportDate: '2026-09-11' });
    const doubled = mapMangoBundle(shared(), { reportDate: '2026-09-11' });

    const sum = (rows: { receiveAmount: number }[]) =>
      rows.reduce((total, row) => total + row.receiveAmount, 0);

    assert.ok(sum(doubled.data.receivable) > sum(plain.data.receivable),
      'the duplicate did not inflate collections, so this test no longer covers the bug');
  });

  it('says nothing when every document number is its own', () => {
    const mapped = mapMangoBundle(mangoFixture(), { reportDate: '2026-09-11' });
    assert.equal(mapped.counts.sharedDocnos, 0);
    assert.equal(mapped.issues.find((i) => i.code === 'MANGO_DUPLICATE_DOCNO'), undefined);
  });
});
