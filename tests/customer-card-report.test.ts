import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { unzipSync } from 'fflate';

import { generateCustomerCardReport } from '@/lib/reports/customer-card';
import { buildReport } from '@/lib/reports/customer-card/build';
import { parseCustomerCard } from '@/lib/reports/customer-card/parse';
import { daysToCompletion, futureValue, solveEir } from '@/lib/reports/customer-card/interest';
import { DEFAULT_OPTIONS } from '@/lib/reports/customer-card/types';
import { GRID, HEADER, HEADER_BAND, writeFixture } from './customer-card-fixture';
import { makeSheet } from './helpers';

function cardSheet() {
  return makeSheet('Customer Card', GRID as (string | number | null)[][]);
}

/** A data row, by column name, in the order the card writes them. */
const COLUMNS = [
  'ลำดับ', 'รหัสลูกค้า', 'ชื่อลูกค้า', 'ชื่อผู้ซื้อร่วม', 'แปลง/ห้อง', 'แบบบ้าน/แบบห้อง',
  'บ้านเลขที่', 'เลขที่สัญญา', 'ราคาขายตามสัญญา', 'เพิ่ม/ลด', 'ราคาขายสุทธิ', 'ประเภทงวด',
  'วันครบกำหนดชำระเงินตามสัญญา', 'จำนวนเงินที่ต้องชำระ', 'วันที่ชำระ/ยกเลิก', 'เลขที่ใบเสร็จ',
  'จำนวนเงินที่ชำระแล้ว', 'จำนวนเงินคงเหลือ', 'Quota', 'พื้นที่/อาคาร',
];

function line(values: Record<string, string | number>): (string | number | null)[] {
  return COLUMNS.map((h) => values[h] ?? null);
}

/**
 * The Customer Card report.
 *
 * The fixture is a customer card in the shape the sales system exports it:
 * unit and contract printed once and left blank on the instalment lines
 * beneath, one line per instalment, a receipt spread across two of them.
 * Everything the report has to get right is visible in it.
 */

const REPORT_DATE = '2026-08-22';
const OPTIONS = { ...DEFAULT_OPTIONS, projectLabel: 'SUN9', reportDate: REPORT_DATE };

let dir: string;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtg-card-'));
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('reading the customer card', () => {
  const parsed = parseCustomerCard(cardSheet());

  it('finds a header spread over two rows', () => {
    // The band ("กำหนดชำระเงิน") is on one row and the columns it names are on
    // the next. Scoring a single row finds thirteen of the twenty fields and
    // declares the file unreadable for want of the other seven.
    assert.equal(parsed.headerRow, 5);
    assert.equal(parsed.headerDepth, 2);
    assert.equal(parsed.columns.dueAmount, 13);
    assert.equal(parsed.columns.paidDate, 14);
    assert.equal(parsed.columns.installmentType, 11);
    assert.equal(parsed.columns.outstanding, 17);
  });

  it('stops at the report\u2019s own total line', () => {
    // It carries the whole project's figures and no unit of its own, so
    // without this it lands on the last contract above it.
    assert.ok(parsed.issues.some((i) => i.code === 'TOTAL_ROW_SKIPPED'));
    assert.ok(!parsed.rows.some((r) => r.dueAmount === 3_500_000));
  });

  it('names a unit by its building as well as its room', () => {
    // 163 room numbers are shared across four buildings, so "101" alone names
    // four different flats. The existing report writes them as "A101".
    assert.deepEqual([...new Set(parsed.rows.map((r) => r.unit))], ['A101', 'B101']);
    assert.equal(parsed.rows[0].room, '101');
  });

  it('reads ราคาขายสุทธิ, not ราคาขายตามสัญญา', () => {
    // Both columns are present and differ; taking the wrong one would put the
    // adjustment back into every price.
    assert.equal(parsed.rows[0].netPrice, 2_000_000);
    assert.equal(parsed.rows[0].contractPrice, 2_050_000);
  });

  it('carries the unit and contract down the blank instalment lines', () => {
    assert.equal(parsed.rows.length, 9);
    assert.ok(parsed.rows.slice(0, 6).every((r) => r.unit === 'A101'));
    assert.ok(parsed.rows.slice(0, 6).every((r) => r.contractNo === 'S9-0001'));
    assert.ok(parsed.rows.slice(6).every((r) => r.unit === 'B101'));
  });
});

describe('the report model', () => {
  const parsed = parseCustomerCard(cardSheet());
  const model = buildReport(parsed.rows, OPTIONS);
  const a101 = model.contracts.find((c) => c.unit === 'A101')!;

  it('groups one unit into one row', () => {
    assert.equal(model.contracts.length, 2);
    assert.equal(model.summary.units, 2);
    assert.equal(model.summary.contracts, 2);
  });

  it('plans by due date and never by payment date', () => {
    // The contract instalment was DUE in March and PAID in June. It belongs to
    // March here and to June in the paid matrix; the two must not swap.
    assert.equal(a101.plan.get('2026-03'), 180_000);
    assert.equal(a101.plan.get('2026-06'), 33_750);
    assert.equal(a101.plan.get('2026-02'), 20_000);
  });

  it('records cash in the month it arrived, however many instalments it settled', () => {
    // One receipt on 10/06 cleared the contract instalment and a down payment.
    assert.equal(a101.paid.get('2026-06'), 180_000 + 33_750 + 33_750);
    assert.equal(a101.paid.get('2026-02'), 20_000);
    assert.equal(a101.paid.get('2026-03'), undefined, 'a due date was used as a payment date');
  });

  it('puts the transfer instalment on On Key rather than dropping it', () => {
    assert.equal(a101.onKey, 1_698_750);
    // And the plan then adds up to the contract, which is the check that makes
    // the whole report trustworthy.
    const check = model.checks.find((c) => c.unit === 'A101')!;
    assert.equal(check.planTotal, 2_000_000);
    assert.equal(check.salePrice, 2_000_000);
  });

  it('reconciles outstanding against the card', () => {
    const check = model.checks.find((c) => c.unit === 'A101')!;
    assert.equal(check.paidTotal, 267_500);
    assert.equal(check.outstandingCalculated, 1_732_500);
    assert.equal(check.outstandingSource, 1_732_500);
    assert.equal(check.difference, 0);
    assert.equal(check.status, 'OK', check.note);
  });

  it('says when the rate it solved for is not a real financing rate', () => {
    // This fixture's plan is short and back-loaded, so the uplift falls on a
    // small part of it and the rate comes out far above anything real. The
    // arithmetic is right; the assumptions are what need looking at, and the
    // report says so rather than presenting the figure as fact.
    const warning = model.issues.find((i) => i.code === 'EIR_IMPLAUSIBLE');
    assert.ok(warning, 'an implausible rate went unreported');
    assert.match(warning.message, /completion date/);

    // And it does not mark the unit's own figures as failing to reconcile.
    assert.equal(model.checks.find((c) => c.unit === 'A101')!.status, 'OK');
  });

  it('spans every month from the first booking to completion', () => {
    assert.equal(model.months[0], '2026-02');
    assert.equal(model.months[model.months.length - 1], '2028-09');
  });

  it('never silently accepts the assumptions it was given', () => {
    assert.ok(model.summary.needsConfirmation.some((n) => n.includes('2028-09-30')));
    assert.ok(model.summary.needsConfirmation.some((n) => n.includes('20%')));
  });
});

describe('the effective interest rate', () => {
  const parsed = parseCustomerCard(cardSheet());
  const model = buildReport(parsed.rows, OPTIONS);
  const a101 = model.contracts.find((c) => c.unit === 'A101')!;

  it('grows the instalments into exactly the expected selling price', () => {
    const rate = model.eir.get(a101.key)!;
    const uplift = model.uplift.get('2026-02')!;
    const expected = a101.salePrice * (1 + uplift);

    // This is the whole definition of the rate; if it does not hold, every
    // interest figure in the workbook is wrong.
    const fv = futureValue(a101.plan, OPTIONS.completionDate, rate, a101.onKey);
    assert.ok(Math.abs(fv - expected) < 0.01, `FV ${fv} vs expected ${expected}`);
    assert.ok(rate > 0 && rate < 1, `rate out of range: ${rate}`);
  });

  it('counts the days the way the template does', () => {
    // 1 Sep 2028 to 30 Sep 2028 inclusive is 30 days.
    assert.equal(daysToCompletion('2028-09', '2028-09-30'), 30);
    assert.equal(daysToCompletion('2028-10', '2028-09-30'), 0);
  });

  it('says so rather than inventing a rate when none fits', () => {
    const plan = new Map([['2026-02', 5_000_000]]);
    const result = solveEir(plan, '2028-09-30', 1_000_000);
    assert.equal(result.solved, false);
    assert.match(result.reason ?? '', /already total more/);
  });
});

describe('the workbook', () => {
  let wb: ExcelJS.Workbook;

  const formula = (sheet: string, address: string) => {
    const value = wb.getWorksheet(sheet)!.getCell(address).value as { formula?: string } | null;
    return value && typeof value === 'object' && 'formula' in value ? (value.formula ?? '') : '';
  };
  const plain = (sheet: string, address: string) => wb.getWorksheet(sheet)!.getCell(address).value;

  before(async () => {
    // The generator reads a real file, so the fixture is written to one and
    // the result is read back the way Excel would.
    const source = writeFixture(path.join(dir, 'SUN9_AR_22082026.xlsx'));
    const result = await generateCustomerCardReport(source, path.basename(source), OPTIONS);

    const file = path.join(dir, 'out.xlsx');
    fs.writeFileSync(file, result.workbook);

    wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
  });

  it('carries the sheets the template does, plus the audit trail', () => {
    assert.deepEqual(
      wb.worksheets.map((ws) => ws.name),
      [
        'InsPlan',
        'InsPaid',
        '%sellingprice',
        'Interest expense recognition',
        'Data_Check',
        'Raw_AR_20260822',
      ],
    );
  });

  it('asks Excel to calculate on open', () => {
    // The formulas carry no cached result — this process has not evaluated
    // them — so without this the file opens with every derived figure blank.
    // Read from the file's own XML: ExcelJS writes the flag but does not
    // return it when reading back.
    const parts = unzipSync(new Uint8Array(fs.readFileSync(path.join(dir, 'out.xlsx'))));
    const xml = new TextDecoder().decode(parts['xl/workbook.xml']);
    assert.match(xml, /fullCalcOnLoad="1"/);
  });

  it('computes with formulas rather than writing the answers', () => {
    assert.match(formula('InsPlan', 'G6'), /%sellingprice/);
    assert.match(formula('InsPlan', 'A14'), /^A6$/, 'the FV table is not linked to the plan');
    assert.match(formula('InsPaid', 'A6'), /^InsPlan!A6$/);
    assert.match(formula('Interest expense recognition', 'F5'), /^E5-D5$/);
    assert.match(
      formula('Interest expense recognition', 'I5'),
      /^SUM\(InsPaid!\$H6:H6\)\*\$H5\*I\$1$/,
    );
  });

  it('writes the effective interest rate as the value it solved for', () => {
    // The one searched-for figure in the book. Excel reaches it with Goal Seek
    // and stores the answer; there is no formula that expresses it.
    const rate = plain('InsPlan', 'F14');
    assert.equal(typeof rate, 'number');
    assert.ok((rate as number) > 0, `rate not solved: ${rate}`);
    assert.match(formula('InsPlan', 'G14'), /^F14\/365$/);

    // The FV table foots to the expected selling price by construction; the
    // sheet says so in its own arithmetic rather than taking it on trust.
    assert.match(formula('InsPlan', 'AP14'), /^SUM\(H14:AO14\)$/);
    assert.match(formula('InsPlan', 'AQ14'), /^AP14-E14$/);
  });

  it('shows the plan and the payments as different matrices', () => {
    // Feb..Jun 2026 are columns H..L.
    assert.equal(plain('InsPlan', 'I6'), 180_000, 'the March instalment is not in the plan');
    assert.equal(plain('InsPaid', 'L6'), 247_500, 'June cash is not what actually arrived');
    // March holds the "nothing yet, but later months have something" marker
    // rather than a payment that never happened.
    assert.match(formula('InsPaid', 'I6'), /^IF\(J6<>"",0,""\)$/);
  });

  it('puts the transfer instalment on On Key and checks the plan adds up', () => {
    // Feb..Sep-2028 is 32 months, H..AM; a blank column, then On Key at AO.
    assert.equal(plain('InsPlan', 'AO6'), 1_698_750);
    assert.match(formula('InsPlan', 'AP6'), /^SUM\(H6:AO6\)$/);
    assert.match(formula('InsPlan', 'AQ6'), /^AP6-E6$/);
  });

  it('totals every month', () => {
    assert.match(formula('InsPlan', 'H8'), /^SUM\(H6:H7\)$/);
    assert.match(formula('InsPaid', 'H8'), /^SUM\(H6:H7\)$/);
  });

  it('reports its own reconciliation', () => {
    assert.equal(plain('Data_Check', 'A3'), 'Unit');
    assert.equal(plain('Data_Check', 'A4'), 'A101');
    assert.equal(plain('Data_Check', 'I4'), 'OK');
    assert.match(formula('Data_Check', 'G4'), /^C4-E4$/);
  });

  it('keeps the source data untouched, as an audit trail', () => {
    assert.equal(plain('Raw_AR_20260822', 'A1'), 'Source row');
    // The raw sheet shows the source's own room number, not the composed unit.
    assert.equal(plain('Raw_AR_20260822', 'F2'), '101');
    assert.equal(plain('Raw_AR_20260822', 'O2'), 20_000);
    // The second unit has no ราคาขายตามสัญญา of its own, and must not inherit
    // the first unit's.
    assert.equal(plain('Raw_AR_20260822', 'J8'), null);
    assert.equal(plain('Raw_AR_20260822', 'U2'), 'อาคาร A');
    assert.equal(plain('Raw_AR_20260822', 'L8'), 1_500_000);
  });
});

describe('dates the card cannot mean', () => {
  it('treats a placeholder due date as no date at all', () => {
    // The sales system writes 31/12/2088 for "on transfer, date not set". Read
    // literally it stretches the report across fifty years of empty columns.
    const rows = parseCustomerCard(
      makeSheet('Card', [
        HEADER_BAND,
        HEADER,
        line({ 'แปลง/ห้อง': '101', 'พื้นที่/อาคาร': 'อาคาร A', 'เลขที่สัญญา': 'S-1', 'ราคาขายสุทธิ': 1_000_000, 'ประเภทงวด': 'จอง', 'วันครบกำหนดชำระเงินตามสัญญา': '01/02/2026', 'จำนวนเงินที่ต้องชำระ': 100_000 }),
        line({ 'ประเภทงวด': 'โอน', 'วันครบกำหนดชำระเงินตามสัญญา': '31/12/2088', 'จำนวนเงินที่ต้องชำระ': 900_000 }),
      ] as (string | number | null)[][]),
    ).rows;

    const model = buildReport(rows, OPTIONS);
    const contract = model.contracts[0];

    assert.ok(model.issues.some((i) => i.code === 'DUE_DATE_IMPLAUSIBLE'));
    // Being a transfer instalment, it lands on On Key rather than being lost.
    assert.equal(contract.onKey, 900_000);
    assert.equal(model.months[model.months.length - 1], '2028-09');
  });

  it('says when a due date falls long after the payment that settled it', () => {
    // A mistyped contract year — C2035080001 for C2025080001 — carries the due
    // date with it. The date is used as it stands and reported; guessing the
    // year would be inventing one.
    const rows = parseCustomerCard(
      makeSheet('Card', [
        HEADER_BAND,
        HEADER,
        line({ 'แปลง/ห้อง': '801', 'พื้นที่/อาคาร': 'อาคาร D', 'เลขที่สัญญา': 'S-2', 'ราคาขายสุทธิ': 1_000_000, 'ประเภทงวด': 'สัญญา งวด 1', 'วันครบกำหนดชำระเงินตามสัญญา': '03/08/2035', 'จำนวนเงินที่ต้องชำระ': 470_000, 'วันที่ชำระ/ยกเลิก': '06/08/2024', 'จำนวนเงินที่ชำระแล้ว': 470_000 }),
      ] as (string | number | null)[][]),
    ).rows;

    const model = buildReport(rows, OPTIONS);
    const issue = model.issues.find((i) => i.code === 'DUE_DATE_AFTER_PAYMENT');

    assert.ok(issue, 'a due date eleven years after its payment went unreported');
    assert.equal(model.contracts[0].plan.get('2035-08'), 470_000, 'the amount was moved');
    assert.equal(model.contracts[0].paid.get('2024-08'), 470_000);
  });

  it('refuses a grid so long it can only be a data error', () => {
    const rows = parseCustomerCard(
      makeSheet('Card', [
        HEADER_BAND,
        HEADER,
        line({ 'แปลง/ห้อง': '101', 'พื้นที่/อาคาร': 'อาคาร A', 'เลขที่สัญญา': 'S-3', 'ราคาขายสุทธิ': 1_000_000, 'ประเภทงวด': 'จอง', 'วันครบกำหนดชำระเงินตามสัญญา': '01/02/2026', 'จำนวนเงินที่ต้องชำระ': 100_000 }),
        line({ 'ประเภทงวด': 'ดาวน์ งวด 1', 'วันครบกำหนดชำระเงินตามสัญญา': '01/02/2060', 'จำนวนเงินที่ต้องชำระ': 900_000 }),
      ] as (string | number | null)[][]),
    ).rows;

    // 2060 is inside the ten-year horizon of a 2050 report but not of this one,
    // so force the grid open by moving the report date out with it.
    assert.throws(
      () => buildReport(rows, { ...OPTIONS, reportDate: '2055-08-22' }),
      /more than \d+ years/,
    );
  });
});
