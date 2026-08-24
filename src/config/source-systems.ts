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
   * Where it sits in the menu.
   *
   * Null until somebody who uses the system confirms it. A wrong path is
   * worse than none: it sends people looking in the wrong place and then
   * doubting the rest of the instructions.
   */
  menuPath: string | null;
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
  menuPath: null,
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
