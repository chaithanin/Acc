import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { indexSourceRefs } from '@/lib/calc/aggregate';
import { projectCashflow } from '@/lib/calc/cashflow';
import { calculateMetrics } from '@/lib/calc/kpi';
import { compareMetrics, percentChange, sentimentOf } from '@/lib/compare';
import { parseDateText, parseNumeric, normalizeYear, endOfMonth } from '@/lib/excel/cells';
import { formatTHB, formatDelta, formatPercent, formatCompactTHB, formatByUnit } from '@/lib/format/number';
import { utilisation } from '@/lib/db/repositories/budgets';
import { runValidations } from '@/lib/validate/rules';
import { emptyDataset, type NormalizedDataset, type SourceRef } from '@/lib/types';

const REPORT_DATE = '2026-08-31';
const REF: SourceRef = { file: 'test.xlsx', sheet: 'Sheet1', row: 2, col: 3, cell: 'C2' };

function dataset(partial: Partial<NormalizedDataset>): NormalizedDataset {
  const data = { ...emptyDataset(), ...partial };
  indexSourceRefs(data);
  return data;
}

describe('cell value parsing', () => {
  it('reads plain numbers', () => {
    assert.equal(parseNumeric({ v: 1234.5, t: 'n' }).value, 1234.5);
  });

  it('reads currency and thousands separators', () => {
    assert.equal(parseNumeric({ v: '฿1,234,567.89', t: 's' }).value, 1234567.89);
    assert.equal(parseNumeric({ v: '1 234 567', t: 's' }).value, 1234567);
  });

  it('treats accounting parentheses as negative', () => {
    assert.equal(parseNumeric({ v: '(12,500.00)', t: 's' }).value, -12500);
  });

  it('reports text in a numeric field instead of returning NaN', () => {
    const parsed = parseNumeric({ v: 'n/a', t: 's' });
    assert.equal(parsed.value, null);
    assert.equal(parsed.issue, 'text-in-numeric');
  });

  it('reports an Excel error value', () => {
    const parsed = parseNumeric({ v: '#DIV/0!', t: 'e' });
    assert.equal(parsed.value, null);
    assert.equal(parsed.issue, 'formula-error');
  });

  it('treats a dash as blank, not as zero', () => {
    assert.equal(parseNumeric({ v: '-', t: 's' }).issue, 'blank');
  });
});

describe('date parsing', () => {
  it('reads ISO and day/month/year forms', () => {
    assert.equal(parseDateText('2026-08-31'), '2026-08-31');
    assert.equal(parseDateText('31/08/2026'), '2026-08-31');
  });

  it('converts Thai Buddhist-era years', () => {
    assert.equal(normalizeYear(2569), 2026);
    assert.equal(parseDateText('31/08/2569'), '2026-08-31');
  });

  it('reads Thai month abbreviations', () => {
    assert.equal(parseDateText('ส.ค. 2569'), '2026-08-01');
  });

  it('computes month end', () => {
    assert.equal(endOfMonth('2026-02-10'), '2026-02-28');
    assert.equal(endOfMonth('2028-02-10'), '2028-02-29');
  });
});

describe('bank and cash KPIs', () => {
  it('computes available cash as bank minus pending', () => {
    const data = dataset({
      bank: [
        {
          kind: 'bank', sourceRef: REF, projectId: 'p1', projectLabel: 'P1',
          bankName: 'SCB', accountNo: null, currentAmount: 8_000_000, pendingExpense: 3_000_000,
        },
      ],
    });

    const { byKey } = calculateMetrics(data, REPORT_DATE);
    assert.equal(byKey.get('bank_current_amount')?.value, 8_000_000);
    assert.equal(byKey.get('pending_expense')?.value, 3_000_000);
    assert.equal(byKey.get('available_cash')?.value, 5_000_000);
  });

  it('exposes the formula and inputs behind every metric', () => {
    const data = dataset({
      bank: [{
        kind: 'bank', sourceRef: REF, projectId: null, projectLabel: null,
        bankName: null, accountNo: null, currentAmount: 8_000_000, pendingExpense: 3_000_000,
      }],
    });

    const metric = calculateMetrics(data, REPORT_DATE).byKey.get('available_cash')!;
    assert.equal(metric.formula, 'Bank Current Amount − Pending Expense');
    assert.deepEqual(metric.inputs.map((i) => i.value), [8_000_000, 3_000_000]);
    assert.ok(metric.sourceRefIndexes.length > 0, 'the metric should cite its source cells');
  });
});

describe('receivable KPIs', () => {
  const data = dataset({
    receivable: [
      { kind: 'receivable', sourceRef: REF, projectId: 'p1', projectLabel: null,
        category: 'reservation', customer: 'A', unit: '101',
        contractualAmount: 1_000_000, receiveAmount: 400_000, accrueAmount: 600_000, dueDate: null },
      { kind: 'receivable', sourceRef: REF, projectId: 'p1', projectLabel: null,
        category: 'contract', customer: 'B', unit: '102',
        contractualAmount: 5_000_000, receiveAmount: 1_000_000, accrueAmount: 4_000_000, dueDate: null },
      { kind: 'receivable', sourceRef: REF, projectId: 'p1', projectLabel: null,
        category: 'down_payment', customer: 'C', unit: '103',
        contractualAmount: 2_000_000, receiveAmount: 2_000_000, accrueAmount: 0, dueDate: null },
      { kind: 'receivable', sourceRef: REF, projectId: 'p1', projectLabel: null,
        category: 'transfer_fee', customer: 'D', unit: '104',
        contractualAmount: 500_000, receiveAmount: 0, accrueAmount: 500_000, dueDate: null },
    ],
  });

  const { byKey } = calculateMetrics(data, REPORT_DATE);

  it('sums contractual and received across categories', () => {
    assert.equal(byKey.get('total_contractual_income')?.value, 8_500_000);
    assert.equal(byKey.get('received_income')?.value, 3_400_000);
  });

  it('derives accrued income rather than reading it from the sheet', () => {
    assert.equal(byKey.get('accrued_income')?.value, 5_100_000);
  });

  it('breaks outstanding down by category', () => {
    assert.equal(byKey.get('reservation_outstanding')?.value, 600_000);
    assert.equal(byKey.get('contract_outstanding')?.value, 4_000_000);
    assert.equal(byKey.get('down_payment_outstanding')?.value, 0);
    assert.equal(byKey.get('transfer_outstanding')?.value, 500_000);
  });
});

describe('BOQ KPIs', () => {
  const data = dataset({
    boq: [
      { kind: 'boq', sourceRef: REF, projectId: 'p1', projectLabel: null,
        accountCode: null, description: 'Structure', contractor: 'ACME', costCategory: 'construction',
        month: '2026-08', boqAmount: 100_000_000, boqToDate: 60_000_000,
        paidAmount: 45_000_000, pendingAmount: 15_000_000 },
    ],
  });

  const { byKey } = calculateMetrics(data, REPORT_DATE);

  it('computes outstanding as work-to-date minus paid', () => {
    assert.equal(byKey.get('boq_outstanding')?.value, 15_000_000);
  });

  it('computes remaining BOQ as total minus paid', () => {
    assert.equal(byKey.get('remaining_boq')?.value, 55_000_000);
  });
});

describe('cash flow projection', () => {
  it('carries the running balance forward month by month', () => {
    const data = dataset({
      cashflow: [
        { kind: 'cashflow', sourceRef: REF, projectId: null, projectLabel: null, month: '2026-09',
          openingBalance: null, expectedIncome: 10_000_000, expectedExpense: 4_000_000,
          netCashflow: null, closingBalance: null, isComputed: false },
        { kind: 'cashflow', sourceRef: REF, projectId: null, projectLabel: null, month: '2026-10',
          openingBalance: null, expectedIncome: 2_000_000, expectedExpense: 5_000_000,
          netCashflow: null, closingBalance: null, isComputed: false },
        { kind: 'cashflow', sourceRef: REF, projectId: null, projectLabel: null, month: '2026-11',
          openingBalance: null, expectedIncome: 1_000_000, expectedExpense: 9_000_000,
          netCashflow: null, closingBalance: null, isComputed: false },
      ],
    });

    const projection = projectCashflow(data, 5_000_000, REPORT_DATE);

    assert.deepEqual(
      projection.months.map((m) => [m.month, m.openingCash, m.netCashFlow, m.closingCash]),
      [
        ['2026-09', 5_000_000, 6_000_000, 11_000_000],
        ['2026-10', 11_000_000, -3_000_000, 8_000_000],
        ['2026-11', 8_000_000, -8_000_000, 0],
      ],
    );
  });

  it('flags a shortfall and sizes the funding needed', () => {
    const data = dataset({
      cashflow: [
        { kind: 'cashflow', sourceRef: REF, projectId: null, projectLabel: null, month: '2026-09',
          openingBalance: null, expectedIncome: 0, expectedExpense: 8_000_000,
          netCashflow: null, closingBalance: null, isComputed: false },
        { kind: 'cashflow', sourceRef: REF, projectId: null, projectLabel: null, month: '2026-10',
          openingBalance: null, expectedIncome: 12_000_000, expectedExpense: 0,
          netCashflow: null, closingBalance: null, isComputed: false },
      ],
    });

    const projection = projectCashflow(data, 5_000_000, REPORT_DATE);

    assert.equal(projection.hasShortfall, true);
    assert.equal(projection.lowestCash, -3_000_000);
    assert.equal(projection.lowestMonth, '2026-09');
    assert.equal(projection.requiredFunding, 3_000_000);
    // The trough is what matters, not the final month, which recovers.
    assert.equal(projection.forecastCash, 9_000_000);
  });

  it('derives a forecast from dated records when no forecast sheet exists', () => {
    const data = dataset({
      expense: [
        { kind: 'expense', sourceRef: REF, projectId: null, projectLabel: null,
          category: 'construction', description: 'Phase 2', month: '2026-09',
          amount: 3_000_000, paidAmount: 0, pendingAmount: 3_000_000, isForecast: true },
      ],
    });

    const projection = projectCashflow(data, 1_000_000, REPORT_DATE);
    assert.equal(projection.months.length, 1);
    assert.equal(projection.months[0].closingCash, -2_000_000);
    assert.equal(projection.requiredFunding, 2_000_000);
  });
});

describe('income statement and liquidity', () => {
  const data = dataset({
    receivable: [
      { kind: 'receivable', sourceRef: REF, projectId: null, projectLabel: null,
        category: 'contract', customer: 'A', unit: null,
        contractualAmount: 10_000_000, receiveAmount: 6_000_000, accrueAmount: 4_000_000, dueDate: null },
    ],
    expense: [
      { kind: 'expense', sourceRef: REF, projectId: null, projectLabel: null,
        category: 'construction', description: 'Structure', month: '2026-08',
        amount: 4_000_000, paidAmount: 4_000_000, pendingAmount: 0, isForecast: false },
      { kind: 'expense', sourceRef: REF, projectId: null, projectLabel: null,
        category: 'marketing', description: 'Launch', month: '2026-08',
        amount: 1_000_000, paidAmount: 1_000_000, pendingAmount: 0, isForecast: false },
      { kind: 'expense', sourceRef: REF, projectId: null, projectLabel: null,
        category: 'tax', description: 'SBT', month: '2026-08',
        amount: 500_000, paidAmount: 0, pendingAmount: 500_000, isForecast: false },
    ],
    bank: [
      { kind: 'bank', sourceRef: REF, projectId: null, projectLabel: null,
        bankName: 'SCB', accountNo: null, currentAmount: 3_000_000, pendingExpense: 0 },
    ],
  });

  const { byKey } = calculateMetrics(data, REPORT_DATE);

  it('excludes tax from operating expenses so it is deducted only once', () => {
    // 5.5M total expense − 4M direct cost − 0.5M tax
    assert.equal(byKey.get('operating_expenses')?.value, 1_000_000);
    assert.equal(byKey.get('taxes')?.value, 500_000);
  });

  /**
   * With no construction contract there is nothing to measure completion
   * against, so revenue cannot be recognised. Saying so is the whole point:
   * the alternative is to treat the order book as earned, which is where the
   * 83% margin came from.
   */
  it('will not recognise revenue with no BOQ to measure completion against', () => {
    assert.equal(byKey.get('completion_percent')?.value, null);
    assert.equal(byKey.get('recognised_revenue')?.value, null);
    assert.equal(byKey.get('gross_profit')?.value, null);
    assert.equal(byKey.get('net_profit_margin')?.value, null);
    assert.match(byKey.get('recognised_revenue')!.formula, /Not calculable/);
  });

  it('still shows the order book, which is a real figure', () => {
    assert.equal(byKey.get('contracted_sale_value')?.value, 10_000_000);
  });

  it('computes the liquidity ratios against payables', () => {
    // The unpaid tax is pending, so it both reduces available cash and forms
    // the payable: cash 3.0M − 0.5M = 2.5M; payables = 0.5M.
    assert.equal(byKey.get('available_cash')?.value, 2_500_000);
    assert.equal(byKey.get('total_outstanding_expense')?.value, 500_000);
    // Quick = (2.5M available + 4.0M receivable outstanding) ÷ 0.5M
    assert.equal(byKey.get('quick_ratio')?.value, 13);
    assert.equal(byKey.get('quick_ratio')?.unit, 'RATIO');
  });

  it('reports a ratio as not calculable rather than dividing by zero', () => {
    const noPayables = dataset({
      bank: [{ kind: 'bank', sourceRef: REF, projectId: null, projectLabel: null,
        bankName: null, accountNo: null, currentAmount: 1_000_000, pendingExpense: 0 }],
    });
    const result = calculateMetrics(noPayables, REPORT_DATE);
    assert.equal(result.byKey.get('quick_ratio')?.value, null);
    assert.equal(result.byKey.get('current_ratio')?.value, null);
  });

  it('reports a margin as not calculable when there is no income', () => {
    const noIncome = dataset({
      expense: [{ kind: 'expense', sourceRef: REF, projectId: null, projectLabel: null,
        category: 'marketing', description: null, month: null,
        amount: 1_000, paidAmount: 1_000, pendingAmount: 0, isForecast: false }],
    });
    assert.equal(calculateMetrics(noIncome, REPORT_DATE).byKey.get('net_profit_margin')?.value, null);
  });
});

/**
 * The same statement, with the two things recognition needs: a construction
 * contract to measure completion against, and the project's total sale value
 * to separate the cost of sold units from inventory.
 */
describe('income statement on a recognition basis', () => {
  const data = dataset({
    receivable: [
      { kind: 'receivable', sourceRef: REF, projectId: null, projectLabel: null,
        category: 'contract', customer: 'A', unit: null,
        contractualAmount: 10_000_000, receiveAmount: 6_000_000, accrueAmount: 4_000_000, dueDate: null },
    ],
    boq: [
      { kind: 'boq', sourceRef: REF, projectId: null, projectLabel: null,
        accountCode: '5100', description: 'Structure', contractor: null,
        costCategory: 'construction', month: '2026-08',
        boqAmount: 20_000_000, boqToDate: 5_000_000, paidAmount: 4_000_000, pendingAmount: 1_000_000 },
    ],
    expense: [
      { kind: 'expense', sourceRef: REF, projectId: null, projectLabel: null,
        category: 'construction', description: 'Structure', month: '2026-08',
        amount: 4_000_000, paidAmount: 4_000_000, pendingAmount: 0, isForecast: false },
      { kind: 'expense', sourceRef: REF, projectId: null, projectLabel: null,
        category: 'marketing', description: 'Launch', month: '2026-08',
        amount: 1_000_000, paidAmount: 1_000_000, pendingAmount: 0, isForecast: false },
      { kind: 'expense', sourceRef: REF, projectId: null, projectLabel: null,
        category: 'tax', description: 'SBT', month: '2026-08',
        amount: 500_000, paidAmount: 500_000, pendingAmount: 0, isForecast: false },
    ],
  });

  // A quarter built, and 10M of a 25M project under contract.
  const { byKey } = calculateMetrics(data, REPORT_DATE, { totalSaleValue: 25_000_000 });

  it('measures completion from the construction contract', () => {
    assert.equal(byKey.get('completion_percent')?.value, 25);
  });

  it('recognises a quarter of the order book', () => {
    assert.equal(byKey.get('recognised_revenue')?.value, 2_500_000);
    assert.equal(byKey.get('revenue_backlog')?.value, 7_500_000);
  });

  it('charges only the sold units’ share of certified construction', () => {
    // 5,000,000 certified × 40% of the project sold.
    assert.equal(byKey.get('cost_of_goods_sold')?.value, 2_000_000);
  });

  it('chains the statement from recognised revenue', () => {
    assert.equal(byKey.get('gross_profit')?.value, 500_000);
    assert.equal(byKey.get('operating_profit')?.value, -500_000);
    assert.equal(byKey.get('net_profit')?.value, -1_000_000);
  });

  it('shows an early-stage development running at a loss, which it is', () => {
    assert.equal(byKey.get('net_profit_margin')?.value, -40);
  });
});

describe('budget utilisation', () => {
  it('returns no percentage when no budget has been entered', () => {
    const result = utilisation(null, 500);
    assert.equal(result.percent, null);
    assert.equal(result.balance, null);
  });

  it('computes utilisation and the remaining balance', () => {
    const result = utilisation(5000, 4719);
    assert.equal(result.percent, 94.4);
    assert.equal(result.balance, 281);
  });

  it('reports an overspend as a negative balance', () => {
    assert.equal(utilisation(3500, 3730).balance, -230);
  });

  it('avoids dividing by a zero budget', () => {
    assert.equal(utilisation(0, 100).percent, null);
  });
});

describe('unit-aware formatting', () => {
  it('formats each metric according to its own unit', () => {
    assert.equal(formatByUnit(13.3, 'PERCENT'), '13.3%');
    assert.equal(formatByUnit(1.42, 'RATIO'), '1.42×');
    assert.equal(formatByUnit(null, 'RATIO'), 'N/A');
    assert.equal(formatByUnit(537, 'COUNT'), '537');
    assert.equal(formatByUnit(4_719_000, 'THB'), '฿4.72M');
  });
});

describe('snapshot comparison', () => {
  it('computes difference and percentage change', () => {
    assert.equal(percentChange(337_610_000, 320_500_000), 5.34);
    assert.equal(percentChange(90, 100), -10);
  });

  it('returns N/A rather than dividing by zero', () => {
    assert.equal(percentChange(100, 0), null);
    assert.equal(formatPercent(percentChange(100, 0)), 'N/A');
  });

  it('handles a negative previous value by using its magnitude', () => {
    assert.equal(percentChange(-50, -100), 50);
  });

  it('pairs metrics by key and marks missing baselines', () => {
    const current = calculateMetrics(
      dataset({
        bank: [{ kind: 'bank', sourceRef: REF, projectId: null, projectLabel: null,
          bankName: null, accountNo: null, currentAmount: 100, pendingExpense: 0 }],
      }),
      REPORT_DATE,
    ).metrics;

    const comparisons = compareMetrics(current, null);
    const bank = comparisons.find((c) => c.key === 'bank_current_amount')!;
    assert.equal(bank.previous, null);
    assert.equal(bank.difference, null);
    assert.equal(bank.differencePct, null);
  });

  it('knows which direction is an improvement', () => {
    assert.equal(sentimentOf('available_cash', 1000), 'positive');
    assert.equal(sentimentOf('pending_expense', 1000), 'negative');
    assert.equal(sentimentOf('required_funding', -1000), 'positive');
    assert.equal(sentimentOf('boq_total', 1000), 'neutral');
  });
});

describe('reconciliation rules', () => {
  it('passes when the sheet arithmetic is self-consistent', () => {
    const data = dataset({
      receivable: [{ kind: 'receivable', sourceRef: REF, projectId: null, projectLabel: null,
        category: 'contract', customer: 'A', unit: null,
        contractualAmount: 1_000_000, receiveAmount: 400_000, accrueAmount: 600_000, dueDate: null }],
    });

    const calc = calculateMetrics(data, REPORT_DATE);
    const result = runValidations(data, calc, null).find((r) => r.ruleKey === 'receivable_row_identity')!;
    assert.equal(result.status, 'pass');
  });

  it('reports a row whose stated accrued amount disagrees', () => {
    const data = dataset({
      receivable: [{ kind: 'receivable', sourceRef: REF, projectId: null, projectLabel: null,
        category: 'contract', customer: 'A', unit: null,
        contractualAmount: 1_000_000, receiveAmount: 400_000, accrueAmount: 550_000, dueDate: null }],
    });

    const calc = calculateMetrics(data, REPORT_DATE);
    const result = runValidations(data, calc, null).find((r) => r.ruleKey === 'receivable_row_identity')!;

    assert.notEqual(result.status, 'pass');
    assert.equal(result.expected, 600_000);
    assert.equal(result.imported, 550_000);
    assert.equal(result.difference, 50_000);
  });

  it('skips a rule instead of failing it when there is no data', () => {
    const data = dataset({});
    const calc = calculateMetrics(data, REPORT_DATE);
    const results = runValidations(data, calc, null);
    assert.ok(results.every((r) => r.status === 'skipped' || r.status === 'pass'));
  });
});

describe('THB formatting', () => {
  it('formats full, thousand and million scales', () => {
    assert.equal(formatTHB(12_450_000), '฿12,450,000.00');
    assert.equal(formatTHB(337_612_266, 'millions'), '฿337.61M');
    assert.equal(formatTHB(12_450, 'thousands'), '฿12.5K');
  });

  it('wraps negatives in accounting parentheses', () => {
    assert.equal(formatTHB(-12_500_000, 'millions'), '(฿12.50M)');
  });

  it('renders no-data as a dash, not as zero', () => {
    assert.equal(formatTHB(null), '—');
    assert.equal(formatCompactTHB(undefined), '—');
  });

  it('signs deltas explicitly', () => {
    assert.equal(formatDelta(17_110_000), '+฿17.11M');
    assert.equal(formatDelta(-2_400_000), '(฿2.40M)');
    assert.equal(formatPercent(5.34), '+5.34%');
  });
});
