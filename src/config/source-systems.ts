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
