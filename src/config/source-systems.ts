/**
 * Where the source files come from.
 *
 * Finance exports these by hand from the accounting system, and "which report,
 * with which options" is the single most common way an import goes wrong — a
 * summary instead of a card, a date range that stops short, a PDF instead of a
 * workbook. Naming the report and its settings here puts the answer on the
 * page that needs it rather than in somebody's memory.
 *
 * Everything below is read off a real export: the report title, the date line
 * and the column headings all appear in the file itself.
 */

export interface SourceReportGuide {
  /** The system it comes out of. */
  system: string;
  url: string;
  /** The report's own name, exactly as it prints at the top of the export. */
  reportName: string;
  /**
   * The system's own code for it.
   *
   * The one unambiguous handle: this report appears at two different numbers
   * in two different menus, and the code is the same in both.
   */
  reportCode?: string;
  /** Where it sits in the menu, as the menu itself is worded. */
  menuPath: string | null;
  /**
   * The report next to it that is not the one.
   *
   * Named because it is one line away in the same menu and reads almost the
   * same. Picking it produces a file that parses and is wrong, which is the
   * worst kind.
   */
  notThis?: { name: string; why: string };
  /** What to set before exporting. */
  settings: { label: string; value: string }[];
  /** Column headings the importer needs to find. */
  requiredColumns: string[];
  /** The first lines of a correct export, so a wrong file is obvious. */
  looksLike: string[];
}

export const CUSTOMER_CARD_SOURCE: SourceReportGuide = {
  system: 'Mango Anywhere',
  url: 'https://chaithanin.mangoanywhere.com/production.re/',
  reportName: 'รายงานการ์ดลูกค้า ตามสัญญา',
  reportCode: 'RE_RPT_070306_1',
  menuPath: 'รายงานฝ่ายการเงิน → 6. รายงานการ์ดลูกค้า → 6.1 รายงานการ์ดลูกค้า ตามสัญญา',
  notThis: {
    name: '6.2 รายงานการ์ดลูกค้า ตามรายชื่อลูกค้า (RE_RPT_070306_2)',
    why: 'the line directly below it in the same menu. It groups the card by customer name; this report needs it by contract, which is what makes one unit one row.',
  },
  settings: [
    { label: 'บริษัท', value: 'the company the report is for — SUN9 is บริษัท เดอะ ซัน ไลท์ เรสซิเด้นซ์ 9 จำกัด' },
    { label: 'ประจำวันที่ – ถึง', value: 'leave the start empty and set the end to the as-at date, so the card carries every instalment from the beginning' },
    { label: 'รูปแบบไฟล์', value: 'Excel (.xlsx) — not PDF, and not CSV' },
  ],
  requiredColumns: [
    'แปลง/ห้อง',
    'พื้นที่/อาคาร',
    'เลขที่สัญญา',
    'ราคาขายสุทธิ',
    'งวด',
    'วันครบกำหนดชำระเงินตามสัญญา',
    'จำนวนเงินที่ต้องชำระ',
    'วันที่ชำระ/ยกเลิก',
    'เลขที่ใบเสร็จ/ยกเลิก',
    'จำนวนเงินที่ชำระแล้ว',
    'จำนวนเงินคงเหลือที่ต้องชำระ',
  ],
  looksLike: [
    'บริษัท เดอะ ซัน ไลท์ เรสซิเด้นซ์ 9 จำกัด',
    'รายงานการ์ดลูกค้า ตามสัญญา',
    'ประจำวันที่ - ถึง 22/08/2026',
    'ลำดับ · รหัสลูกค้า · ชื่อลูกค้า · … · กำหนดชำระเงิน · การชำระเงิน',
    'งวด · วันครบกำหนดชำระเงินตามสัญญา · จำนวนเงินที่ต้องชำระ · …',
  ],
};


// ---------------------------------------------------------------------------
// What the import needs, and where each piece now comes from
// ---------------------------------------------------------------------------

/**
 * One kind of data the dashboard runs on.
 *
 * The list exists because the answer changed and nobody would know. Three of
 * these used to be exported by hand every month and are now read straight out
 * of Mango; uploading them as well would file the same balances twice, which is
 * the double count the reconciliation rules exist to catch. The rest still come
 * out of somebody's hands, and which report to run is the single most common
 * way an import goes wrong.
 *
 * Where a report's exact name has been read off a real export it is given.
 * Where it has not, that is said rather than guessed: a plausible-looking menu
 * path that turns out to be the next report down produces a file that parses
 * and is wrong.
 */
export interface ImportSource {
  /** What the dashboard needs. */
  data: string;
  /** Which screens depend on it. */
  feeds: string;
  /** How it arrives now. */
  via:
    | { kind: 'pull'; command: string; system: string; note?: string }
    | { kind: 'upload'; system: string; reportName?: string; menuPath?: string; note?: string };
}

export const IMPORT_SOURCES: ImportSource[] = [
  // ----------------------------------------------- no longer uploaded by hand
  {
    data: 'Customer balances — what each customer owes',
    feeds: 'Receivables, the group view, liquidity',
    via: {
      kind: 'pull',
      command: 'npm run anywhere:pull -- --company <code>',
      system: 'Mango Anywhere',
      note: 'Replaces the receivable workbook. Mango answers a balance and an ageing '
        + 'grade but no due dates, so these sit in the ageing report\u2019s undated bucket — '
        + 'if the buckets matter more than the freshness, keep uploading the workbook '
        + 'instead and take only the other two from Mango.',
    },
  },
  {
    data: 'Supplier balances — what the company owes',
    feeds: 'Payables, liquidity ratios',
    via: {
      kind: 'pull',
      command: 'npm run anywhere:pull -- --company <code>',
      system: 'Mango Anywhere',
      note: 'Replaces the payable workbook.',
    },
  },
  {
    data: 'Bank balances',
    feeds: 'Cash position, the balance sheet',
    via: {
      kind: 'pull',
      command: 'npm run anywhere:pull -- --company <code>',
      system: 'Mango Anywhere',
      note: 'Guarantees are reported separately and are not counted as cash. Mango returns '
        + 'these the accounting way round, so the sign has to be confirmed once against one '
        + 'account in its own screen — pass --flip-bank-sign after that.',
    },
  },
  {
    data: 'The sales ledger — bookings, contracts, transfers, receipts',
    feeds: 'Revenue recognition, the customer card, sales targets',
    via: {
      kind: 'pull',
      command: 'npm run mango:pull -- --company <code>',
      system: 'Mango RE',
      note: 'Which receipt kinds count as payment of the contract price is an accounting '
        + 'decision the pull asks for and will not guess: --payment-kinds B,C,D,T.',
    },
  },
  {
    data: 'Unit inventory and list prices',
    feeds: 'Total sale value per project, take-up',
    via: {
      kind: 'pull',
      command: 'npm run booking:pull -- --company <code>',
      system: 'Booking',
      note: 'Needs an API key for this system only. Until then the total sale value is '
        + 'typed in by hand in Settings \u203a Projects.',
    },
  },

  // --------------------------------------------------- still exported by hand
  {
    data: 'General ledger',
    feeds: 'Income and expense, the income statement, every account-level figure',
    via: {
      kind: 'upload',
      system: 'Mango Anywhere',
      reportName: 'Posted and Unposted GL Report',
      note: 'The period is read from the report\u2019s own Date range, not from the print '
        + 'timestamp, so a report printed today for last month files itself correctly. '
        + 'The ledger is stored in full for the audit trail and summarised by account '
        + 'for the figures, so it is never counted twice.',
    },
  },
  {
    data: 'Cash flow statement',
    feeds: 'Cash flow by kind, the projection',
    via: {
      kind: 'upload',
      system: 'Mango Anywhere',
      note: 'Either shape is read: one row per month, or months across the columns with '
        + 'INFLOW / OUTFLOW / CASH BALANCE blocks down the side. Where the sheet states '
        + 'its own totals those are used rather than the sum of the lines.',
    },
  },
  {
    data: 'BOQ — the bill of quantities',
    feeds: 'Construction cost, committed cost, project profitability',
    via: {
      kind: 'upload',
      system: 'the quantity surveyor, or Mango Anywhere',
      note: 'Item lists and month-per-column matrices are both read. The report name has '
        + 'not been recorded from a real export yet.',
    },
  },
  {
    data: 'WIP — work in progress',
    feeds: 'Construction progress against cost',
    via: {
      kind: 'upload',
      system: 'the quantity surveyor, or Mango Anywhere',
      note: 'The report name has not been recorded from a real export yet.',
    },
  },
  {
    data: 'Budget — the cost budget per project',
    feeds: 'Budget variance, revenue recognition',
    via: {
      kind: 'upload',
      system: 'typed in by hand',
      note: 'Settings \u203a Projects & Aliases. No source system returns it, so nothing '
        + 'overwrites it: both pulls leave the cost budget alone deliberately.',
    },
  },
];
