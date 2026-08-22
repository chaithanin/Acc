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
  // The real export labels this column simply "งวด", under a "กำหนดชำระเงิน"
  // band. Tried after the date and amount fields so it cannot claim theirs.
  { field: 'installmentType', phrases: ['ประเภทงวด', 'งวดที่', 'งวด', 'installment type', 'period type'] },
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
  /** How many rows the header spanned. */
  headerDepth: number;
}

/** How many consecutive rows a header may be spread over. */
const HEADER_DEPTH = 3;

/**
 * Finds the header, which is not always one row.
 *
 * The real export writes a banded header: "กำหนดชำระเงิน" and "การชำระเงิน"
 * sit on one row spanning several columns, and the columns they name —
 * "งวด", "วันครบกำหนดชำระเงินตามสัญญา", "จำนวนเงินที่ต้องชำระ" — sit on the
 * next. Scoring a single row finds thirteen of the twenty fields and declares
 * the file unreadable for want of the other seven.
 *
 * So a window of consecutive rows is scored together, and the deepest row in
 * the window is read first: the band above says which group a column belongs
 * to, the row beneath says what the column actually is, and the second is
 * always the more specific of the two.
 */
function findHeaderRow(sheet: RawSheet): {
  row: number;
  columns: Partial<Record<Field, number>>;
  depth: number;
} {
  let best = {
    row: -1,
    columns: {} as Partial<Record<Field, number>>,
    depth: HEADER_DEPTH + 1,
    score: 0,
  };

  const limit = Math.min(sheet.rowCount, 40);

  for (let r = 0; r < limit; r += 1) {
    for (let depth = 1; depth <= HEADER_DEPTH && r + depth <= sheet.rowCount; depth += 1) {
      const columns: Partial<Record<Field, number>> = {};
      const claimed = new Set<number>();

      // Deepest row first — it holds the specific labels.
      for (let offset = depth - 1; offset >= 0; offset -= 1) {
        for (const { field, phrases } of HEADERS) {
          if (columns[field] !== undefined) continue;

          for (let c = 0; c < sheet.colCount; c += 1) {
            if (claimed.has(c)) continue;
            const text = cellText(getCell(sheet, r + offset, c));
            if (!text) continue;
            if (!phrases.some((p) => containsPhrase(text, p))) continue;

            columns[field] = c;
            claimed.add(c);
            break;
          }
        }
      }

      const score = Object.keys(columns).length;

      // More fields always wins. Between windows that find the same fields,
      // the shallower one wins and then the later one: a three-row window
      // starting above the title finds exactly what the two-row header does,
      // and taking it would treat the header itself as data.
      const better =
        score > best.score ||
        (score === best.score && depth < best.depth) ||
        (score === best.score && depth === best.depth && r > best.row);

      if (better) best = { row: r, columns, depth, score };
    }
  }

  return { row: best.row, columns: best.columns, depth: best.depth };
}

/** The fields without which the report cannot be built at all. */
const REQUIRED: Field[] = ['unit', 'dueAmount'];

export function parseCustomerCard(sheet: RawSheet): ParsedCard {
  const issues: ReportIssue[] = [];
  const { row: headerRow, columns, depth } = findHeaderRow(sheet);

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
      headerDepth: 0,
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
  let lastRoom: string | null = null;
  let lastArea: string | null = null;

  for (let r = headerRow + depth; r < sheet.rowCount; r += 1) {
    // The grand total is the last line of the report and carries the whole
    // project's figures. The unit and contract are blank on it, so without
    // this it inherits them from the last contract above and adds nine hundred
    // million baht to that one unit.
    if (isTotalRow(sheet, r)) {
      issues.push({
        severity: 'info',
        code: 'TOTAL_ROW_SKIPPED',
        message: `The report's own total line was found on row ${excelRowNumber(sheet, r)} and left out. Everything below it is a footer.`,
        sourceRow: excelRowNumber(sheet, r),
      });
      break;
    }

    // A new unit ends the previous one's block. Without this the last unit's
    // contract price and customer name carry into the next unit wherever that
    // unit leaves them blank — which puts one buyer's price on another's
    // contract, silently.
    const ownRoom = text(r, 'unit');
    const ownArea = text(r, 'area');
    const ownUnit = ownRoom ? composeUnit(ownRoom, ownArea ?? lastArea) : null;
    if (ownUnit && ownUnit !== lastUnit) {
      lastContract = null;
      lastCustomer = null;
      lastNet = null;
      lastContractPrice = null;
    }

    const unit = ownUnit ?? lastUnit;
    const room = ownRoom ?? lastRoom;
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
    if (ownRoom) lastRoom = ownRoom;
    if (ownArea) lastArea = ownArea;
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
      room,
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
      area: ownArea ?? lastArea,
    });
  }

  if (rows.length === 0) {
    issues.push({
      severity: 'error',
      code: 'NO_ROWS',
      message: `"${sheet.name}" has a customer-card header but no instalment rows beneath it.`,
    });
  }

  return {
    rows,
    issues,
    columns,
    headerRow: excelRowNumber(sheet, headerRow),
    headerDepth: depth,
  };
}

/** Labels a report puts on its own total line. */
const TOTAL_LABELS = ['รวม', 'รวมทั้งสิ้น', 'ยอดรวม', 'total', 'grand total'];

/**
 * The report's own total line, recognised by its label rather than by where it
 * sits — some exports repeat one per building.
 *
 * Only the first few columns are looked at: "รวม" appears inside plenty of
 * legitimate text further along the row, and matching it there would throw
 * away real instalments.
 */
function isTotalRow(sheet: RawSheet, r: number): boolean {
  for (let c = 0; c < Math.min(sheet.colCount, 4); c += 1) {
    const text = cellText(getCell(sheet, r, c)).trim();
    if (!text) continue;
    const key = normalizeKey(text);
    if (TOTAL_LABELS.some((label) => normalizeKey(label) === key)) return true;
  }
  return false;
}

/**
 * The unit as the report names it: building letter and room number together.
 *
 * The card gives them in two columns — "103" and "อาคาร A" — and 163 room
 * numbers are shared across four buildings, so the room number alone names
 * four different flats. The existing report writes them as "A103", and so does
 * this.
 */
export function composeUnit(room: string, area: string | null): string {
  const trimmed = room.trim();
  if (!area) return trimmed;

  // The last word of "อาคาร A" / "Building B" / "Tower 2" is the building.
  const token = area.trim().split(/\s+/).pop() ?? '';
  if (!token || token.length > 3) return trimmed;
  if (normalizeKey(trimmed).startsWith(normalizeKey(token))) return trimmed;

  return `${token}${trimmed}`;
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
