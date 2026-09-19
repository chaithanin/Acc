import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mapAnywhereBundle } from '@/lib/sources/anywhere/map';
import { anywhereFixture } from './fixtures/anywhere-bundle';

const run = (projectId: string | null = null) =>
  mapAnywhereBundle(anywhereFixture(), { reportDate: '2026-09-18', maincode: 'MG2', projectId });

/**
 * `balance_amt` is the balance. `total_amt` is not the history.
 *
 * Read as invoiced-less-outstanding, the live answer had customers owing three
 * times what had been billed to them — sixteen of twenty-seven individually
 * impossible. What settles it is that the ageing bands total exactly the sum of
 * `balance_amt`, to the baht. So the balance is trusted and nothing pretends to
 * know what was collected.
 */
describe('what the group is owed', () => {
  it('records the balance as the amount owed', () => {
    const result = run();
    // 1,250,000 + 750,000 + 250,000. The paid-off and dormant rows carry nothing.
    assert.equal(result.totals.receivableOutstanding, 2_250_000);
    assert.equal(result.counts.customers, 3);
  });

  it('treats the whole of a balance as unpaid, because that is what a balance is', () => {
    const abc = run().data.receivable.find((r) => r.customer === 'ABC Trading Co., Ltd.');
    assert.ok(abc);
    assert.equal(abc!.contractualAmount, 1_250_000);
    assert.equal(abc!.accrueAmount, 1_250_000);
    assert.equal(abc!.receiveAmount, 0, 'a payment was invented out of two columns that cannot say');
  });

  it('never derives a payment from total_amt', () => {
    // C-001 is billed 450,000 this period against a balance of 1,250,000. An
    // invoiced-less-outstanding reading would make that a negative payment.
    for (const row of run().data.receivable) {
      assert.equal(row.receiveAmount, 0);
      assert.ok(row.contractualAmount > 0);
    }
  });

  it('reads money that arrives as a formatted string', () => {
    const somchai = run().data.receivable.find((r) => r.customer === 'Somchai Ltd');
    assert.equal(somchai?.contractualAmount, 750_000);
  });

  it('drops a customer who owes nothing rather than filing an empty row', () => {
    assert.ok(!run().data.receivable.some((r) => r.customer === 'XYZ Limited'));
    assert.ok(!run().data.receivable.some((r) => r.customer === 'Dormant Co'));
  });

  /**
   * Said out loud on every pull, because it is the reason a whole column is
   * left alone — and because the estate side already lost a figure to a column
   * whose name sounded right.
   */
  it('says why total_amt is not treated as the history', () => {
    const issue = run().issues.find((i) => i.code === 'ANYWHERE_TOTAL_AMT_IS_NOT_THE_HISTORY');
    assert.ok(issue, 'a column was quietly set aside');
    // "3 of 5 customers owe": the noun follows the population, the verb the
    // count. Pluralising the noun from the count gave "1 of 27 customer owes".
    assert.match(issue!.message, /^3 of 5 customers owe more/,
      'the count and the population disagree about number');
    assert.match(issue!.message, /this period\u2019s billing/);
    assert.match(issue!.message, /no figure here claims to say what was collected/);
  });
});

describe('what the group owes', () => {
  it('records the vendor balances as owed in full', () => {
    const result = run();
    assert.equal(result.totals.payableOutstanding, 890_000);
    assert.equal(result.counts.vendors, 1, 'a vendor owed nothing was filed anyway');

    const supplier = result.data.payable.find((r) => r.vendor === 'Supplier A Co., Ltd.');
    assert.ok(supplier);
    assert.equal(supplier!.invoiceAmount, 890_000);
    assert.equal(supplier!.paidAmount, 0);
    assert.equal(supplier!.statedOutstanding, 890_000);
  });

  it('takes the vendor from cust_name, which is Mango\u2019s wording for it', () => {
    assert.ok(run().data.payable.some((r) => r.vendor === 'Supplier A Co., Ltd.'));
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

/**
 * The bank endpoint does not return only cash.
 *
 * The live answer summed to minus 112 million, which is not a cash position.
 * Eleven accounts arrive from one endpoint and `account_type` is the only thing
 * telling a current account from a loan.
 */
describe('the bank', () => {
  it('keeps every account, including the ones that are balances the other way', () => {
    assert.equal(run().counts.bankAccounts, 3);
  });

  it('refuses to publish a negative cash position, and names the types', () => {
    const result = run();
    assert.ok(result.totals.cash < 0);

    const issue = result.issues.find((i) => i.code === 'ANYWHERE_BANK_TOTAL_NEGATIVE');
    assert.ok(issue, 'a negative cash position was reported as a cash position');
    assert.equal(issue!.severity, 'error');
    assert.match(issue!.message, /LN/, 'the account types were not named');
    assert.match(issue!.message, /Say which of those are cash/);
  });

  it('groups the balances by type, so the question can be answered', () => {
    const byType = run().bankByType;
    assert.equal(byType.get('CA')?.amount, 45_200_000);
    assert.equal(byType.get('SA')?.amount, 8_750_000);
    assert.equal(byType.get('LN')?.amount, -180_000_000);
  });

  it('says nothing about the sign when every account is cash', () => {
    const bundle = anywhereFixture();
    bundle.bankAccounts = (bundle.bankAccounts ?? []).filter((a) => a.account_type !== 'LN');

    const mapped = mapAnywhereBundle(bundle, { reportDate: '2026-09-18', maincode: 'MG2' });
    assert.equal(mapped.totals.cash, 53_950_000);
    assert.equal(mapped.issues.find((i) => i.code === 'ANYWHERE_BANK_TOTAL_NEGATIVE'), undefined);
  });

  /**
   * The guarantees come from the same endpoint with one parameter changed,
   * which makes adding them to cash the easy mistake. The bank is holding that
   * money against the group\u2019s obligations; it is not money to spend.
   */
  it('keeps guarantees out of the accounts, and says it did', () => {
    const result = run();
    assert.equal(result.totals.guarantees, 15_000_000);
    assert.ok(!result.data.bank.some((b) => b.currentAmount === 15_000_000),
      'a guarantee was filed as a bank balance');

    const issue = result.issues.find((i) => i.code === 'ANYWHERE_GUARANTEES_EXCLUDED');
    assert.ok(issue, 'guarantees were excluded without saying so');
    assert.match(issue!.message, /^1 bank guarantee account holding .* is reported separately/);
  });

  it('names the bank in English where it can, and keeps the account number', () => {
    const scb = run().data.bank.find((b) => b.accountNo === '123-4-56789-0');
    assert.ok(scb);
    assert.equal(scb!.bankName, 'Siam Commercial Bank');
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

/**
 * Every account negative is a convention. Some negative is a mixture.
 *
 * The live answer returned all eleven accounts negative, totalling minus 112
 * million across two account types that were both negative — so it is not
 * loans mixed in with cash, which was my first reading. A group does not hold
 * eleven overdrawn accounts. Those two cases want different answers and
 * reporting both as "not a cash position" leaves the reader to work out which
 * they have.
 */
describe('which way round the bank balances are', () => {
  const allNegative = () => {
    const bundle = anywhereFixture();
    bundle.bankAccounts = (bundle.bankAccounts ?? []).map((account) => ({
      ...account,
      balamt: -Math.abs(Number(String(account.balamt).replace(/[,\s]/g, ''))),
    }));
    return bundle;
  };

  it('calls a uniform sign a convention, and says what it would read the other way', () => {
    const mapped = mapAnywhereBundle(allNegative(), { reportDate: '2026-09-18', maincode: 'MG2' });
    const issue = mapped.issues.find((i) => i.code === 'ANYWHERE_BANK_SIGN_INVERTED');
    assert.ok(issue, 'all-negative balances were not recognised as a convention');
    assert.match(issue!.message, /sign convention rather than a position/);
    assert.match(issue!.message, /233,950,000/, 'it did not say what the figure would be');
    assert.equal(mapped.issues.find((i) => i.code === 'ANYWHERE_BANK_TOTAL_NEGATIVE'), undefined);
  });

  it('calls a mixed sign a mixture, which is a different problem', () => {
    // The fixture as it stands: two positive accounts and one loan.
    const mapped = mapAnywhereBundle(anywhereFixture(), { reportDate: '2026-09-18', maincode: 'MG2' });
    const issue = mapped.issues.find((i) => i.code === 'ANYWHERE_BANK_TOTAL_NEGATIVE');
    assert.ok(issue);
    assert.match(issue!.message, /liabilities among the assets/);
  });

  /**
   * The answer is recorded rather than inferred. Reading a cash position with
   * the sign wrong is worse than reporting none.
   */
  it('takes the balances the other way round when told to, and says nothing more', () => {
    const mapped = mapAnywhereBundle(allNegative(), {
      reportDate: '2026-09-18', maincode: 'MG2', flipBankSign: true,
    });
    assert.equal(mapped.totals.cash, 233_950_000);
    assert.equal(mapped.issues.find((i) => i.code === 'ANYWHERE_BANK_SIGN_INVERTED'), undefined);
    assert.ok(mapped.data.bank.every((account) => account.currentAmount > 0));
  });

  it('is not applied by default', () => {
    const mapped = mapAnywhereBundle(allNegative(), { reportDate: '2026-09-18', maincode: 'MG2' });
    assert.ok(mapped.totals.cash < 0, 'the sign was flipped without being asked');
  });
});

/**
 * The balances have no dates and the ageing report is built from dates.
 *
 * Mango answers a balance per customer and a band per customer, and nothing
 * saying when anything fell due. So these records land in the ageing report's
 * undated bucket — correctly, and not silently — but replacing dated workbook
 * receivables with them moves the whole report into one bucket. That is a
 * consequence of the decision to make Mango the source, and it should be read
 * rather than discovered.
 */
describe('balances without dates', () => {
  it('says what that costs the ageing report, and names the bands it has instead', () => {
    const issue = run().issues.find((i) => i.code === 'ANYWHERE_RECEIVABLES_UNDATED');
    assert.ok(issue, 'a whole report changed behaviour without a word');
    assert.equal(issue!.severity, 'warning');
    assert.match(issue!.message, /undated bucket/);
    assert.match(issue!.message, /loses\s+its buckets/);
    // The bands Mango does have, so the information is visibly not lost.
    assert.match(issue!.message, /A 1,250,000/);
  });

  it('leaves the due date empty rather than inventing one', () => {
    assert.ok(run().data.receivable.every((row) => row.dueDate === null),
      'a due date was invented to fill an ageing bucket');
  });

  it('says nothing when there are no balances to misplace', () => {
    const mapped = mapAnywhereBundle({}, { reportDate: '2026-09-19', maincode: 'MG4' });
    assert.equal(mapped.issues.find((i) => i.code === 'ANYWHERE_RECEIVABLES_UNDATED'), undefined);
  });
});
