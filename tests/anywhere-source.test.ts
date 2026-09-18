import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mapAnywhereBundle } from '@/lib/sources/anywhere/map';
import { anywhereFixture } from './fixtures/anywhere-bundle';

const run = (projectId: string | null = null) =>
  mapAnywhereBundle(anywhereFixture(), { reportDate: '2026-09-18', maincode: 'MG2', projectId });

describe('what the group is owed', () => {
  it('reads the invoiced total and what is still outstanding', () => {
    const result = run();
    // 4,500,000 + 900,000 + 2,400,000.50 + 100,000. The dormant row is dropped.
    assert.equal(result.totals.receivable, 7_900_000.5);
    assert.equal(result.totals.receivableOutstanding, 2_250_000);
    assert.equal(result.counts.customers, 4);
  });

  /**
   * Nothing in the answer says what came in, so collected is invoiced less
   * outstanding. Subtracting is the only honest reading available.
   */
  it('derives what was collected rather than reading a column that is not there', () => {
    const abc = run().data.receivable.find((r) => r.customer === 'ABC Trading Co., Ltd.');
    assert.ok(abc);
    assert.equal(abc!.contractualAmount, 4_500_000);
    assert.equal(abc!.receiveAmount, 3_250_000);
    assert.equal(abc!.accrueAmount, 1_250_000);
  });

  it('reads money that arrives as a formatted string', () => {
    const somchai = run().data.receivable.find((r) => r.customer === 'Somchai Ltd');
    assert.equal(somchai?.contractualAmount, 2_400_000.5);
    assert.equal(somchai?.receiveAmount, 1_650_000.5);
  });

  /**
   * Owing more than was invoiced cannot be read as a payment. Reporting a
   * negative collection would be arithmetically tidy and wrong.
   */
  it('refuses to turn an impossible balance into a negative payment', () => {
    const result = run();
    const impossible = result.data.receivable.find((r) => r.customer === 'Impossible Co');
    assert.equal(impossible?.receiveAmount, 0);

    const issue = result.issues.find((i) => i.code === 'ANYWHERE_AR_OUTSTANDING_EXCEEDS_INVOICED');
    assert.ok(issue, 'a balance larger than the invoices went unreported');
    assert.match(issue!.message, /^1 customer owes more than was invoiced/,
      'the singular warning does not read as a sentence');
  });
});

describe('what the group owes', () => {
  it('reads the vendor balances', () => {
    const result = run();
    assert.equal(result.totals.payable, 4_300_000);
    assert.equal(result.totals.payableOutstanding, 890_000);
    assert.equal(result.counts.vendors, 2);
  });

  it('takes the vendor from cust_name, which is Mango’s wording for it', () => {
    const supplier = run().data.payable.find((r) => r.vendor === 'Supplier A Co., Ltd.');
    assert.ok(supplier, 'the vendor name was not carried through');
    assert.equal(supplier!.invoiceAmount, 3_200_000);
    assert.equal(supplier!.paidAmount, 2_310_000);
  });

  /**
   * `acct_no` is a ledger account. Putting it where an invoice number belongs
   * would make every row look like it cites a document.
   */
  it('does not pass the ledger account off as an invoice number', () => {
    const supplier = run().data.payable.find((r) => r.vendor === 'Supplier A Co., Ltd.');
    assert.equal(supplier!.invoiceNo, null);
    assert.match(supplier!.description ?? '', /2101-01/);
  });
});

describe('the bank', () => {
  it('sums the balances into a cash position', () => {
    const result = run();
    assert.equal(result.totals.cash, 53_950_000);
    assert.equal(result.counts.bankAccounts, 2);
  });

  /**
   * The guarantees come from the same endpoint with one parameter changed,
   * which makes adding them to cash the easy mistake. The bank is holding that
   * money against the group's obligations; it is not money to spend.
   */
  it('keeps guarantees out of cash, and says it did', () => {
    const result = run();
    assert.equal(result.totals.guarantees, 15_000_000);
    assert.ok(result.totals.cash < result.totals.guarantees + result.totals.cash);
    assert.ok(!result.data.bank.some((b) => b.currentAmount === 15_000_000),
      'a guarantee was filed as a bank balance');

    const issue = result.issues.find((i) => i.code === 'ANYWHERE_GUARANTEES_EXCLUDED');
    assert.ok(issue, 'guarantees were excluded without saying so');
    assert.match(issue!.message, /^1 bank guarantee account holding .* is reported separately/);
  });

  it('names the bank in English where it can, and keeps the account number', () => {
    const scb = run().data.bank.find((b) => b.bankName === 'Siam Commercial Bank');
    assert.ok(scb);
    assert.equal(scb!.accountNo, '123-4-56789-0');
    assert.equal(scb!.pendingExpense, 150_000);
  });
});

/**
 * The monthly figures are cash moved, not revenue raised.
 *
 * The balances already carry the invoiced amounts. Writing the receipts into
 * the income ledger as well would report the invoices plus the payments for
 * those same invoices — the double count the overlap rule exists to catch, and
 * the trap the estate-side receipts fell into.
 */
describe('collections and payments, kept out of the ledgers', () => {
  it('does not write receipts as income', () => {
    assert.deepEqual(run().data.income, []);
  });

  it('does not write payments as expense', () => {
    assert.deepEqual(run().data.expense, []);
  });

  it('totals each month, adding rows that share one', () => {
    const result = run();
    assert.equal(result.collectedByMonth.get('2026-08'), 1_800_000);
    // 950,000 + 50,000 in the same month.
    assert.equal(result.collectedByMonth.get('2026-09'), 1_000_000);
    assert.equal(result.paidByMonth.get('2026-09'), 400_000);
  });

  it('drops a row whose period cannot be read rather than filing it under nothing', () => {
    const result = run();
    assert.ok(![...result.collectedByMonth.values()].includes(99_999));
  });
});

/**
 * The two ageing screens of the same system return different shapes.
 *
 * Receivables come back one row per band; payables come back as one row with a
 * column per band. Assuming they match is how one of them silently becomes
 * empty.
 */
describe('ageing, in both shapes it arrives in', () => {
  it('reads the receivable bands, one row each', () => {
    const bands = run().ageing.receivable;
    assert.deepEqual(bands.map((b) => b.band), ['A', 'B', 'C']);
    assert.equal(bands[0].amount, 1_250_000);
  });

  it('reads the payable bands, spread across one row', () => {
    const bands = run().ageing.payable;
    assert.equal(bands.length, 1, 'the zero bands were reported as bands');
    assert.equal(bands[0].band, 'Grade A');
    assert.equal(bands[0].amount, 890_000);
  });

  /**
   * Two independent answers to the same question. When they disagree, one is
   * measuring something else, and that is worth knowing before either is
   * published as the receivable position.
   */
  it('says so when the bands do not add up to the balances', () => {
    const result = run();
    // Bands total 2,250,000 and so do the balances, so nothing to report.
    assert.equal(result.issues.find((i) => i.code === 'ANYWHERE_AGEING_DISAGREES'), undefined);

    const bundle = anywhereFixture();
    bundle.arAgeing = [{ grade_inv: 'A', balamt: 9_000_000 }];
    const skewed = mapAnywhereBundle(bundle, { reportDate: '2026-09-18', maincode: 'MG2' });
    assert.ok(skewed.issues.find((i) => i.code === 'ANYWHERE_AGEING_DISAGREES'));
  });
});

describe('a column nobody has explained', () => {
  /**
   * `total_inv` is never used in a figure. Saying so is the lesson from the
   * estate side, where a column that read like a total held a revision number
   * and priced 1,839 units at thirteen baht each.
   */
  it('reports total_inv as unused, and says what it looks like', () => {
    const issue = run().issues.find((i) => i.code === 'ANYWHERE_TOTAL_INV_UNUSED');
    assert.ok(issue);
    assert.match(issue!.message, /count of invoices/);
    assert.equal(issue!.severity, 'info');
  });

  it('never lets it reach a total', () => {
    const result = run();
    // 12 + 3 + 7 + 1 = 23, which must appear in no figure.
    for (const value of Object.values(result.totals)) assert.notEqual(value, 23);
  });
});

describe('placing it against a project', () => {
  it('carries a project id when the company maps to one', () => {
    const result = run('proj-sun9');
    assert.ok(result.data.receivable.every((r) => r.projectId === 'proj-sun9'));
    assert.ok(result.data.bank.every((b) => b.projectId === 'proj-sun9'));
  });

  it('keeps the company code as the label either way', () => {
    assert.ok(run().data.payable.every((r) => r.projectLabel === 'MG2'));
  });
});

describe('an empty answer', () => {
  it('maps to nothing rather than failing', () => {
    const result = mapAnywhereBundle({}, { reportDate: '2026-09-18', maincode: 'MG4' });
    assert.deepEqual(result.data.receivable, []);
    assert.equal(result.totals.cash, 0);
    assert.equal(result.counts.customers, 0);
  });
});
