import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calculateMetrics } from '@/lib/calc/kpi';
import { indexSourceRefs } from '@/lib/calc/aggregate';
import { runValidations } from '@/lib/validate/rules';
import { ProjectResolver } from '@/lib/detect/project-resolver';
import { classifySheet } from '@/lib/detect/sheet-classifier';
import { normalizeSheet } from '@/lib/normalize';
import type { NormalizeContext } from '@/lib/normalize/context';
import type { RawSheet } from '@/lib/excel/types';
import type { ImportIssue } from '@/lib/types';
import { errorCell, formulaCell, makeSheet, TEST_PROJECTS } from './helpers';

const resolver = new ProjectResolver(TEST_PROJECTS);
const REPORT_DATE = '2026-08-31';

/** Runs the real detect → normalize path over a sheet, as an import would. */
function run(sheet: RawSheet, projectId: string | null = 'p-hamonia') {
  const issues: ImportIssue[] = [];
  const detection = classifySheet(sheet);

  const ctx: NormalizeContext = {
    fileName: 'test.xlsx',
    sheet,
    detection,
    resolver,
    defaultProjectId: projectId,
    defaultProjectLabel: 'Hamonia',
    reportDate: REPORT_DATE,
    addIssue: (issue) => issues.push(issue),
  };

  const data = normalizeSheet(ctx);
  indexSourceRefs(data);
  return { data, issues, detection };
}

describe('receivable normalization', () => {
  it('extracts one record per row with its source cell', () => {
    const sheet = makeSheet('Summary', [
      ['Hamonia Customer Receivable Report'],
      [],
      ['Customer', 'Unit', 'Type', 'Contractual Amount', 'Receive Amount', 'Accrue Amount'],
      ['Somchai', '101', 'Reservation', 1_000_000, 400_000, 600_000],
      ['Suda', '102', 'Down Payment', 2_000_000, 2_000_000, 0],
      ['Total', '', '', 3_000_000, 2_400_000, 600_000],
    ]);

    const { data } = run(sheet);

    // The Total row must not be imported, or every figure would double.
    assert.equal(data.receivable.length, 2);

    const first = data.receivable[0];
    assert.equal(first.customer, 'Somchai');
    assert.equal(first.category, 'reservation');
    assert.equal(first.contractualAmount, 1_000_000);
    assert.equal(first.receiveAmount, 400_000);
    assert.equal(first.sourceRef.sheet, 'Summary');
    assert.equal(first.sourceRef.row, 4, 'row number should match the Excel UI');
    assert.equal(first.sourceRef.cell, 'D4');
  });

  it('reads a Thai-headed sheet identically', () => {
    const sheet = makeSheet('VTR ค้างรับ', [
      ['ชื่อลูกค้า', 'ประเภท', 'ยอดตามสัญญา', 'รับแล้ว', 'ค้างรับ'],
      ['สมชาย', 'เงินจอง', 1_000_000, 400_000, 600_000],
      ['สุดา', 'เงินดาวน์', 2_000_000, 500_000, 1_500_000],
    ]);

    const { data } = run(sheet);
    assert.equal(data.receivable.length, 2);
    assert.equal(data.receivable[0].category, 'reservation');
    assert.equal(data.receivable[1].category, 'down_payment');
    assert.equal(data.receivable[1].contractualAmount, 2_000_000);
  });

  it('keeps importing after a bad cell and records a warning', () => {
    const sheet = makeSheet('Summary', [
      ['Customer', 'Contractual Amount', 'Receive Amount'],
      ['Somchai', 1_000_000, 400_000],
      ['Suda', 'pending confirmation', 500_000],
      ['Anan', 3_000_000, 1_000_000],
    ]);

    const { data, issues } = run(sheet);

    assert.equal(data.receivable.length, 3, 'every row should still be imported');
    assert.equal(data.receivable[1].contractualAmount, 0);

    const warning = issues.find((i) => i.code === 'TEXT_IN_NUMERIC');
    assert.ok(warning, 'the bad cell should raise a warning');
    assert.equal(warning?.source.cell, 'B3');
  });

  it('reports an Excel error value without failing the sheet', () => {
    const sheet = makeSheet('Summary', [
      ['Customer', 'Contractual Amount', 'Receive Amount'],
      ['Somchai', errorCell('#DIV/0!'), 400_000],
      ['Suda', 2_000_000, 500_000],
    ]);

    const { data, issues } = run(sheet);
    assert.equal(data.receivable.length, 2);
    assert.ok(issues.some((i) => i.code === 'FORMULA_ERROR'));
  });

  it('warns about a formula that points at another workbook', () => {
    const sheet = makeSheet('Summary', [
      ['Customer', 'Contractual Amount', 'Receive Amount'],
      ['Somchai', formulaCell(1_000_000, "'[Other.xlsx]Data'!A1"), 400_000],
    ]);

    const { issues } = run(sheet);
    assert.ok(issues.some((i) => i.code === 'EXTERNAL_REFERENCE'));
  });

  it('flags a duplicated row instead of silently double counting', () => {
    const sheet = makeSheet('Summary', [
      ['Customer', 'Unit', 'Contractual Amount', 'Receive Amount'],
      ['Somchai', '101', 1_000_000, 400_000],
      ['Somchai', '101', 1_000_000, 400_000],
    ]);

    const { issues } = run(sheet);
    assert.ok(issues.some((i) => i.code === 'DUPLICATE_ROW'));
  });
});

describe('bank normalization', () => {
  it('reads a per-account table', () => {
    const sheet = makeSheet('Bank Statement', [
      ['Bank', 'Account No', 'Bank Current Amount', 'Pending Expense'],
      ['SCB', '111-1', 5_000_000, 1_000_000],
      ['KBank', '222-2', 3_000_000, 2_000_000],
    ]);

    const { data } = run(sheet);
    assert.equal(data.bank.length, 2);

    const { byKey } = calculateMetrics(data, REPORT_DATE);
    assert.equal(byKey.get('available_cash')?.value, 5_000_000);
  });

  it('reads a labelled summary layout with no table at all', () => {
    const sheet = makeSheet('FINANCIAL REPORT', [
      ['FINANCIAL REPORT'],
      ['As of', '31/08/2026'],
      [],
      ['Bank Current Amount', 8_000_000],
      ['Pending Expense', 3_000_000],
    ]);

    const { data } = run(sheet);
    assert.equal(data.bank.length, 1);
    assert.equal(data.bank[0].currentAmount, 8_000_000);
    assert.equal(data.bank[0].pendingExpense, 3_000_000);
    // The label/value pass must still point at the value cell, not the label.
    assert.equal(data.bank[0].sourceRef.cell, 'B4');
  });
});

describe('WIP normalization', () => {
  it('reads account rows', () => {
    const sheet = makeSheet('WIP Sun09', [
      ['Account Code', 'Account Name', 'Current Period', 'YTD', 'Advance Payment'],
      ['1010', 'Land', 0, 50_000_000, 0],
      ['1020', 'Construction', 2_000_000, 30_000_000, 1_000_000],
      ['', 'Total', 2_000_000, 80_000_000, 1_000_000],
    ]);

    const { data } = run(sheet);
    assert.equal(data.wip.length, 2);
    assert.equal(data.wip[1].accountName, 'Construction');
    assert.equal(data.wip[1].ytd, 30_000_000);
  });
});

describe('BOQ normalization', () => {
  it('reads an item table and derives outstanding', () => {
    const sheet = makeSheet('BOQ Hamonia', [
      ['Description', 'Contractor', 'BOQ', 'BOQ To Date', 'Paid'],
      ['Structure', 'ACME', 100_000_000, 60_000_000, 45_000_000],
    ]);

    const { data } = run(sheet);
    assert.equal(data.boq.length, 1);
    assert.equal(data.boq[0].pendingAmount, 15_000_000);

    const { byKey } = calculateMetrics(data, REPORT_DATE);
    assert.equal(byKey.get('boq_outstanding')?.value, 15_000_000);
    assert.equal(byKey.get('remaining_boq')?.value, 55_000_000);
  });

  it('expands a month-per-column matrix into one record per month', () => {
    const sheet = makeSheet('Hamonia คชจ แต่ละเดือน', [
      ['Description', 'Contractor', 'Sep 2026', 'Oct 2026', 'Nov 2026'],
      ['Structure', 'ACME', 3_000_000, 4_000_000, 0],
    ]);

    const { data } = run(sheet);
    const months = data.boq.map((b) => b.month);

    assert.deepEqual(months, ['2026-09', '2026-10']);
    assert.equal(data.boq[0].boqAmount, 3_000_000);
    // Each month cell keeps its own address, so the figure drills back exactly.
    assert.equal(data.boq[0].sourceRef.cell, 'C2');
    assert.equal(data.boq[1].sourceRef.cell, 'D2');
  });
});

describe('cash flow normalization', () => {
  it('reads monthly forecast inputs and ignores the stated running balance', () => {
    const sheet = makeSheet('Cash Flow Forecast', [
      ['Month', 'Expected Income', 'Expected Expense', 'Closing'],
      ['Sep 2026', 10_000_000, 4_000_000, 999],
      ['Oct 2026', 2_000_000, 5_000_000, 888],
    ]);

    const { data } = run(sheet);
    assert.equal(data.cashflow.length, 2);

    const { projection } = calculateMetrics(data, REPORT_DATE);
    // Our own running balance is used, not the sheet's 999 / 888.
    assert.equal(projection.months[0].closingCash, 6_000_000);
    assert.equal(projection.months[0].statedClosing, 999);
  });
});

describe('unknown project handling', () => {
  it('imports records with no project rather than dropping them', () => {
    const sheet = makeSheet('Summary', [
      ['Customer', 'Contractual Amount', 'Receive Amount'],
      ['Somchai', 1_000_000, 400_000],
    ]);

    const { data } = run(sheet, null);
    assert.equal(data.receivable.length, 1);
    assert.equal(data.receivable[0].projectId, null);
  });

  it('lets a row-level project column override the file default', () => {
    const sheet = makeSheet('Summary', [
      ['Project', 'Customer', 'Contractual Amount', 'Receive Amount'],
      ['VTR', 'Somchai', 1_000_000, 400_000],
      ['Olympus', 'Suda', 2_000_000, 500_000],
    ]);

    const { data } = run(sheet, 'p-hamonia');
    assert.equal(data.receivable[0].projectId, 'p-marina');
    assert.equal(data.receivable[1].projectId, 'p-chtn');
  });
});

describe('cash flow stated as a month-per-column matrix', () => {
  // The layout the client's Cashflow_Report uses: months across the top,
  // line items down the side, split into INFLOW / OUTFLOW / CASH BALANCE.
  const sheet = makeSheet('Cashflow 2026', [
    ['INFLOW (Month / 2026)'],
    ['', 'Jan', 'Feb', 'Mar'],
    ['1.2 Operating Income', 100, 200, 300],
    ['3. Financing Income', 900, 0, 0],
    ['4. Total Cash Inflow (1+2+3)', 1000, 200, 300],
    ['7. Total Forecast Cash Inflow Plan (5+6)', 0, 0, 0],
    [],
    ['OUTFLOW (Month / 2026)'],
    ['', 'Jan', 'Feb', 'Mar'],
    ['1.2 Operating Expenses', -400, -50, -70],
    ['4. Total Cash Outflow (1+2+3)', -400, -50, -70],
    [],
    ['CASH BALANCE (Month / 2026)'],
    ['', 'Jan', 'Feb', 'Mar'],
    ['1. Cash at Bank Bal b/f', 5000, 5600, 5750],
    ['2. Cash Flow Bal (In-Out)', 600, 150, 230],
    ['3. Total Cash at Bank Bal c/f', 5600, 5750, 5980],
  ]);

  it('is classified as a cash flow sheet despite having no month column', () => {
    assert.equal(classifySheet(sheet).reportType, 'cashflow');
  });

  it('reads one record per month from the columns', () => {
    const { data } = run(sheet);
    assert.deepEqual(
      data.cashflow.map((c) => [c.month, c.expectedIncome, c.expectedExpense]),
      [
        ['2026-01', 1000, 400],
        ['2026-02', 200, 50],
        ['2026-03', 300, 70],
      ],
    );
  });

  it('takes the stated total rather than summing the components', () => {
    // Components are 100 + 900; the total row says 1000. Adding both would
    // report 2000 for January.
    const { data } = run(sheet);
    assert.equal(data.cashflow[0].expectedIncome, 1000);
  });

  it('treats a negative outflow as a positive cost', () => {
    const { data } = run(sheet);
    assert.ok(data.cashflow.every((c) => c.expectedExpense >= 0));
  });

  it('reads the opening and closing balances for reconciliation', () => {
    const { data } = run(sheet);
    assert.equal(data.cashflow[0].openingBalance, 5000);
    assert.equal(data.cashflow[0].closingBalance, 5600);
  });

  it('starts the projection from the stated opening, not from zero', () => {
    const { data } = run(sheet);
    indexSourceRefs(data);
    const { projection } = calculateMetrics(data, '2026-01-31');

    assert.equal(projection.months[0].openingCash, 5000);
    assert.equal(projection.months[0].closingCash, 5600);
    // Its own carry-forward is consistent here, so nothing should disagree.
    assert.equal(projection.months[0].closingCash, projection.months[0].statedClosing);
  });

  it('reports a carry-forward that does not tie up', () => {
    // Closing January is 5600 but February opens at 9999 — a real gap of the
    // kind found in the client's own statement.
    const broken = makeSheet('Cashflow 2026', [
      ['INFLOW (Month / 2026)'],
      ['', 'Jan', 'Feb'],
      ['4. Total Cash Inflow (1+2+3)', 1000, 200],
      [],
      ['OUTFLOW (Month / 2026)'],
      ['', 'Jan', 'Feb'],
      ['4. Total Cash Outflow (1+2+3)', -400, -50],
      [],
      ['CASH BALANCE (Month / 2026)'],
      ['', 'Jan', 'Feb'],
      ['1. Cash at Bank Bal b/f', 5000, 9999],
      ['3. Total Cash at Bank Bal c/f', 5600, 10149],
    ]);

    const { data } = run(broken);
    indexSourceRefs(data);
    const calc = calculateMetrics(data, '2026-01-31');
    const rule = runValidations(data, calc, null).find((r) => r.ruleKey === 'cashflow_running_balance');

    assert.ok(rule);
    assert.notEqual(rule.status, 'pass');
  });
});
