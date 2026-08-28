import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { indexSourceRefs } from '@/lib/calc/aggregate';
import { calculateMetrics } from '@/lib/calc/kpi';
import { KPI_DEFINITIONS } from '@/config/kpi-definitions';
import { ProjectResolver } from '@/lib/detect/project-resolver';
import { processFile } from '@/lib/import/pipeline';
import { GOLDEN_REPORT_DATE, writeGoldenWorkbook } from './fixtures/golden-workbook';
import { TEST_PROJECTS } from './helpers';

/**
 * The golden file.
 *
 * One fixed workbook goes through the whole pipeline — read, detect, map,
 * normalize, calculate — and every KPI is asserted at an exact figure that can
 * be checked by hand against the sheet. The other calc tests build datasets in
 * memory and so cannot catch a change in detection or normalization; this one
 * fails if any layer starts producing a different number, whatever the cause.
 *
 * A failure here is not automatically a bug. It means a figure moved, and
 * somebody has to say whether it was supposed to.
 */

let dir: string;
let metrics: Map<string, number | null>;
let parsed: Awaited<ReturnType<typeof processFile>>;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtg-golden-'));
  const file = writeGoldenWorkbook(path.join(dir, 'Hamonia_Report_2026-08.xlsx'));
  const bytes = fs.readFileSync(file);

  parsed = await processFile(
    {
      filePath: file,
      fileName: path.basename(file),
      size: bytes.length,
      hash: createHash('sha256').update(bytes).digest('hex'),
    },
    {
      resolver: new ProjectResolver(TEST_PROJECTS),
      templates: [],
      defaultReportDate: GOLDEN_REPORT_DATE,
    },
  );

  indexSourceRefs(parsed.data);
  // Half the project is under contract: 7,000,000 of a 14,000,000 scheme. The
  // figure is the board's and arrives from project settings, not from the
  // workbook, so the golden run supplies it the same way the app does.
  const calc = calculateMetrics(parsed.data, GOLDEN_REPORT_DATE, { totalSaleValue: 14_000_000 });
  metrics = new Map(calc.metrics.map((m) => [m.key, m.value]));
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the golden workbook', () => {
  it('is read, classified and normalized as expected', () => {
    assert.equal(parsed.status, 'parsed');
    assert.equal(parsed.error, null);
    assert.equal(parsed.project.projectId, 'p-hamonia', 'the project was not recognised');

    assert.deepEqual(
      parsed.sheets.map((s) => [s.sheetName, s.reportType, s.parsedCount]),
      [
        ['Bank Statement', 'bank_statement', 2],
        ['Receivable', 'receivable', 4],
        ['BOQ Construction', 'boq', 2],
        ['WIP', 'wip', 2],
        ['Expense', 'expense', 4],
      ],
    );

    // Every row of every sheet became a record. A drop here means the
    // normalizer started rejecting rows it used to accept.
    assert.deepEqual(
      Object.fromEntries(Object.entries(parsed.data).map(([k, v]) => [k, v.length])),
      // This workbook carries no vendor payable sheet.
      { bank: 2, receivable: 4, payable: 0, income: 0, expense: 4, boq: 2, wip: 2, cashflow: 0, gl: 0 },
    );

    assert.deepEqual(parsed.issues, [], 'the workbook should parse without issues');
  });
});

/**
 * Every figure below is worked out from the fixture by hand, so a failure says
 * which arithmetic changed rather than only that a number moved.
 */
const EXPECTED: Record<string, number | null> = {
  // Bank: 24,000,000 + 6,000,000 · pending 1,500,000 + 500,000 + 200,000 (expense)
  bank_current_amount: 30_000_000,
  pending_expense: 2_200_000,
  available_cash: 27_800_000,

  // Receivable: 1,000,000 + 5,000,000 + 2,000,000 + 500,000 contracted,
  // 400,000 + 1,000,000 + 2,000,000 + 0 received.
  total_contractual_income: 8_500_000,
  received_income: 3_400_000,
  accrued_income: 5_100_000,
  reservation_outstanding: 600_000,
  contract_outstanding: 4_000_000,
  down_payment_outstanding: 0,
  transfer_outstanding: 500_000,
  total_receivable_outstanding: 5_100_000,

  // Ageing. This workbook's receivable sheet carries no due-date column, so
  // nothing can be aged and every bucket is empty — the whole 5,100,000 is
  // reported as undated rather than quietly placed in Current, which would
  // read as a balance that is not yet due when nobody knows whether it is.
  receivable_aged_current: 0,
  receivable_aged_1_30: 0,
  receivable_aged_31_60: 0,
  receivable_aged_61_90: 0,
  receivable_aged_91_120: 0,
  receivable_aged_120_plus: 0,
  receivable_overdue: 0,
  receivable_undated: 5_100_000,
  receivable_oldest_days: null,

  // BOQ: 40M + 20M contracted, 30M + 8M certified, 25M + 6M paid.
  boq_total: 60_000_000,
  boq_to_date: 38_000_000,
  boq_paid: 31_000_000,
  boq_outstanding: 7_000_000,
  remaining_boq: 29_000_000,
  wip_ytd: 12_000_000,
  advance_outstanding: 2_500_000,

  // Expense: 25,000,000 construction + 1,200,000 marketing + 2,400,000 salary
  // + 600,000 tax.
  total_expense: 29_200_000,
  // The report month is August. The construction and marketing rows are dated
  // July and belong to July, however large they are — that is the whole point
  // of a period figure. Salaries and corporate tax are August's.
  period_expense: 3_000_000,
  // No income row in this workbook carries a month, so August's income figure
  // is nothing. Not the 8,500,000 balance, which is every sale ever made.
  period_income: 0,
  period_collected: 0,
  // Not the 25,000,000 of construction spend: the certified work attributable
  // to the units actually sold. The rest is inventory.
  cost_of_goods_sold: 19_000_000,
  taxes: 600_000,
  // Total less construction: 1.2M + 2.4M + 0.6M.
  other_expense: 4_200_000,
  // Total less construction less tax — tax is deducted once, at the bottom.
  operating_expenses: 3_600_000,

  // Revenue is recognised, not booked. The order book is the instalment and
  // down-payment rows only — 5,000,000 + 2,000,000 — because a reservation fee
  // and a transfer fee are consideration for something other than the unit.
  contracted_sale_value: 7_000_000,
  // 38,000,000 certified of a 60,000,000 construction contract.
  completion_percent: 63.33,
  // 7,000,000 × 38/60.
  recognised_revenue: 4_433_333.33,
  revenue_backlog: 2_566_666.67,

  // Income statement: 4.43M earned, 19M cost of sales (38M certified × 50% of
  // the project sold), 3.6M operating, 0.6M tax. An early-stage development
  // building far ahead of its sales, which is what this workbook describes.
  gross_profit: -14_566_666.67,
  operating_profit: -18_166_666.67,
  net_profit: -18_766_666.67,
  net_profit_margin: -423.31,

  // Position: 7M certified-unpaid + 2.2M pending.
  total_outstanding_expense: 9_200_000,

  // Accounts payable. No vendor sheet in this workbook, so nothing is owed to
  // a vendor and the whole obligation is construction and pending payments.
  payable_invoiced: 0,
  payable_paid: 0,
  accounts_payable: 0,
  payable_overdue: 0,
  payable_undated: 0,
  payable_aged_current: 0,
  payable_aged_1_30: 0,
  payable_aged_31_60: 0,
  payable_aged_61_90: 0,
  payable_aged_91_120: 0,
  payable_aged_120_plus: 0,
  total_owed: 9_200_000,
  // 27.8M cash + 5.1M receivable − 9.2M owed.
  net_financial_position: 23_700_000,

  // Balance sheet: 30.0M bank + 5.1M receivable + 2.5M advances + 12.0M WIP
  // against 0 payable + 7.0M certified unpaid + 2.2M pending.
  current_assets: 49_600_000,
  current_liabilities: 9_200_000,
  working_capital: 40_400_000,

  // Liquidity, the balance sheet divided. Bank rather than Available Cash:
  // pending sits in liabilities and is not netted off cash as well.
  quick_ratio: 3.82, //            (30.0 + 5.1) / 9.2
  current_ratio: 5.39, //          49.6 / 9.2

  // Cash flow for the report month. Salaries and corporate tax are August's,
  // and both were paid; nothing in this workbook is land or capital; and no
  // loan or dividend record exists, so financing is unknown rather than zero.
  operating_cash_flow: -3_000_000,
  investing_cash_flow: 0,
  financing_cash_flow: null,

  // Cash: no forecast rows in this workbook, so the projection holds flat.
  current_cash: 27_800_000,
  forecast_cash: 27_800_000,
  lowest_forecast_cash: 27_800_000,
  cash_shortfall: 0,
  required_funding: 0,
  expected_future_income: 5_100_000,
  total_future_expense: 31_200_000,

  gl_entry_count: 0,
};

describe('every KPI, at an exact figure', () => {
  for (const [key, expected] of Object.entries(EXPECTED)) {
    it(`${key} is ${expected}`, () => {
      assert.equal(metrics.get(key), expected);
    });
  }

  it('covers every KPI the engine produces', () => {
    // Otherwise a new metric could ship with no golden figure at all, and the
    // suite would go on passing while nothing checked it.
    const missing = [...metrics.keys()].filter((k) => !(k in EXPECTED));
    assert.deepEqual(missing, [], 'these KPIs have no expected figure');
  });

  it('reconciles: net profit equals revenue earned less every cost charged', () => {
    const revenue = metrics.get('recognised_revenue') ?? 0;
    const cost = metrics.get('cost_of_goods_sold') ?? 0;
    const opex = metrics.get('operating_expenses') ?? 0;
    const tax = metrics.get('taxes') ?? 0;

    assert.equal(metrics.get('net_profit'), Math.round((revenue - cost - opex - tax) * 100) / 100);
  });

  it('the order book is what is signed, and revenue is what is earned', () => {
    const book = metrics.get('contracted_sale_value') ?? 0;
    const earned = metrics.get('recognised_revenue') ?? 0;
    const backlog = metrics.get('revenue_backlog') ?? 0;

    assert.ok(earned < book, 'a part-built project cannot have earned its whole order book');
    assert.equal(Math.round((earned + backlog) * 100) / 100, book);
  });
});

describe('KPI definitions', () => {
  it('exist for every KPI, and describe nothing that is not one', () => {
    const produced = new Set(metrics.keys());
    const defined = new Set(Object.keys(KPI_DEFINITIONS));

    assert.deepEqual(
      [...produced].filter((k) => !defined.has(k)),
      [],
      'these KPIs have no definition',
    );
    assert.deepEqual(
      [...defined].filter((k) => !produced.has(k)),
      [],
      'these definitions name no KPI',
    );
  });

  it('say where each figure is read from', () => {
    for (const [key, definition] of Object.entries(KPI_DEFINITIONS)) {
      assert.ok(definition.meaning.length > 20, `${key} has no meaningful definition`);
      assert.ok(definition.readsFrom.length > 20, `${key} does not say where it is read from`);
    }
  });
});
