import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calculateMetrics } from '@/lib/calc/kpi';
import { runValidations } from '@/lib/validate/rules';
import { emptyDataset, type NormalizedDataset, type SourceRef } from '@/lib/types';

/**
 * The financial audit: every KPI against a figure worked out by hand.
 *
 * The dataset below was chosen so that every total can be checked on paper.
 * The point is not that the code adds up — it is that the arithmetic the code
 * performs is the arithmetic an accountant would recognise, and where it is
 * not, that the difference is written down here rather than discovered by a
 * CEO in a board meeting.
 */

const REPORT_DATE = '2026-08-31';
const ref = (cell: string): SourceRef => ({ file: 'audit.xlsx', sheet: 'Sheet1', row: 1, col: 1, cell });
const base = { projectId: 'P1', projectLabel: 'Project One', sourceRef: ref('B2') };

/**
 * One project, one month, figures a controller could add up in their head.
 *
 *   Bank             15,000,000   (10,000,000 + 5,000,000)
 *   Pending           2,000,000   (1,000,000 bank + 1,000,000 expense)
 *   Receivable       24,500,000 contracted, 10,000,000 collected
 *   Income sheet      6,000,000 contracted,  2,000,000 collected
 *   Expense           5,000,000   (4,000,000 construction, 0.5m marketing,
 *                                  0.3m tax, 0.2m administration)
 *   BOQ              50,000,000 contract, 20,000,000 certified, 16,000,000 paid
 *   WIP               7,000,000 YTD, 2,000,000 advances
 */
function auditDataset(): NormalizedDataset {
  return {
    ...emptyDataset(),
    bank: [
      { kind: 'bank', ...base, bankName: 'Kasikorn', accountNo: '1', currentAmount: 10_000_000, pendingExpense: 1_000_000 },
      { kind: 'bank', ...base, bankName: 'Bangkok', accountNo: '2', currentAmount: 5_000_000, pendingExpense: 0 },
    ],
    receivable: [
      { kind: 'receivable', ...base, category: 'contract', customer: 'Buyer A', unit: 'A-1',
        contractualAmount: 20_000_000, receiveAmount: 8_000_000, accrueAmount: 12_000_000, dueDate: '2026-06-30' },
      { kind: 'receivable', ...base, category: 'reservation', customer: 'Buyer B', unit: 'A-2',
        contractualAmount: 1_000_000, receiveAmount: 1_000_000, accrueAmount: 0, dueDate: '2026-05-31' },
      { kind: 'receivable', ...base, category: 'down_payment', customer: 'Buyer C', unit: 'A-3',
        contractualAmount: 3_000_000, receiveAmount: 1_000_000, accrueAmount: 2_000_000, dueDate: '2026-07-31' },
      { kind: 'receivable', ...base, category: 'transfer_fee', customer: 'Buyer D', unit: 'A-4',
        contractualAmount: 500_000, receiveAmount: 0, accrueAmount: 500_000, dueDate: '2027-01-31' },
    ],
    income: [
      { kind: 'income', ...base, category: 'contract', description: 'Sales ledger', month: '2026-08',
        contractualAmount: 6_000_000, receivedAmount: 2_000_000, accruedAmount: 4_000_000, isForecast: false },
    ],
    expense: [
      { kind: 'expense', ...base, category: 'construction', description: 'Main contractor', month: '2026-08',
        amount: 4_000_000, paidAmount: 3_000_000, pendingAmount: 1_000_000, isForecast: false },
      { kind: 'expense', ...base, category: 'marketing', description: 'Advertising', month: '2026-08',
        amount: 500_000, paidAmount: 500_000, pendingAmount: 0, isForecast: false },
      { kind: 'expense', ...base, category: 'tax', description: 'Specific business tax', month: '2026-08',
        amount: 300_000, paidAmount: 300_000, pendingAmount: 0, isForecast: false },
      { kind: 'expense', ...base, category: 'administration', description: 'Office', month: '2026-08',
        amount: 200_000, paidAmount: 200_000, pendingAmount: 0, isForecast: false },
    ],
    boq: [
      { kind: 'boq', ...base, accountCode: '5100', description: 'Structure', contractor: 'Somsak',
        costCategory: 'construction', month: '2026-08',
        boqAmount: 50_000_000, boqToDate: 20_000_000, paidAmount: 16_000_000, pendingAmount: 4_000_000 },
    ],
    wip: [
      { kind: 'wip', ...base, accountCode: '1400', accountName: 'WIP', currentPeriod: 1_000_000,
        ytd: 7_000_000, advancePayment: 2_000_000, statedClosing: null },
    ],
  };
}

const run = (data: NormalizedDataset) => calculateMetrics(data, REPORT_DATE);
const v = (calc: ReturnType<typeof run>, key: string) => calc.byKey.get(key)?.value ?? null;

describe('cash and bank', () => {
  const calc = run(auditDataset());

  it('bank balance is the sum of the accounts', () => {
    assert.equal(v(calc, 'bank_current_amount'), 15_000_000);
  });

  it('pending is the bank column plus the expense column, added once each', () => {
    assert.equal(v(calc, 'pending_expense'), 2_000_000);
  });

  it('available cash is bank less pending', () => {
    assert.equal(v(calc, 'available_cash'), 13_000_000);
    assert.equal(v(calc, 'current_cash'), 13_000_000);
  });
});

describe('receivables', () => {
  const calc = run(auditDataset());

  it('outstanding is contracted less collected', () => {
    assert.equal(v(calc, 'total_receivable_outstanding'), 14_500_000);
  });

  it('the category buckets add up to the total', () => {
    const parts = ['reservation_outstanding', 'contract_outstanding',
      'down_payment_outstanding', 'transfer_outstanding'].map((k) => v(calc, k) ?? 0);

    assert.deepEqual(parts, [0, 12_000_000, 2_000_000, 500_000]);
    assert.equal(parts.reduce((a, b) => a + b, 0), v(calc, 'total_receivable_outstanding'));
  });

  it('is aged and has an overdue balance, off the due dates the file carries', () => {
    const keys = [...calc.byKey.keys()];
    assert.ok(keys.filter((k) => /aged|overdue/.test(k)).length >= 7);
    assert.equal(v(calc, 'receivable_overdue'), 14_000_000);
  });
});

describe('income and profit', () => {
  const calc = run(auditDataset());

  it('the collections view still shows everything contracted', () => {
    assert.equal(v(calc, 'total_contractual_income'), 30_500_000);
    assert.equal(v(calc, 'received_income'), 12_000_000);
    assert.equal(v(calc, 'accrued_income'), 18_500_000);
  });

  /**
   * The order book is what buyers have committed to pay for their units.
   * A reservation fee and a transfer fee are consideration for something other
   * than the unit, so they are not part of the price revenue is earned against.
   */
  it('the order book is the sale-price categories, not every receivable', () => {
    // 20,000,000 instalments + 3,000,000 down payment + 6,000,000 sales ledger.
    // The 1,000,000 reservation and 500,000 transfer fee are excluded.
    assert.equal(v(calc, 'contracted_sale_value'), 29_000_000);
  });

  it('completion is measured by the construction contract, not estimated', () => {
    // 20,000,000 certified of a 50,000,000 contract.
    assert.equal(v(calc, 'completion_percent'), 40);
  });

  it('revenue is recognised as the building is built', () => {
    assert.equal(v(calc, 'recognised_revenue'), 11_600_000);
    assert.equal(v(calc, 'revenue_backlog'), 17_400_000);
    assert.match(calc.byKey.get('recognised_revenue')!.formula, /Contracted sale value × /);
  });

  it('operating expenses exclude both direct cost and tax', () => {
    assert.equal(v(calc, 'operating_expenses'), 700_000);
    assert.equal(v(calc, 'taxes'), 300_000);
    assert.equal(v(calc, 'total_expense'), 5_000_000);
  });

  /**
   * FIN-01, as fixed.
   *
   * The construction cost of unsold units is inventory, not cost of sales, and
   * the sold share cannot be worked out from the sales ledger alone — it needs
   * the project's total sale value, which is a board figure. Without it the
   * engine says so instead of reporting a margin it cannot support.
   */
  it('refuses to report a margin until the project’s total sale value is known', () => {
    assert.equal(v(calc, 'cost_of_goods_sold'), null);
    assert.equal(v(calc, 'gross_profit'), null);
    assert.equal(v(calc, 'operating_profit'), null);
    assert.equal(v(calc, 'net_profit'), null);
    assert.equal(v(calc, 'net_profit_margin'), null);
    assert.match(calc.byKey.get('gross_profit')!.formula, /Not calculable/);
    assert.match(calc.byKey.get('cost_of_goods_sold')!.formula, /inventory/);
  });

  describe('with the project’s total sale value set', () => {
    // Half the project is under contract: 29,000,000 of 58,000,000.
    const full = calculateMetrics(auditDataset(), REPORT_DATE, { totalSaleValue: 58_000_000 });
    const f = (key: string) => full.byKey.get(key)?.value ?? null;

    it('charges only the sold units’ share of construction to cost of sales', () => {
      // 20,000,000 certified × 50% sold.
      assert.equal(f('cost_of_goods_sold'), 10_000_000);
    });

    it('the statement chains from recognised revenue', () => {
      assert.equal(f('gross_profit'), 1_600_000);
      assert.equal(f('operating_profit'), 900_000);
      assert.equal(f('net_profit'), 600_000);
    });

    /**
     * The figure this whole finding was about. It read 83.61% when revenue was
     * the whole order book and cost was one month of building.
     */
    it('produces a margin a property developer would recognise', () => {
      assert.equal(f('net_profit_margin'), 5.17);
    });
  });

  it('reports margin as not calculable rather than zero when nothing is sold', () => {
    const empty = { ...auditDataset(), receivable: [], income: [] };
    const calc2 = calculateMetrics(empty, REPORT_DATE, { totalSaleValue: 58_000_000 });
    assert.equal(calc2.byKey.get('net_profit_margin')?.value, null);
  });
});

/**
 * FIN-02. The same contract counted twice.
 *
 * A receivable sheet and a sales sheet describing the same contracts are both
 * ordinary monthly exports, and the detector accepts both — "รับแล้ว" appears
 * in the header vocabulary of each. Their contractual amounts are added
 * together with nothing comparing them, so revenue doubles and no validation
 * rule notices.
 */
describe('double counting between the receivable and income sheets', () => {
  it('adds the same contract twice with no warning', () => {
    const data = auditDataset();
    // The sales sheet restates the receivable ledger — same money, second file.
    data.income = data.receivable.map((r) => ({
      kind: 'income' as const, ...base, category: r.category,
      description: `Restated ${r.customer}`, month: '2026-08',
      contractualAmount: r.contractualAmount, receivedAmount: r.receiveAmount,
      accruedAmount: r.accrueAmount, isForecast: false,
    }));

    const calc = run(data);
    assert.equal(v(calc, 'total_contractual_income'), 49_000_000, 'expected 24.5m counted twice');

    // A rule that could not run for want of data is not a rule that noticed.
    const failures = runValidations(data, calc, null)
      .filter((r) => r.status === 'error' || r.status === 'warning');
    assert.deepEqual(failures.map((f) => f.ruleKey), [],
      'a rule caught the double count — this test needs updating, the defect is fixed');
  });
});

/**
 * FIN-03. Three of the eight reconciliation rules cannot fail.
 *
 * Each compares a derived figure with the definition it was derived from, so
 * the two are equal by construction. They are shown to management beside the
 * five real checks, in the same green, which overstates how much has been
 * verified.
 */
describe('validation rules that prove themselves', () => {
  const tautologies = ['bank_identity', 'income_components', 'boq_reconciliation'];

  it('stay green on data engineered to be wrong', () => {
    const data = auditDataset();
    // Every stated figure in the file contradicts the others: the accrue
    // column disagrees with contractual less received, the bank sheet's
    // pending disagrees with the expense records, BOQ paid exceeds the
    // certified value.
    data.receivable[0]!.accrueAmount = 999;
    data.bank[0]!.pendingExpense = 12_345_678;
    data.boq[0]!.paidAmount = 45_000_000;

    const calc = run(data);
    const results = runValidations(data, calc, null);

    for (const key of tautologies) {
      const rule = results.find((r) => r.ruleKey === key);
      assert.ok(rule, `${key} did not run`);
      assert.equal(rule.status, 'pass',
        `${key} failed — it may have become a real check, in which case this test should go`);
      assert.equal(rule.difference, 0);
    }
  });

  it('while the rules that read the file’s own stated figures do fail', () => {
    const data = auditDataset();
    data.receivable[0]!.accrueAmount = 999;

    const results = runValidations(data, run(data), null);
    const rowIdentity = results.find((r) => r.ruleKey === 'receivable_row_identity');
    assert.ok(rowIdentity);
    assert.notEqual(rowIdentity.status, 'pass', 'the one real receivable check did not notice');
  });
});

describe('position and liquidity', () => {
  const calc = run(auditDataset());

  it('BOQ certified, paid and outstanding reconcile', () => {
    assert.equal(v(calc, 'boq_total'), 50_000_000);
    assert.equal(v(calc, 'boq_to_date'), 20_000_000);
    assert.equal(v(calc, 'boq_paid'), 16_000_000);
    assert.equal(v(calc, 'boq_outstanding'), 4_000_000);
    assert.equal(v(calc, 'remaining_boq'), 34_000_000);
  });

  it('outstanding expense is certified work unpaid plus pending payments', () => {
    assert.equal(v(calc, 'total_outstanding_expense'), 6_000_000);
  });

  it('net position is cash plus receivables less what is owed', () => {
    assert.equal(v(calc, 'net_financial_position'), 25_500_000);
  });

  /**
   * FIN-04. The liquidity ratios divide by a construction proxy, not payables.
   *
   * There is no accounts-payable module — no vendor, no invoice, no due date.
   * The denominator is certified-but-unpaid construction plus pending bank
   * payments, which is a real obligation but not the company's payables. A
   * quick ratio computed this way flatters any month with light certification.
   */
  it('uses BOQ outstanding plus pending as the payables denominator', () => {
    assert.equal(v(calc, 'quick_ratio'), 4.58);
    assert.equal(v(calc, 'current_ratio'), 6.08);

    const quick = calc.byKey.get('quick_ratio');
    assert.ok(quick);
    assert.ok(quick.formula.includes('Accounts Payable'));
    assert.equal(quick.inputs.find((i) => i.label === 'Accounts Payable')?.value, 6_000_000);
  });

  it('reports both as not calculable rather than infinity with nothing owed', () => {
    const data = { ...auditDataset(), boq: [], expense: [], bank: auditDataset().bank.map((b) => ({ ...b, pendingExpense: 0 })) };
    const calc2 = run(data);
    assert.equal(v(calc2, 'quick_ratio'), null);
    assert.equal(v(calc2, 'current_ratio'), null);
  });
});

describe('forecasting without forecast rows', () => {
  const calc = run(auditDataset());

  it('falls back to the uncollected balance and says so in the formula', () => {
    assert.equal(v(calc, 'expected_future_income'), 18_500_000);
    assert.match(calc.byKey.get('expected_future_income')!.formula, /no forecast months/i);
  });

  it('falls back to remaining BOQ plus pending for future expense', () => {
    assert.equal(v(calc, 'total_future_expense'), 36_000_000);
    assert.match(calc.byKey.get('total_future_expense')!.formula, /no forecast months/i);
  });

  /**
   * FIN-05. The fallback is not a forecast and is not labelled as one on the
   * dashboard tile — only inside "View Calculation".
   */
  it('leaves forecast cash equal to current cash, which reads as a flat projection', () => {
    assert.equal(v(calc, 'forecast_cash'), 13_000_000);
    assert.equal(v(calc, 'lowest_forecast_cash'), 13_000_000);
    assert.equal(v(calc, 'cash_shortfall'), 0);
    assert.equal(v(calc, 'required_funding'), 0);
  });
});

/**
 * FIN-03, as fixed.
 *
 * The budget is a figure for one month. Comparing it with a balance that has
 * been accumulating since the project began read 18,873% on the real SUN9
 * volumes — the budget dial was decoration.
 */
describe('the period, as distinct from the balance', () => {
  const calc = run(auditDataset());

  it('separates the month’s income from everything ever contracted', () => {
    // The one income row is dated 2026-08, the report month.
    assert.equal(v(calc, 'period_income'), 6_000_000);
    assert.equal(v(calc, 'period_collected'), 2_000_000);
    // Against a balance more than five times larger.
    assert.equal(v(calc, 'total_contractual_income'), 30_500_000);
  });

  it('separates the month’s spend from the cumulative total', () => {
    assert.equal(v(calc, 'period_expense'), 5_000_000);
    assert.equal(v(calc, 'total_expense'), 5_000_000);
  });

  it('leaves out records belonging to another month', () => {
    const data = auditDataset();
    data.income = [
      { kind: 'income', ...base, category: 'contract', description: 'July', month: '2026-07',
        contractualAmount: 9_999_999, receivedAmount: 0, accruedAmount: 9_999_999, isForecast: false },
      ...data.income,
    ];
    assert.equal(v(run(data), 'period_income'), 6_000_000, 'July income landed in the August figure');
  });

  it('leaves out forecast rows, which are not actuals', () => {
    const data = auditDataset();
    data.expense = [
      ...data.expense,
      { kind: 'expense', ...base, category: 'construction', description: 'Planned', month: '2026-08',
        amount: 7_777_777, paidAmount: 0, pendingAmount: 7_777_777, isForecast: true },
    ];
    assert.equal(v(run(data), 'period_expense'), 5_000_000, 'a forecast was counted as actual spend');
  });

  it('a monthly budget against the month reads as a percentage a person recognises', () => {
    const monthIncome = v(calc, 'period_income') ?? 0;
    const balance = v(calc, 'total_contractual_income') ?? 0;
    const budget = 5_000_000;

    assert.equal(Number(((monthIncome / budget) * 100).toFixed(1)), 120);
    // What the dial used to show.
    assert.equal(Number(((balance / budget) * 100).toFixed(1)), 610);
  });
});

/**
 * FIN-10, as fixed.
 *
 * Every receivable row has carried a due date since the first import and
 * nothing read it. The dashboard could say how much was owed and not how much
 * was late, which is the only version of the question a credit controller can
 * act on.
 */
describe('receivables ageing', () => {
  // The audit dataset's due dates against a report date of 2026-08-31:
  //   contract      20,000,000 due 2026-06-30 — 62 days late, 12,000,000 owed
  //   reservation    1,000,000 due 2026-05-31 — paid in full, does not age
  //   down payment   3,000,000 due 2026-07-31 — 31 days late,  2,000,000 owed
  //   transfer fee     500,000 due 2027-01-31 — not yet due,     500,000 owed
  const calc = run(auditDataset());
  const bucket = (label: string) => v(calc, `receivable_aged_${label}`);

  it('places each row in the bucket its due date puts it in', () => {
    assert.equal(bucket('current'), 500_000);
    assert.equal(bucket('1_30'), 0);
    assert.equal(bucket('31_60'), 2_000_000);
    assert.equal(bucket('61_90'), 12_000_000);
    assert.equal(bucket('91_120'), 0);
    assert.equal(bucket('120_plus'), 0);
  });

  /**
   * The identity an ageing report has to satisfy. A bucket set that does not
   * foot to the receivable balance is worse than no ageing at all.
   */
  it('foots to the receivable balance', () => {
    const buckets = ['current', '1_30', '31_60', '61_90', '91_120', '120_plus']
      .reduce((sum, k) => sum + (bucket(k) ?? 0), 0);

    assert.equal(buckets + (v(calc, 'receivable_undated') ?? 0), 14_500_000);
    assert.equal(v(calc, 'total_receivable_outstanding'), 14_500_000);
  });

  it('reports the overdue balance and how old the oldest is', () => {
    assert.equal(v(calc, 'receivable_overdue'), 14_000_000);
    assert.equal(v(calc, 'receivable_oldest_days'), 62);
  });

  it('does not age a row that has been collected in full', () => {
    // The reservation was paid, so it appears in no bucket.
    assert.equal(bucket('91_120'), 0);
    assert.equal(v(calc, 'receivable_undated'), 0);
  });

  it('reports what it cannot age rather than dropping it', () => {
    const data = auditDataset();
    data.receivable = data.receivable.map((r) => ({ ...r, dueDate: null }));

    const undated = run(data);
    assert.equal(undated.byKey.get('receivable_undated')?.value, 14_500_000);
    assert.equal(undated.byKey.get('receivable_overdue')?.value, 0);
    assert.equal(undated.byKey.get('receivable_oldest_days')?.value, null);
    // And it still foots.
    assert.equal(
      (undated.byKey.get('receivable_undated')?.value ?? 0),
      undated.byKey.get('total_receivable_outstanding')?.value,
    );
  });

  /**
   * Ageing is measured against the report date, not against today. Otherwise
   * the same import shows a different overdue balance every morning and no two
   * readings of an August snapshot ever agree.
   */
  it('ages against the report date, so a snapshot reads the same tomorrow', () => {
    const later = calculateMetrics(auditDataset(), '2026-12-31');
    assert.equal(later.byKey.get('receivable_oldest_days')?.value, 184);
    // The transfer fee is due 2027-01-31, so it is still not due in December.
    assert.equal(later.byKey.get('receivable_overdue')?.value, 14_000_000);
    // By December both the June instalment (184 days) and the July down
    // payment (153 days) have aged past 120.
    assert.equal(later.byKey.get('receivable_aged_120_plus')?.value, 14_000_000);

    // The August reading is unchanged by the December one existing.
    assert.equal(v(calc, 'receivable_oldest_days'), 62);
  });
});
