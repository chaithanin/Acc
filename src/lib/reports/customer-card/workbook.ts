import ExcelJS from 'exceljs';
import { endOfMonth } from '@/lib/excel/cells';
import { expectedSellingPrice, paidTotal, planTotal, startMonth } from './build';
import { daysToCompletion, monthsToCompletion } from './interest';
import { COLOR, DATA_BOX, DATE, FONT, MONEY, PERCENT, PERCENT_FINE, THIN_BOX } from './style';
import type { ContractGroup, CustomerCardRow, ReportModel } from './types';

/**
 * Writing the workbook.
 *
 * Two rules run through all of this:
 *
 *   1. Anything computed is written as a FORMULA, not as the number it
 *      currently evaluates to. The accountants change a completion date or a
 *      rate and expect the file to follow; a file of constants would not, and
 *      would not say so either.
 *   2. Only two kinds of value are written as constants — what was read out of
 *      the customer card, and the effective interest rate. The rate is the
 *      result of a search, which Excel performs with Goal Seek and cannot
 *      express as a formula; the template holds it as a constant for exactly
 *      the same reason.
 */

/** 0-based column index → Excel letter. */
function col(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** "2026-08" → "8 2026", the key the uplift table is looked up by. */
function periodKey(month: string): string {
  return `${Number(month.slice(5, 7))} ${month.slice(0, 4)}`;
}

/** "2026-08" → "Aug-2026", as the month headers read. */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabel(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]}-${month.slice(0, 4)}`;
}

function firstOfMonth(month: string): Date {
  return new Date(`${month}-01T00:00:00Z`);
}

function lastOfMonth(month: string): Date {
  return new Date(`${endOfMonth(`${month}-01`)}T00:00:00Z`);
}

interface Layout {
  /** 0-based index of the first monthly column. */
  monthStart: number;
  /** 0-based index of the row the first contract sits on (Excel row = +1). */
  firstDataRow: number;
}

const PLAN: Layout = { monthStart: 7, firstDataRow: 5 }; // H, row 6
const PAID: Layout = { monthStart: 7, firstDataRow: 5 }; // H, row 6
const IER: Layout = { monthStart: 8, firstDataRow: 4 }; //  I, row 5

export async function writeReportWorkbook(model: ReportModel): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Global Top Group Financial Dashboard';
  wb.created = new Date(`${model.options.reportDate}T00:00:00Z`);

  // Formulas are written without a cached result, which is honest — this
  // process has not evaluated them. Excel therefore has to calculate the whole
  // book when it opens it, and will only do so if asked. Without this the file
  // opens showing blank cells where every derived figure should be.
  wb.calcProperties.fullCalcOnLoad = true;

  const planRows = writeInsPlan(wb, model);
  writeInsPaid(wb, model);
  writeSellingPrice(wb, model);
  writeInterestRecognition(wb, model, planRows);
  writeDataCheck(wb, model);
  writeRawData(wb, model);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** Applies the shared data-cell look. */
function styleData(cell: ExcelJS.Cell, numFmt?: string): void {
  cell.font = { ...FONT };
  cell.border = { ...DATA_BOX };
  if (numFmt) cell.numFmt = numFmt;
}

function styleHeader(cell: ExcelJS.Cell, fill: string): void {
  cell.font = { ...FONT, bold: true, color: { argb: COLOR.headerText } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.border = { ...THIN_BOX };
}

// --------------------------------------------------------------- InsPlan

interface PlanRows {
  /** Excel row of each contract in the InsPlan table, by contract key. */
  byKey: Map<string, number>;
  /** Excel row of each contract in the FV table below it. */
  fvByKey: Map<string, number>;
  totalRow: number;
  daysRow: number;
  goalSeekRow: number;
  lastMonthCol: number;
  onKeyCol: number;
}

function writeInsPlan(wb: ExcelJS.Workbook, model: ReportModel): PlanRows {
  const ws = wb.addWorksheet('InsPlan');
  const { months, contracts, options } = model;

  const monthCol = (index: number) => PLAN.monthStart + index;
  const lastMonthCol = monthCol(months.length - 1);
  const onKeyCol = lastMonthCol + 2; // one blank column, as the template has
  const totalPriceCol = onKeyCol + 1;
  const checkCol = totalPriceCol + 1;

  ws.getCell('A1').value = options.projectLabel;
  ws.getCell('A1').font = { ...FONT, bold: true };
  ws.getCell('A2').value = 'Advance received on installment plan';
  ws.getCell('A2').font = { ...FONT, bold: true };
  ws.getCell('A3').value = 'Receive';
  ws.getCell('A3').font = { ...FONT, bold: true };

  const bandCell = ws.getCell('A4');
  bandCell.value = 'Installment plan';
  bandCell.font = { ...FONT, bold: true };
  bandCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.bandTitle } };

  months.forEach((month, index) => {
    const letter = col(monthCol(index));
    // The year is derived from the date beneath it, so moving the schedule
    // moves both together.
    const year = ws.getCell(`${letter}3`);
    year.value = { formula: `YEAR(${letter}4)` };
    year.font = { ...FONT };
    year.alignment = { horizontal: 'center' };

    const date = ws.getCell(`${letter}4`);
    date.value = firstOfMonth(month);
    date.numFmt = DATE;
    date.font = { ...FONT };
    date.alignment = { horizontal: 'center' };
  });

  const headers = ['Item', 'Date', 'Start period', 'Unit', ' Sale Price ', ' M-Y ', ' Expected selling price '];
  headers.forEach((label, index) => {
    const cell = ws.getCell(5, index + 1);
    cell.value = label;
    styleHeader(cell, COLOR.headerIdentity);
  });

  months.forEach((month, index) => {
    const cell = ws.getCell(5, monthCol(index) + 1);
    cell.value = `${monthLabel(month)} Installment`;
    styleHeader(cell, COLOR.headerPlan);
  });

  for (const [index, label] of [[onKeyCol, 'On Key'], [totalPriceCol, 'Total unit price'], [checkCol, 'check']] as const) {
    const cell = ws.getCell(5, index + 1);
    cell.value = label;
    styleHeader(cell, COLOR.headerIdentity);
  }
  ws.getRow(5).height = 60;

  const byKey = new Map<string, number>();

  contracts.forEach((contract, index) => {
    const r = PLAN.firstDataRow + index + 1; // Excel row
    byKey.set(contract.key, r);

    const item = ws.getCell(r, 1);
    item.value = index + 1;
    styleData(item);
    item.alignment = { horizontal: 'center' };

    const date = ws.getCell(r, 2);
    if (contract.contractDate) date.value = new Date(`${contract.contractDate}T00:00:00Z`);
    styleData(date, DATE);
    date.alignment = { horizontal: 'center' };

    const start = ws.getCell(r, 3);
    const startKey = startMonth(contract);
    if (startKey) start.value = firstOfMonth(startKey);
    styleData(start, DATE);
    start.alignment = { horizontal: 'center' };

    const unit = ws.getCell(r, 4);
    unit.value = contract.unit;
    styleData(unit, MONEY);
    unit.alignment = { horizontal: 'center' };

    const price = ws.getCell(r, 5);
    price.value = contract.salePrice;
    styleData(price, MONEY);

    const period = ws.getCell(r, 6);
    period.value = startKey ? periodKey(startKey) : '';
    styleData(period, MONEY);

    // The uplift is looked up rather than multiplied in, so changing the
    // completion date on '%sellingprice' moves every expected price at once.
    const expected = ws.getCell(r, 7);
    expected.value = {
      formula: `E${r}*(1+IFERROR(VLOOKUP(F${r},'%sellingprice'!$B:$D,3,FALSE),0))`,
    };
    styleData(expected, MONEY);
    expected.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.derived } };

    months.forEach((month, mIndex) => {
      const cell = ws.getCell(r, monthCol(mIndex) + 1);
      const amount = contract.plan.get(month);
      if (amount) cell.value = amount;
      styleData(cell, MONEY);
    });

    const onKey = ws.getCell(r, onKeyCol + 1);
    if (contract.onKey) onKey.value = contract.onKey;
    styleData(onKey, MONEY);

    const total = ws.getCell(r, totalPriceCol + 1);
    total.value = { formula: `SUM(${col(PLAN.monthStart)}${r}:${col(onKeyCol)}${r})` };
    styleData(total, MONEY);

    const check = ws.getCell(r, checkCol + 1);
    check.value = { formula: `${col(totalPriceCol)}${r}-E${r}` };
    styleData(check, MONEY);
  });

  const totalRow = PLAN.firstDataRow + contracts.length + 1;
  const firstRow = PLAN.firstDataRow + 1;
  const lastRow = totalRow - 1;

  const totalLabel = ws.getCell(totalRow, 7);
  totalLabel.value = ' Total ';
  totalLabel.font = { ...FONT, bold: true };

  for (let c = PLAN.monthStart; c <= checkCol; c += 1) {
    if (c === lastMonthCol + 1) continue;
    const cell = ws.getCell(totalRow, c + 1);
    cell.value = { formula: `SUM(${col(c)}${firstRow}:${col(c)}${lastRow})` };
    cell.font = { ...FONT, bold: true };
    cell.numFmt = MONEY;
  }

  // ------------------------------------------------ future value of the plan
  const completeRow = totalRow + 2;
  ws.getCell(completeRow, 7).value = 'Expected building complete';
  ws.getCell(completeRow, 7).font = { ...FONT, bold: true };

  const goalSeekRow = completeRow + 1;
  ws.getCell(goalSeekRow, 5).value = 'Goal seek';
  const completion = ws.getCell(goalSeekRow, 7);
  completion.value = new Date(`${options.completionDate}T00:00:00Z`);
  completion.numFmt = DATE;
  completion.font = { ...FONT, bold: true };

  const daysRow = goalSeekRow + 1;
  ws.getCell(daysRow, 1).value = 'FV of installment';
  ws.getCell(daysRow, 1).font = { ...FONT, bold: true };

  months.forEach((_, index) => {
    const letter = col(monthCol(index));
    const cell = ws.getCell(daysRow, monthCol(index) + 1);
    cell.value = { formula: `$G$${goalSeekRow}-${letter}4+1` };
    cell.font = { ...FONT };
  });
  // The handover instalment is paid at completion, so it accrues nothing.
  ws.getCell(daysRow, onKeyCol + 1).value = 0;

  const fvHeaderRow = daysRow + 1;
  const fvHeaders = ['Item', 'Date', 'Unit', 'Expected selling price', null, ' Effective Interest rate ', ' EIR per day '];
  fvHeaders.forEach((label, index) => {
    const cell = ws.getCell(fvHeaderRow, index + 1);
    cell.value = label === null ? { formula: 'E5' } : label;
    styleHeader(cell, COLOR.headerIdentity);
  });
  months.forEach((month, index) => {
    const cell = ws.getCell(fvHeaderRow, monthCol(index) + 1);
    cell.value = ` ${monthLabel(month)} Installment `;
    styleHeader(cell, COLOR.headerPlan);
  });
  for (const [c, label] of [
    [onKeyCol, 'On Key'],
    [totalPriceCol, 'FV per installment plan'],
    [checkCol, 'Interest expense per plan'],
  ] as const) {
    const cell = ws.getCell(fvHeaderRow, c + 1);
    cell.value = label;
    styleHeader(cell, COLOR.headerIdentity);
  }
  ws.getRow(fvHeaderRow).height = 60;

  const fvByKey = new Map<string, number>();

  contracts.forEach((contract, index) => {
    const r = fvHeaderRow + index + 1;
    const source = byKey.get(contract.key)!;
    fvByKey.set(contract.key, r);

    for (const [c, formula] of [[1, `A${source}`], [2, `B${source}`], [3, `D${source}`], [4, `G${source}`], [5, `E${source}`]] as const) {
      const cell = ws.getCell(r, c);
      cell.value = { formula };
      styleData(cell, c === 2 ? DATE : MONEY);
    }

    // The one searched-for value in the workbook. Excel reaches it with Goal
    // Seek and stores the answer; so does this.
    const rate = ws.getCell(r, 6);
    rate.value = model.eir.get(contract.key) ?? 0;
    styleData(rate, PERCENT);

    const perDay = ws.getCell(r, 7);
    perDay.value = { formula: `F${r}/365` };
    styleData(perDay, PERCENT_FINE);

    months.forEach((_, mIndex) => {
      const letter = col(monthCol(mIndex));
      const cell = ws.getCell(r, monthCol(mIndex) + 1);
      cell.value = { formula: `${letter}${source}*(1+$G${r})^${letter}$${daysRow}` };
      styleData(cell, MONEY);
    });

    const onKey = ws.getCell(r, onKeyCol + 1);
    onKey.value = { formula: `${col(onKeyCol)}${source}` };
    styleData(onKey, MONEY);

    // The future value of the whole plan, which is what the rate above was
    // searched for: it must come out at the expected selling price in column D.
    const fvTotal = ws.getCell(r, totalPriceCol + 1);
    fvTotal.value = { formula: `SUM(${col(PLAN.monthStart)}${r}:${col(onKeyCol)}${r})` };
    styleData(fvTotal, MONEY);
    fvTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.derived } };

    const interest = ws.getCell(r, checkCol + 1);
    interest.value = { formula: `${col(totalPriceCol)}${r}-E${r}` };
    styleData(interest, MONEY);
  });

  const fvTotalRow = fvHeaderRow + contracts.length + 1;
  ws.getCell(fvTotalRow, 7).value = ' Total ';
  ws.getCell(fvTotalRow, 7).font = { ...FONT, bold: true };
  for (let c = PLAN.monthStart; c <= checkCol; c += 1) {
    if (c === lastMonthCol + 1) continue;
    const cell = ws.getCell(fvTotalRow, c + 1);
    cell.value = { formula: `SUM(${col(c)}${fvHeaderRow + 1}:${col(c)}${fvTotalRow - 1})` };
    cell.font = { ...FONT, bold: true };
    cell.numFmt = MONEY;
  }

  setWidths(ws, checkCol);

  return { byKey, fvByKey, totalRow, daysRow, goalSeekRow, lastMonthCol, onKeyCol };
}

// --------------------------------------------------------------- InsPaid

function writeInsPaid(wb: ExcelJS.Workbook, model: ReportModel): void {
  const ws = wb.addWorksheet('InsPaid');
  const { months, contracts } = model;

  const monthCol = (index: number) => PAID.monthStart + index;
  const lastMonthCol = monthCol(months.length - 1);
  const totalCol = lastMonthCol + 2;

  const band = ws.getCell('A4');
  band.value = 'Installment received';
  band.font = { ...FONT, bold: true };
  band.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.bandTitle } };

  months.forEach((month, index) => {
    const c = monthCol(index) + 1;

    const number = ws.getCell(2, c);
    number.value = index + 1;
    number.font = { ...FONT };

    const end = ws.getCell(3, c);
    end.value = lastOfMonth(month);
    end.numFmt = DATE;
    end.font = { ...FONT };
    end.alignment = { horizontal: 'center' };

    const start = ws.getCell(4, c);
    start.value = firstOfMonth(month);
    start.numFmt = DATE;
    start.font = { ...FONT };
    start.alignment = { horizontal: 'center' };
  });

  const headers: (string | { formula: string })[] = [
    'Item', 'Date', 'Unit', 'Start period',
    { formula: 'InsPlan!E5' }, { formula: 'InsPlan!G5' }, 'Column no.',
  ];
  headers.forEach((value, index) => {
    const cell = ws.getCell(5, index + 1);
    cell.value = value as ExcelJS.CellValue;
    styleHeader(cell, COLOR.headerIdentity);
  });
  months.forEach((month, index) => {
    const cell = ws.getCell(5, monthCol(index) + 1);
    cell.value = `${monthLabel(month)} Paid`;
    styleHeader(cell, COLOR.headerPaid);
  });
  const totalHeader = ws.getCell(5, totalCol + 1);
  totalHeader.value = 'Total installment received';
  styleHeader(totalHeader, COLOR.headerIdentity);
  ws.getRow(5).height = 30;

  // Everything up to and including the report month counts towards "Column
  // no."; months still in the future are not yet late and must not inflate it.
  const reportMonth = model.options.reportDate.slice(0, 7);
  const elapsed = months.filter((m) => m <= reportMonth).length;
  const countEndCol = col(monthCol(Math.max(0, elapsed - 1)));

  contracts.forEach((contract, index) => {
    const r = PAID.firstDataRow + index + 1;
    const planRow = PLAN.firstDataRow + index + 1;

    for (const [c, formula, fmt] of [
      [1, `InsPlan!A${planRow}`, MONEY],
      [2, `InsPlan!B${planRow}`, DATE],
      [3, `InsPlan!D${planRow}`, MONEY],
      [4, `InsPlan!C${planRow}`, DATE],
      [5, `InsPlan!E${planRow}`, MONEY],
      [6, `InsPlan!G${planRow}`, MONEY],
    ] as const) {
      const cell = ws.getCell(r, c);
      cell.value = { formula };
      styleData(cell, fmt);
      if (c <= 4) cell.alignment = { horizontal: 'center' };
    }

    const count = ws.getCell(r, 7);
    count.value = { formula: `COUNT(${col(PAID.monthStart)}${r}:${countEndCol}${r})` };
    styleData(count, MONEY);

    months.forEach((month, mIndex) => {
      const cell = ws.getCell(r, monthCol(mIndex) + 1);
      const amount = contract.paid.get(month);

      if (amount) {
        cell.value = amount;
      } else {
        // A month with no payment holds 0 while later months still have one,
        // and nothing once the payments have stopped. That is what makes
        // "Column no." count the months elapsed rather than the payments made,
        // and it is the template's own device.
        const next = col(monthCol(mIndex + 1));
        cell.value = { formula: `IF(${next}${r}<>"",0,"")` };
      }
      styleData(cell, MONEY);
    });

    const total = ws.getCell(r, totalCol + 1);
    total.value = {
      formula: `SUM(${col(PAID.monthStart)}${r}:${col(lastMonthCol)}${r})`,
    };
    styleData(total, MONEY);
  });

  const totalRow = PAID.firstDataRow + contracts.length + 1;
  ws.getCell(totalRow, 7).value = ' Total ';
  ws.getCell(totalRow, 7).font = { ...FONT, bold: true };
  for (let c = PAID.monthStart; c <= totalCol; c += 1) {
    if (c === lastMonthCol + 1) continue;
    const cell = ws.getCell(totalRow, c + 1);
    cell.value = {
      formula: `SUM(${col(c)}${PAID.firstDataRow + 1}:${col(c)}${totalRow - 1})`,
    };
    cell.font = { ...FONT, bold: true };
    cell.numFmt = MONEY;
  }

  setWidths(ws, totalCol);
}

// -------------------------------------------------------- %sellingprice

function writeSellingPrice(wb: ExcelJS.Workbook, model: ReportModel): void {
  const ws = wb.addWorksheet('%sellingprice');
  const { months, options } = model;
  const completionMonth = options.completionDate.slice(0, 7);

  const completion = ws.getCell('B1');
  completion.value = new Date(`${options.completionDate}T00:00:00Z`);
  completion.numFmt = DATE;
  completion.font = { ...FONT, bold: true };

  ws.getCell('B2').value = 'Period';
  ws.getCell('C2').value = 'month till building complete';
  ws.getCell('D2').value = '% of selling price increase ';
  for (const address of ['B2', 'C2', 'D2']) ws.getCell(address).font = { ...FONT, bold: true };

  const anchorRow = 3 + months.length;

  months.forEach((month, index) => {
    const r = 3 + index;
    ws.getCell(r, 2).value = periodKey(month);
    ws.getCell(r, 2).font = { ...FONT };

    ws.getCell(r, 3).value = monthsToCompletion(month, completionMonth);
    ws.getCell(r, 3).font = { ...FONT };

    const uplift = ws.getCell(r, 4);
    uplift.value = { formula: `C${r}/$C$${anchorRow}*$D$${anchorRow}` };
    uplift.numFmt = PERCENT;
    uplift.font = { ...FONT };
  });

  // The anchor: the whole uplift, over the whole schedule. Both are inputs, so
  // Finance can change either and every expected price follows.
  const anchorMonths = ws.getCell(anchorRow, 3);
  anchorMonths.value = months.length > 0 ? monthsToCompletion(months[0], completionMonth) : 0;
  anchorMonths.font = { ...FONT, bold: true };

  const anchorUplift = ws.getCell(anchorRow, 4);
  anchorUplift.value = options.maxUplift;
  anchorUplift.numFmt = '0%';
  anchorUplift.font = { ...FONT, bold: true };

  ws.getCell(anchorRow, 2).value = 'Assumption — confirm with Finance';
  ws.getCell(anchorRow, 2).font = { ...FONT, bold: true, italic: true };

  ws.getColumn(2).width = 14;
  ws.getColumn(3).width = 28;
  ws.getColumn(4).width = 26;
}

// -------------------------------------------- Interest expense recognition

function writeInterestRecognition(
  wb: ExcelJS.Workbook,
  model: ReportModel,
  plan: PlanRows,
): void {
  const ws = wb.addWorksheet('Interest expense recognition');
  const { months, contracts } = model;

  const monthCol = (index: number) => IER.monthStart + index;
  const lastMonthCol = monthCol(months.length - 1);

  const years = [...new Set(months.map((m) => m.slice(0, 4)))].sort();
  const recogStart = lastMonthCol + 2;
  const accumStart = recogStart + years.length + 1;
  const reverseStart = accumStart + years.length + 1;
  const drStart = reverseStart + years.length + 1;
  const crStart = drStart + years.length + 1;
  const assetCol = crStart + years.length + 1;

  months.forEach((month, index) => {
    const c = monthCol(index) + 1;
    const letter = col(monthCol(index));

    const days = ws.getCell(1, c);
    days.value = { formula: `${letter}2-${letter}3+1` };
    days.font = { ...FONT };

    const end = ws.getCell(2, c);
    end.value = lastOfMonth(month);
    end.numFmt = DATE;
    end.font = { ...FONT };

    const start = ws.getCell(3, c);
    start.value = firstOfMonth(month);
    start.numFmt = DATE;
    start.font = { ...FONT };
  });

  const headers = [
    'Item', 'Date', 'Unit', ' selling price ', ' FV per installment plan ',
    ' Interest expense per plan ', ' Effective Interest rate ', ' EIR per day ',
  ];
  headers.forEach((label, index) => {
    const cell = ws.getCell(4, index + 1);
    cell.value = label;
    styleHeader(cell, COLOR.headerIdentity);
  });
  months.forEach((month, index) => {
    const cell = ws.getCell(4, monthCol(index) + 1);
    cell.value = `${monthLabel(month)} Paid`;
    styleHeader(cell, COLOR.headerPaid);
  });

  const block = (start: number, label: (year: string) => string, fill: string) => {
    years.forEach((year, index) => {
      const cell = ws.getCell(4, start + index + 1);
      cell.value = label(year);
      styleHeader(cell, fill);
    });
  };

  block(recogStart, (y) => `Interest recognition in ${y}`, COLOR.headerIdentity);
  block(accumStart, (y) => `Accumulated interest as at 31-Dec-${y.slice(2)}`, COLOR.headerIdentity);
  block(reverseStart, (y) => `Reverse premium interest at 31-Dec-${y.slice(2)}`, COLOR.headerIdentity);
  block(drStart, () => 'Dr. Interest expense', COLOR.headerPlan);
  block(crStart, () => 'Cr. Advance received', COLOR.headerPlan);

  const assetHeader = ws.getCell(4, assetCol + 1);
  assetHeader.value = 'Dr. อสังหาริมทรัพย์รอการขาย\n     Cr. Interest expense';
  styleHeader(assetHeader, COLOR.headerPlan);
  ws.getRow(4).height = 60;

  contracts.forEach((contract, index) => {
    const r = IER.firstDataRow + index + 1;
    const paidRow = PAID.firstDataRow + index + 1;
    const planRow = PLAN.firstDataRow + index + 1;
    const fvRow = plan.fvByKey.get(contract.key)!;

    for (const [c, formula, fmt] of [
      [1, `InsPaid!A${paidRow}`, MONEY],
      [2, `InsPaid!B${paidRow}`, DATE],
      [3, `InsPaid!C${paidRow}`, MONEY],
      [4, `InsPlan!E${planRow}`, MONEY],
      [5, `InsPlan!G${planRow}`, MONEY],
      [6, `E${r}-D${r}`, MONEY],
      [7, `InsPlan!F${fvRow}`, PERCENT],
      [8, `G${r}/365`, PERCENT_FINE],
    ] as const) {
      const cell = ws.getCell(r, c);
      cell.value = { formula };
      styleData(cell, fmt);
    }

    months.forEach((_, mIndex) => {
      const c = monthCol(mIndex);
      const cell = ws.getCell(r, c + 1);
      // Interest for the month runs on everything received up to and including
      // it, at the daily rate, for the days in that month.
      const paidEnd = col(PAID.monthStart + mIndex);
      cell.value = {
        formula: `SUM(InsPaid!$${col(PAID.monthStart)}${paidRow}:${paidEnd}${paidRow})*$H${r}*${col(c)}$1`,
      };
      styleData(cell, MONEY);
    });

    years.forEach((year, yIndex) => {
      const first = months.findIndex((m) => m.startsWith(year));
      const last = months.map((m) => m.startsWith(year)).lastIndexOf(true);

      const recog = ws.getCell(r, recogStart + yIndex + 1);
      recog.value = {
        formula: `SUM(${col(monthCol(first))}${r}:${col(monthCol(last))}${r})`,
      };
      styleData(recog, MONEY);

      // Accumulated interest is capped at the interest the plan actually
      // carries: once the cap is reached the surplus is reversed rather than
      // recognised, which is the whole point of the reverse-premium column.
      const accum = ws.getCell(r, accumStart + yIndex + 1);
      const prevAccum = yIndex === 0 ? null : col(accumStart + yIndex);
      const prevReverse = yIndex === 0 ? null : col(reverseStart + yIndex);
      accum.value = {
        formula:
          yIndex === 0
            ? `${col(recogStart)}${r}`
            : `IF(${prevAccum}${r}>=$F${r},${prevAccum}${r}+${prevReverse}${r},SUM($${col(recogStart)}${r}:${col(recogStart + yIndex)}${r}))`,
      };
      styleData(accum, MONEY);

      const reverse = ws.getCell(r, reverseStart + yIndex + 1);
      reverse.value = {
        formula: `IF(${col(accumStart + yIndex)}${r}>$F${r},$F${r}-${col(accumStart + yIndex)}${r},0)`,
      };
      styleData(reverse, MONEY);

      const dr = ws.getCell(r, drStart + yIndex + 1);
      dr.value = {
        formula:
          yIndex === 0
            ? `${col(recogStart)}${r}+${col(reverseStart)}${r}`
            : `IF(${col(accumStart + yIndex)}${r}<=${prevAccum}${r},0,${col(recogStart + yIndex)}${r}+${col(reverseStart + yIndex)}${r})`,
      };
      styleData(dr, MONEY);

      const cr = ws.getCell(r, crStart + yIndex + 1);
      cr.value = { formula: `-${col(drStart + yIndex)}${r}` };
      styleData(cr, MONEY);
    });

    const asset = ws.getCell(r, assetCol + 1);
    asset.value = { formula: `-${col(crStart + years.length - 1)}${r}` };
    styleData(asset, MONEY);
  });

  const totalRow = IER.firstDataRow + contracts.length + 1;
  ws.getCell(totalRow, 8).value = ' Total ';
  ws.getCell(totalRow, 8).font = { ...FONT, bold: true };

  for (let c = IER.monthStart; c <= assetCol; c += 1) {
    const cell = ws.getCell(totalRow, c + 1);
    cell.value = {
      formula: `SUM(${col(c)}${IER.firstDataRow + 1}:${col(c)}${totalRow - 1})`,
    };
    cell.font = { ...FONT, bold: true };
    cell.numFmt = MONEY;
  }

  setWidths(ws, assetCol);
}

// ------------------------------------------------------------ Data_Check

function writeDataCheck(wb: ExcelJS.Workbook, model: ReportModel): void {
  const ws = wb.addWorksheet('Data_Check');

  ws.getCell('A1').value = `${model.options.projectLabel} — reconciliation as at ${model.options.reportDate}`;
  ws.getCell('A1').font = { ...FONT, bold: true, size: 12 };

  const headers = [
    'Unit', 'Contract No.', 'Sale Price', 'Plan Total', 'Paid Total',
    'Outstanding Source', 'Outstanding Calculated', 'Difference', 'Status', 'Note',
  ];
  headers.forEach((label, index) => {
    const cell = ws.getCell(3, index + 1);
    cell.value = label;
    styleHeader(cell, COLOR.headerIdentity);
  });

  model.checks.forEach((check, index) => {
    const r = 4 + index;
    ws.getCell(r, 1).value = check.unit;
    ws.getCell(r, 2).value = check.contractNo;
    ws.getCell(r, 3).value = check.salePrice;
    ws.getCell(r, 4).value = check.planTotal;
    ws.getCell(r, 5).value = check.paidTotal;
    ws.getCell(r, 6).value = check.outstandingSource;
    // Recomputed in the sheet, so a corrected figure updates the difference.
    ws.getCell(r, 7).value = { formula: `C${r}-E${r}` };
    ws.getCell(r, 8).value = { formula: `IF(F${r}="","",F${r}-G${r})` };
    ws.getCell(r, 9).value = check.status;
    ws.getCell(r, 10).value = check.note;

    for (let c = 1; c <= 10; c += 1) {
      const cell = ws.getCell(r, c);
      styleData(cell, c >= 3 && c <= 8 ? MONEY : undefined);
    }

    const status = ws.getCell(r, 9);
    status.alignment = { horizontal: 'center' };
    if (check.status !== 'OK') {
      status.font = { ...FONT, bold: true, color: { argb: check.status === 'ERROR' ? 'FF9C0006' : 'FF9C6500' } };
      status.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: check.status === 'ERROR' ? 'FFFFC7CE' : 'FFFFEB9C' },
      };
    }
  });

  const totalRow = 4 + model.checks.length;
  ws.getCell(totalRow, 2).value = 'Total';
  ws.getCell(totalRow, 2).font = { ...FONT, bold: true };
  for (const c of [3, 4, 5, 6, 7, 8]) {
    const cell = ws.getCell(totalRow, c);
    cell.value = { formula: `SUM(${col(c - 1)}4:${col(c - 1)}${totalRow - 1})` };
    cell.font = { ...FONT, bold: true };
    cell.numFmt = MONEY;
  }

  let r = totalRow + 2;
  const write = (label: string, value: string | number) => {
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 1).font = { ...FONT, bold: true };
    ws.getCell(r, 3).value = value;
    if (typeof value === 'number') ws.getCell(r, 3).numFmt = MONEY;
    r += 1;
  };

  const s = model.summary;
  write('Source rows read', s.sourceRows);
  write('Contracts', s.contracts);
  write('Units', s.units);
  write('Total net selling price', s.totalSalePrice);
  write('Total expected selling price', s.totalExpectedSellingPrice);
  write('Total installment plan', s.totalPlan);
  write('Total actual paid', s.totalPaid);
  write('Total outstanding', s.totalOutstanding);
  write('Total interest expense', s.totalInterestExpense);
  write('OK', s.ok);
  write('CHECK', s.check);
  write('ERROR', s.error);

  r += 1;
  ws.getCell(r, 1).value = 'REVIEW REQUIRED — assumptions Finance has not confirmed';
  ws.getCell(r, 1).font = { ...FONT, bold: true, color: { argb: 'FF9C0006' } };
  r += 1;
  for (const note of s.needsConfirmation) {
    ws.getCell(r, 1).value = note;
    ws.getCell(r, 1).font = { ...FONT };
    r += 1;
  }

  if (model.issues.length > 0) {
    r += 1;
    ws.getCell(r, 1).value = 'Data quality';
    ws.getCell(r, 1).font = { ...FONT, bold: true };
    r += 1;
    for (const issue of model.issues) {
      ws.getCell(r, 1).value = issue.severity.toUpperCase();
      ws.getCell(r, 2).value = issue.code;
      ws.getCell(r, 3).value = issue.unit ?? '';
      ws.getCell(r, 4).value = issue.sourceRow ?? '';
      ws.getCell(r, 5).value = issue.message;
      r += 1;
    }
  }

  ws.getColumn(1).width = 18;
  ws.getColumn(2).width = 20;
  for (let c = 3; c <= 8; c += 1) ws.getColumn(c).width = 18;
  ws.getColumn(9).width = 10;
  ws.getColumn(10).width = 60;
}

// ---------------------------------------------------------------- Raw_AR

function writeRawData(wb: ExcelJS.Workbook, model: ReportModel): void {
  const reportDate = model.options.reportDate.replaceAll('-', '');
  const ws = wb.addWorksheet(`Raw_AR_${reportDate}`);

  const headers = [
    'Source row', 'ลำดับ', 'รหัสลูกค้า', 'ชื่อลูกค้า', 'ชื่อผู้ซื้อร่วม', 'แปลง/ห้อง',
    'แบบบ้าน/แบบห้อง', 'บ้านเลขที่', 'เลขที่สัญญา', 'ราคาขายตามสัญญา', 'เพิ่ม/ลด',
    'ราคาขายสุทธิ', 'ประเภทงวด', 'วันครบกำหนดชำระ', 'จำนวนเงินที่ต้องชำระ', 'วันที่ชำระ',
    'เลขที่ใบเสร็จ', 'จำนวนเงินที่ชำระแล้ว', 'จำนวนเงินคงเหลือ', 'Quota', 'พื้นที่/อาคาร',
  ];
  headers.forEach((label, index) => {
    const cell = ws.getCell(1, index + 1);
    cell.value = label;
    styleHeader(cell, COLOR.headerIdentity);
  });

  const rows: CustomerCardRow[] = model.contracts.flatMap((c) => c.rows);
  rows.sort((a, b) => a.sourceRow - b.sourceRow);

  rows.forEach((row, index) => {
    const r = 2 + index;
    const values = [
      row.sourceRow, row.sequence, row.customerCode, row.customerName, row.coBuyerName,
      row.unit, row.houseType, row.houseNo, row.contractNo, row.contractPrice,
      row.adjustment, row.netPrice, row.installmentType, row.dueDate, row.dueAmount,
      row.paidDate, row.receiptNo, row.paidAmount, row.outstanding, row.quota, row.area,
    ];
    values.forEach((value, c) => {
      const cell = ws.getCell(r, c + 1);
      cell.value = value ?? null;
      cell.font = { ...FONT };
      if (typeof value === 'number' && c >= 9) cell.numFmt = MONEY;
    });
  });

  ws.getColumn(4).width = 28;
  ws.getColumn(6).width = 12;
  ws.getColumn(9).width = 18;
  for (const c of [10, 12, 15, 18, 19]) ws.getColumn(c).width = 16;
  ws.getColumn(13).width = 16;
  ws.getColumn(14).width = 14;
  ws.getColumn(16).width = 14;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

/** Column widths matching the template: identity columns wide, months even. */
function setWidths(ws: ExcelJS.Worksheet, lastCol: number): void {
  const identity = [9, 13.5, 13, 12, 14, 11, 15, 15];
  identity.forEach((width, index) => {
    ws.getColumn(index + 1).width = width;
  });
  for (let c = identity.length; c <= lastCol; c += 1) {
    ws.getColumn(c + 1).width = 15;
  }
  ws.views = [{ state: 'frozen', xSplit: 7, ySplit: 5 }];
}
