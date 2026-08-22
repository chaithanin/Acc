import { cellText, excelRowNumber, getCell, parseDateCell, parseNumeric } from '@/lib/excel/cells';
import type { RawSheet } from '@/lib/excel/types';
import { containsPhrase, normalizeKey } from '@/lib/detect/normalize-text';
import type { CustomerCardRow, ReportIssue } from './types';

/**
 * Reading the customer card.
 *
 * The sheet is matched on its header wording rather than on column positions.
 * The sales system reorders columns between exports and between projects, and a
 * report keyed on "column H" is a report that silently reads the wrong figure
 * the first time somebody inserts a column.
 */

type Field =
  | 'sequence' | 'customerCode' | 'customerName' | 'coBuyerName' | 'unit'
  | 'houseType' | 'houseNo' | 'contractNo' | 'contractPrice' | 'adjustment'
  | 'netPrice' | 'installmentType' | 'dueDate' | 'dueAmount' | 'paidDate'
  | 'receiptNo' | 'paidAmount' | 'outstanding' | 'quota' | 'area';

/**
 * Header wording, most specific first.
 *
 * Order matters within a field: "ราคาขายสุทธิ" must be tried before
 * "ราคาขาย", or the net price would be claimed by the contract price.
 */
const HEADERS: { field: Field; phrases: string[] }[] = [
  { field: 'netPrice', phrases: ['ราคาขายสุทธิ', 'net selling price', 'net price'] },
  { field: 'contractPrice', phrases: ['ราคาขายตามสัญญา', 'ราคาตามสัญญา', 'contract price', 'ราคาขาย'] },
  { field: 'adjustment', phrases: ['เพิ่ม/ลด', 'เพิ่มลด', 'adjustment', 'เพิ่ม / ลด'] },
  { field: 'dueAmount', phrases: ['จำนวนเงินที่ต้องชำระ', 'เงินที่ต้องชำระ', 'amount due', 'due amount'] },
  { field: 'paidAmount', phrases: ['จำนวนเงินที่ชำระแล้ว', 'เงินที่ชำระแล้ว', 'amount paid', 'paid amount'] },
  { field: 'outstanding', phrases: ['จำนวนเงินคงเหลือ', 'เงินคงเหลือ', 'คงเหลือ', 'outstanding', 'balance'] },
  { field: 'dueDate', phrases: ['วันครบกำหนดชำระเงินตามสัญญา', 'วันครบกำหนดชำระ', 'ครบกำหนด', 'due date'] },
  { field: 'paidDate', phrases: ['วันที่ชำระ/ยกเลิก', 'วันที่ชำระ', 'วันที่รับเงิน', 'payment date', 'paid date'] },
  { field: 'receiptNo', phrases: ['เลขที่ใบเสร็จ', 'ใบเสร็จ', 'receipt no', 'receipt'] },
  { field: 'contractNo', phrases: ['เลขที่สัญญา', 'contract no', 'contract number'] },
  { field: 'installmentType', phrases: ['ประเภทงวด', 'งวดที่', 'installment type', 'period type'] },
  { field: 'unit', phrases: ['แปลง/ห้อง', 'แปลง / ห้อง', 'ห้องเลขที่', 'แปลง', 'ห้อง', 'unit', 'room'] },
  { field: 'houseType', phrases: ['แบบบ้าน/แบบห้อง', 'แบบบ้าน', 'แบบห้อง', 'house type', 'unit type'] },
  { field: 'houseNo', phrases: ['บ้านเลขที่', 'house no'] },
  { field: 'customerCode', phrases: ['รหัสลูกค้า', 'customer code'] },
  { field: 'coBuyerName', phrases: ['ชื่อผู้ซื้อร่วม', 'ผู้ซื้อร่วม', 'co-buyer', 'co buyer'] },
  { field: 'customerName', phrases: ['ชื่อลูกค้า', 'ชื่อ-สกุล', 'customer name', 'customer'] },
  { field: 'quota', phrases: ['quota', 'โควต้า', 'โควตา'] },
  { field: 'area', phrases: ['พื้นที่/อาคาร', 'พื้นที่', 'อาคาร', 'area', 'building'] },
  { field: 'sequence', phrases: ['ลำดับ', 'ลําดับ', 'no.', 'item'] },
];

export interface ParsedCard {
  rows: CustomerCardRow[];
  issues: ReportIssue[];
  /** Which column each field was found in, for the audit trail. */
  columns: Partial<Record<Field, number>>;
  headerRow: number;
}

/**
 * Finds the header row: the one that matches the most distinct fields.
 *
 * Customer-card exports carry two or three title rows above the header, and
 * some carry a second header band further down where the report breaks by
 * building. Scoring every row and taking the best avoids hard-coding "row 5".
 */
function findHeaderRow(sheet: RawSheet): { row: number; columns: Partial<Record<Field, number>> } {
  let best = { row: -1, columns: {} as Partial<Record<Field, number>>, score: 0 };
  const limit = Math.min(sheet.rowCount, 40);

  for (let r = 0; r < limit; r += 1) {
    const columns: Partial<Record<Field, number>> = {};
    const claimed = new Set<number>();

    for (const { field, phrases } of HEADERS) {
      if (columns[field] !== undefined) continue;

      for (let c = 0; c < sheet.colCount; c += 1) {
        if (claimed.has(c)) continue;
        const text = cellText(getCell(sheet, r, c));
        if (!text) continue;
        if (!phrases.some((p) => containsPhrase(text, p))) continue;

        columns[field] = c;
        claimed.add(c);
        break;
      }
    }

    const score = Object.keys(columns).length;
    if (score > best.score) best = { row: r, columns, score };
  }

  return { row: best.row, columns: best.columns };
}

/** The fields without which the report cannot be built at all. */
const REQUIRED: Field[] = ['unit', 'dueAmount'];

export function parseCustomerCard(sheet: RawSheet): ParsedCard {
  const issues: ReportIssue[] = [];
  const { row: headerRow, columns } = findHeaderRow(sheet);

  if (headerRow === -1) {
    return {
      rows: [],
      issues: [{
        severity: 'error',
        code: 'NO_HEADER',
        message: `No customer-card header was found in "${sheet.name}". Expected columns such as แปลง/ห้อง, เลขที่สัญญา and จำนวนเงินที่ต้องชำระ.`,
      }],
      columns: {},
      headerRow: -1,
    };
  }

  const missing = REQUIRED.filter((f) => columns[f] === undefined);
  if (missing.length > 0) {
    issues.push({
      severity: 'error',
      code: 'MISSING_COLUMNS',
      message: `"${sheet.name}" is missing required columns: ${missing.join(', ')}.`,
    });
  }

  const text = (r: number, field: Field): string | null => {
    const c = columns[field];
    if (c === undefined) return null;
    const value = cellText(getCell(sheet, r, c)).trim();
    return value === '' ? null : value;
  };

  const number = (r: number, field: Field): number | null => {
    const c = columns[field];
    if (c === undefined) return null;
    const parsed = parseNumeric(getCell(sheet, r, c));
    return parsed.value;
  };

  const date = (r: number, field: Field): string | null => {
    const c = columns[field];
    if (c === undefined) return null;
    return parseDateCell(getCell(sheet, r, c));
  };

  const rows: CustomerCardRow[] = [];
  // The unit and the contract are printed once per block and left blank on the
  // instalment lines beneath. Carrying them down is what makes one unit's
  // instalments a group rather than a dozen unidentified rows.
  let lastUnit: string | null = null;
  let lastContract: string | null = null;
  let lastCustomer: string | null = null;
  let lastNet: number | null = null;
  let lastContractPrice: number | null = null;

  for (let r = headerRow + 1; r < sheet.rowCount; r += 1) {
    // A new unit ends the previous one's block. Without this the last unit's
    // contract price and customer name carry into the next unit wherever that
    // unit leaves them blank — which puts one buyer's price on another's
    // contract, silently.
    const ownUnit = text(r, 'unit');
    if (ownUnit && ownUnit !== lastUnit) {
      lastContract = null;
      lastCustomer = null;
      lastNet = null;
      lastContractPrice = null;
    }

    const unit = ownUnit ?? lastUnit;
    const contractNo = text(r, 'contractNo') ?? lastContract;
    const customerName = text(r, 'customerName') ?? lastCustomer;
    const netPrice = number(r, 'netPrice') ?? lastNet;
    const contractPrice = number(r, 'contractPrice') ?? lastContractPrice;

    const dueAmount = number(r, 'dueAmount');
    const paidAmount = number(r, 'paidAmount');
    const installmentType = text(r, 'installmentType');
    const dueDate = date(r, 'dueDate');
    const paidDate = date(r, 'paidDate');

    // A row with no money and no dates on it is a spacer, a subtotal or the
    // repeated header of the next page — not an instalment.
    const hasSubstance =
      dueAmount !== null || paidAmount !== null || dueDate !== null || paidDate !== null;

    if (ownUnit) lastUnit = ownUnit;
    if (text(r, 'contractNo')) lastContract = text(r, 'contractNo');
    if (text(r, 'customerName')) lastCustomer = text(r, 'customerName');
    if (number(r, 'netPrice') !== null) lastNet = number(r, 'netPrice');
    if (number(r, 'contractPrice') !== null) lastContractPrice = number(r, 'contractPrice');

    if (!hasSubstance) continue;
    if (!unit) {
      issues.push({
        severity: 'warning',
        code: 'ROW_WITHOUT_UNIT',
        message: 'A row carries amounts but names no unit, and was left out of the report.',
        sourceRow: excelRowNumber(sheet, r),
      });
      continue;
    }

    // A repeated header band inside the data reads as a row of labels.
    if (isRepeatedHeader(unit, installmentType)) continue;

    rows.push({
      sourceRow: excelRowNumber(sheet, r),
      sequence: text(r, 'sequence'),
      customerCode: text(r, 'customerCode'),
      customerName,
      coBuyerName: text(r, 'coBuyerName'),
      unit,
      houseType: text(r, 'houseType'),
      houseNo: text(r, 'houseNo'),
      contractNo,
      contractPrice,
      adjustment: number(r, 'adjustment'),
      netPrice,
      installmentType,
      dueDate,
      dueAmount,
      paidDate,
      receiptNo: text(r, 'receiptNo'),
      paidAmount,
      outstanding: number(r, 'outstanding'),
      quota: text(r, 'quota'),
      area: text(r, 'area'),
    });
  }

  if (rows.length === 0) {
    issues.push({
      severity: 'error',
      code: 'NO_ROWS',
      message: `"${sheet.name}" has a customer-card header but no instalment rows beneath it.`,
    });
  }

  return { rows, issues, columns, headerRow: excelRowNumber(sheet, headerRow) };
}

/** A header band repeated mid-sheet, recognised by its own labels. */
function isRepeatedHeader(unit: string, installmentType: string | null): boolean {
  const key = normalizeKey(unit);
  if (key === normalizeKey('แปลง/ห้อง') || key === normalizeKey('unit')) return true;
  if (installmentType && normalizeKey(installmentType) === normalizeKey('ประเภทงวด')) return true;
  return false;
}

/** Picks the sheet most likely to be the customer card. */
export function pickCustomerCardSheet(sheets: RawSheet[]): RawSheet | null {
  let best: { sheet: RawSheet; score: number } | null = null;

  for (const sheet of sheets) {
    const { columns } = findHeaderRow(sheet);
    const score = Object.keys(columns).length;
    if (score < 4) continue;
    if (!best || score > best.score) best = { sheet, score };
  }

  return best?.sheet ?? null;
}
