import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { indexSourceRefs } from '@/lib/calc/aggregate';
import { projectCashflow } from '@/lib/calc/cashflow';
import { calculateMetrics } from '@/lib/calc/kpi';
import { compareMetrics, percentChange, sentimentOf } from '@/lib/compare';
import { parseDateText, parseNumeric, normalizeYear, endOfMonth } from '@/lib/excel/cells';
import { formatTHB, formatDelta, formatPercent, formatCompactTHB } from '@/lib/format/number';
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
