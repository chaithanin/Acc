import { CUSTOMER_CARD_SOURCE } from '@/config/source-systems';
import { readWorkbook } from '@/lib/excel/read';
import { buildReport } from './build';
import { parseCustomerCard, pickCustomerCardSheet } from './parse';
import { writeReportWorkbook } from './workbook';
import { DEFAULT_OPTIONS, type ReportModel, type ReportOptions } from './types';

export { DEFAULT_OPTIONS };
export type { ReportModel, ReportOptions, ReportSummary, CheckRow, ReportIssue } from './types';
export { buildReport } from './build';
export { parseCustomerCard, pickCustomerCardSheet } from './parse';
export { writeReportWorkbook } from './workbook';

export interface GenerateResult {
  model: ReportModel;
  workbook: Buffer;
  /** The sheet the customer card was read from, for the audit trail. */
  sheetName: string;
  /** The row the header was found on, 1-based. */
  headerRow: number;
}

/**
 * Customer card in, Interest / Advance-received workbook out.
 *
 * Throws only when the file cannot be read at all. Everything the data gets
 * wrong is reported inside the workbook — on Data_Check and in the summary —
 * rather than raised, because an import that refuses to produce anything tells
 * Finance nothing about which unit is wrong.
 */
export async function generateCustomerCardReport(
  filePath: string,
  fileName: string,
  options: Partial<ReportOptions> & Pick<ReportOptions, 'projectLabel' | 'reportDate'>,
): Promise<GenerateResult> {
  const workbook = await readWorkbook(filePath, fileName);
  const sheet = pickCustomerCardSheet(workbook.sheets);

  if (!sheet) {
    // Naming the report is the useful part of this message. The usual cause is
    // the wrong export — a summary rather than a card — and "no sheet found"
    // on its own sends people looking for a fault in the file they have.
    throw new Error(
      `"${fileName}" does not look like a customer card. Export "${CUSTOMER_CARD_SOURCE.reportName}" from ${CUSTOMER_CARD_SOURCE.system} as .xlsx — it needs the columns แปลง/ห้อง, เลขที่สัญญา, วันครบกำหนดชำระเงินตามสัญญา and จำนวนเงินที่ต้องชำระ.`,
    );
  }

  const parsed = parseCustomerCard(sheet);
  const resolved: ReportOptions = { ...DEFAULT_OPTIONS, ...options };

  const model = buildReport(parsed.rows, resolved);
  model.issues.unshift(...parsed.issues);

  if (model.contracts.length === 0) {
    throw new Error(
      `"${sheet.name}" produced no contracts. ${parsed.issues.map((i) => i.message).join(' ')}`.trim(),
    );
  }

  return {
    model,
    workbook: await writeReportWorkbook(model),
    sheetName: sheet.name,
    headerRow: parsed.headerRow,
  };
}
