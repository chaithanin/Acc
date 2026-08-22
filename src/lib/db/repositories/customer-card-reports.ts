import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, getDb, newId, nowIso, parseJson } from '../index';
import type { CheckRow, ReportIssue } from '@/lib/reports/customer-card/types';

/**
 * Customer Card reports that have been produced.
 *
 * Kept so Finance can find one again without re-running it against a card they
 * may no longer have — and so a figure someone queried in October can still be
 * traced to the file it came from.
 *
 * Every function here takes the company. The report is one company's list of
 * buyers and what they owe, and this table is reached from a page and an API
 * route that both take an id from the URL.
 */

/** Where the workbooks live. Under the data directory, never in the repo. */
export const REPORT_DIR = path.join(DATA_DIR, 'reports');

export interface StoredReport {
  id: string;
  companyId: string;
  projectLabel: string;
  reportDate: string;
  completionDate: string;
  maxUplift: number;
  sourceFileName: string;
  sourceHash: string;
  sourceRows: number;
  sheetName: string | null;
  headerRow: number | null;
  fileSize: number;
  contracts: number;
  units: number;
  totalSalePrice: number;
  totalExpected: number;
  totalPlan: number;
  totalPaid: number;
  totalOutstanding: number;
  totalInterest: number;
  okCount: number;
  checkCount: number;
  errorCount: number;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface StoredReportDetail extends StoredReport {
  checks: CheckRow[];
  issues: ReportIssue[];
  needsConfirmation: string[];
  /** False when the workbook has been removed from disk since. */
  fileExists: boolean;
}

interface Row {
  id: string; company_id: string; project_label: string; report_date: string;
  completion_date: string; max_uplift: number; source_file_name: string;
  source_hash: string; source_rows: number; sheet_name: string | null;
  header_row: number | null; stored_path: string; file_size: number;
  contracts: number; units: number; total_sale_price: number; total_expected: number;
  total_plan: number; total_paid: number; total_outstanding: number;
  total_interest: number; ok_count: number; check_count: number; error_count: number;
  checks_json: string; issues_json: string; confirm_json: string;
  created_by: string | null; created_at: string; user_name: string | null;
}

function toReport(row: Row): StoredReport {
  return {
    id: row.id,
    companyId: row.company_id,
    projectLabel: row.project_label,
    reportDate: row.report_date,
    completionDate: row.completion_date,
    maxUplift: row.max_uplift,
    sourceFileName: row.source_file_name,
    sourceHash: row.source_hash,
    sourceRows: row.source_rows,
    sheetName: row.sheet_name,
    headerRow: row.header_row,
    fileSize: row.file_size,
    contracts: row.contracts,
    units: row.units,
    totalSalePrice: row.total_sale_price,
    totalExpected: row.total_expected,
    totalPlan: row.total_plan,
    totalPaid: row.total_paid,
    totalOutstanding: row.total_outstanding,
    totalInterest: row.total_interest,
    okCount: row.ok_count,
    checkCount: row.check_count,
    errorCount: row.error_count,
    createdBy: row.created_by,
    createdByName: row.user_name,
    createdAt: row.created_at,
  };
}

const SELECT = `
  SELECT r.*, u.name AS user_name
    FROM customer_card_reports r
    LEFT JOIN users u ON u.id = r.created_by`;

export interface SaveReportInput {
  companyId: string;
  projectLabel: string;
  reportDate: string;
  completionDate: string;
  maxUplift: number;
  sourceFileName: string;
  sourceHash: string;
  sourceRows: number;
  sheetName: string;
  headerRow: number;
  workbook: Buffer;
  contracts: number;
  units: number;
  totalSalePrice: number;
  totalExpected: number;
  totalPlan: number;
  totalPaid: number;
  totalOutstanding: number;
  totalInterest: number;
  okCount: number;
  checkCount: number;
  errorCount: number;
  checks: CheckRow[];
  issues: ReportIssue[];
  needsConfirmation: string[];
  userId: string | null;
}

/**
 * Writes the workbook to disk and records it.
 *
 * The file is written first: a row pointing at a file that was never written
 * is a download that fails, whereas a file with no row is only wasted disk,
 * and the next save overwrites nothing because every id is fresh.
 */
export function saveReport(input: SaveReportInput): StoredReport {
  const id = newId();
  const storedPath = path.join(REPORT_DIR, `${id}.xlsx`);

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(storedPath, input.workbook);

  getDb()
    .prepare(
      `INSERT INTO customer_card_reports
         (id, company_id, project_label, report_date, completion_date, max_uplift,
          source_file_name, source_hash, source_rows, sheet_name, header_row,
          stored_path, file_size, contracts, units, total_sale_price, total_expected,
          total_plan, total_paid, total_outstanding, total_interest,
          ok_count, check_count, error_count,
          checks_json, issues_json, confirm_json, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id, input.companyId, input.projectLabel, input.reportDate, input.completionDate,
      input.maxUplift, input.sourceFileName, input.sourceHash, input.sourceRows,
      input.sheetName, input.headerRow, storedPath, input.workbook.length,
      input.contracts, input.units, input.totalSalePrice, input.totalExpected,
      input.totalPlan, input.totalPaid, input.totalOutstanding, input.totalInterest,
      input.okCount, input.checkCount, input.errorCount,
      JSON.stringify(input.checks), JSON.stringify(input.issues),
      JSON.stringify(input.needsConfirmation), input.userId, nowIso(),
    );

  return getReport(input.companyId, id)!;
}

export function listReports(companyId: string, limit = 100): StoredReport[] {
  return getDb()
    .prepare<[string, number], Row>(
      `${SELECT} WHERE r.company_id = ? ORDER BY r.created_at DESC LIMIT ?`,
    )
    .all(companyId, limit)
    .map(toReport);
}

/** One report, or null when it is not this company's. */
export function getReport(companyId: string, id: string): StoredReport | null {
  const row = getDb()
    .prepare<[string, string], Row>(`${SELECT} WHERE r.id = ? AND r.company_id = ?`)
    .get(id, companyId);

  return row ? toReport(row) : null;
}

export function getReportDetail(companyId: string, id: string): StoredReportDetail | null {
  const row = getDb()
    .prepare<[string, string], Row>(`${SELECT} WHERE r.id = ? AND r.company_id = ?`)
    .get(id, companyId);

  if (!row) return null;

  return {
    ...toReport(row),
    checks: parseJson<CheckRow[]>(row.checks_json, []),
    issues: parseJson<ReportIssue[]>(row.issues_json, []),
    needsConfirmation: parseJson<string[]>(row.confirm_json, []),
    fileExists: fs.existsSync(row.stored_path),
  };
}

/**
 * The workbook bytes, or null when the report is not this company's.
 *
 * The path is read from the row rather than built from the id, and checked to
 * be inside the report directory before anything is opened — the id reaches
 * this function from a URL.
 */
export function readReportFile(companyId: string, id: string): Buffer | null {
  const row = getDb()
    .prepare<[string, string], { stored_path: string }>(
      'SELECT stored_path FROM customer_card_reports WHERE id = ? AND company_id = ?',
    )
    .get(id, companyId);

  if (!row) return null;

  const resolved = path.resolve(row.stored_path);
  if (!resolved.startsWith(path.resolve(REPORT_DIR) + path.sep)) return null;
  if (!fs.existsSync(resolved)) return null;

  return fs.readFileSync(resolved);
}

/** Removes a report and its workbook. Returns false when it is not theirs. */
export function deleteReport(companyId: string, id: string): boolean {
  const db = getDb();
  const row = db
    .prepare<[string, string], { stored_path: string }>(
      'SELECT stored_path FROM customer_card_reports WHERE id = ? AND company_id = ?',
    )
    .get(id, companyId);

  if (!row) return false;

  db.prepare('DELETE FROM customer_card_reports WHERE id = ? AND company_id = ?').run(id, companyId);

  const resolved = path.resolve(row.stored_path);
  if (resolved.startsWith(path.resolve(REPORT_DIR) + path.sep)) {
    fs.rmSync(resolved, { force: true });
  }

  return true;
}
