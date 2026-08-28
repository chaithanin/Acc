import { calculateMetrics } from '@/lib/calc/kpi';
import { CounterpartyResolver } from '@/lib/consolidate/counterparty';
import { filterByProject, indexSourceRefs, projectIdsIn } from '@/lib/calc/aggregate';
import type { ParsedFileResult } from '@/lib/import/pipeline';
import type { RawSheet } from '@/lib/excel/types';
import { cellText } from '@/lib/excel/cells';
import { runValidations } from '@/lib/validate/rules';
import {
  emptyDataset,
  mergeDatasets,
  type ImportIssue,
  type Metric,
  type NormalizedDataset,
  type SourceRef,
  type ValidationResult,
} from '@/lib/types';
import { getDb, newId, nowIso, parseJson, toDbBool, transaction } from '../index';

/**
 * Import persistence.
 *
 * Everything for one import lands in a single transaction: if any part fails,
 * no half-written snapshot is left behind for the dashboard to read.
 */

/** Raw rows kept per sheet for the Data Inspector. Full sheets would bloat the DB. */
const RAW_ROW_SAMPLE_LIMIT = 500;

export interface PersistImportArgs {
  /** Company this import belongs to. Every record it writes carries it. */
  companyId: string;
  reportDate: string;
  label: string | null;
  userId: string | null;
  files: ParsedFileResult[];
  issues: ImportIssue[];
  /** 'replace' retires the existing snapshot for this report date. */
  mode: 'new' | 'replace';
}

export interface PersistImportResult {
  importId: string;
  snapshotId: string;
  rowCount: number;
  metricCount: number;
  validationCount: number;
  warningCount: number;
  errorCount: number;
}

export function persistImport(args: PersistImportArgs): PersistImportResult {
  const db = getDb();

  return transaction(() => {
    const importId = newId();
    const snapshotId = newId();
    const now = nowIso();

    const allIssues: ImportIssue[] = [...args.issues, ...args.files.flatMap((f) => f.issues)];
    const warningCount = allIssues.filter((i) => i.severity === 'warning').length;
    const errorCount = allIssues.filter((i) => i.severity === 'error').length;

    // Retiring the previous snapshot keeps history intact — nothing is deleted.
    //
    // "Current" is one per company per report date, not one per report date.
    // Month-end is month-end for every company, so an unscoped retire would
    // have each company's import switch off the others' live snapshots — six
    // dashboards going blank because a seventh was uploaded.
    let replacesImportId: string | null = null;
    if (args.mode === 'replace') {
      const previous = db
        .prepare<[string, string], { id: string; import_id: string }>(
          `SELECT id, import_id FROM financial_snapshots
            WHERE report_date = ? AND company_id = ? AND is_current = 1
            ORDER BY created_at DESC LIMIT 1`,
        )
        .get(args.reportDate, args.companyId);

      if (previous) {
        replacesImportId = previous.import_id;
        db.prepare('UPDATE financial_snapshots SET is_current = 0 WHERE id = ?').run(previous.id);
      }
    } else {
      // A new version for the same date still becomes the live one.
      db.prepare(
        'UPDATE financial_snapshots SET is_current = 0 WHERE report_date = ? AND company_id = ?',
      ).run(args.reportDate, args.companyId);
    }

    db.prepare(
      `INSERT INTO imports
         (id, company_id, report_date, label, status, uploaded_by, file_count, row_count,
          warning_count, error_count, notes, replaces_import_id, created_at, completed_at)
       VALUES (?, ?, ?, ?, 'processing', ?, ?, 0, ?, ?, NULL, ?, ?, NULL)`,
    ).run(
      importId,
      args.companyId,
      args.reportDate,
      args.label,
      args.userId,
      args.files.length,
      warningCount,
      errorCount,
      replacesImportId,
      now,
    );

    db.prepare(
      `INSERT INTO financial_snapshots
         (id, import_id, company_id, report_date, label, is_current, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    ).run(snapshotId, importId, args.companyId, args.reportDate, args.label, now);

    // ------------------------------------------------ files, sheets, raw rows
    const fileIdByName = new Map<string, string>();

    const insertFile = db.prepare(
      `INSERT INTO import_files
         (id, import_id, file_name, original_name, stored_path, file_hash, file_size, file_type,
          container_file, project_id, detected_project_label, report_type, report_date,
          sheet_count, row_count, status, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const file of args.files) {
      const fileId = newId();
      fileIdByName.set(file.fileName, fileId);

      insertFile.run(
        fileId,
        importId,
        file.fileName,
        file.originalName,
        file.filePath,
        file.hash,
        file.size,
        file.fileType,
        file.containerFile,
        file.project.projectId,
        file.project.projectName ?? file.project.matchedAlias,
        file.reportType,
        file.reportDate,
        file.sheetCount,
        file.rowCount,
        file.status,
        file.error,
        now,
      );

      persistSheetDetections(importId, fileId, file, now);
      if (file.rawSheets) persistRawRows(importId, fileId, file.rawSheets, now);
    }

    // ----------------------------------------- normalized data + source refs
    let data: NormalizedDataset = emptyDataset();
    for (const file of args.files) data = mergeDatasets(data, file.data);

    const refs = indexSourceRefs(data);
    const refIds = persistSourceRefs(importId, refs, args.files, fileIdByName, now);

    const rowCount = persistRecords(db, snapshotId, importId, args.reportDate, data, refIds, args.companyId);

    // ------------------------------------------------- metrics + validations
    const projectIds = projectIdsIn(data);
    let metricCount = 0;
    let validationCount = 0;

    // The group-wide roll-up is stored with a null project id.
    const scopes: (string | null)[] = [null, ...projectIds];

    for (const projectId of scopes) {
      const scoped = filterByProject(data, projectId);
      const calc = calculateMetrics(scoped, args.reportDate);
      metricCount += persistMetrics(
        snapshotId, importId, projectId, args.companyId, args.reportDate, calc.metrics, refIds, now,
      );

      const validations = runValidations(scoped, calc, projectId);
      validationCount += persistValidations(snapshotId, importId, validations, refIds, now);
    }

    persistIssues(importId, allIssues, fileIdByName, now);

    db.prepare(
      `UPDATE imports SET status = 'completed', row_count = ?, completed_at = ? WHERE id = ?`,
    ).run(rowCount, nowIso(), importId);

    return {
      importId,
      snapshotId,
      rowCount,
      metricCount,
      validationCount,
      warningCount,
      errorCount,
    };
  });
}

function persistSheetDetections(
  importId: string,
  fileId: string,
  file: ParsedFileResult,
  now: string,
): void {
  const stmt = getDb().prepare(
    `INSERT INTO sheet_detections
       (id, import_id, import_file_id, sheet_name, sheet_index, report_type, confidence,
        header_row, column_map_json, detected_headers_json, scores_json, template_id,
        row_count, parsed_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const sheet of file.sheets) {
    stmt.run(
      newId(),
      importId,
      fileId,
      sheet.sheetName,
      sheet.sheetIndex,
      sheet.reportType,
      sheet.confidence,
      sheet.headerRow,
      JSON.stringify(sheet.columns),
      JSON.stringify(sheet.headers),
      JSON.stringify(sheet.scores),
      sheet.templateId,
      sheet.rowCount,
      sheet.parsedCount,
      now,
    );
  }
}

function persistRawRows(importId: string, fileId: string, sheets: RawSheet[], now: string): void {
  const stmt = getDb().prepare(
    `INSERT INTO raw_rows (id, import_id, import_file_id, sheet_name, row_number, cells_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  for (const sheet of sheets) {
    const limit = Math.min(sheet.rowCount, RAW_ROW_SAMPLE_LIMIT);
    for (let r = 0; r < limit; r += 1) {
      const row = sheet.rows[r];
      if (!row || row.length === 0) continue;
      // Store display text only: the inspector shows what a reviewer would see,
      // and full cell objects would multiply the row count by their metadata.
      const cells = row.map((cell) => (cell ? cellText(cell) : ''));
      if (cells.every((c) => c === '')) continue;
      stmt.run(newId(), importId, fileId, sheet.name, sheet.originRow + r + 1, JSON.stringify(cells));
    }
  }
}

/** Writes the reference table and returns ids positionally aligned with `refs`. */
function persistSourceRefs(
  importId: string,
  refs: SourceRef[],
  files: ParsedFileResult[],
  fileIdByName: Map<string, string>,
  now: string,
): string[] {
  const stmt = getDb().prepare(
    `INSERT INTO source_references
       (id, import_id, import_file_id, source_file, source_sheet, source_row, source_col,
        source_cell, source_formula, raw_value, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const formulaLookup = buildFormulaLookup(files);

  return refs.map((ref) => {
    const id = newId();
    const key = `${ref.file} ${ref.sheet ?? ''} ${ref.cell ?? ''}`;
    const found = formulaLookup.get(key);

    stmt.run(
      id,
      importId,
      fileIdByName.get(ref.file) ?? null,
      ref.file,
      ref.sheet,
      ref.row,
      ref.col,
      ref.cell,
      found?.formula ?? null,
      found?.text ?? null,
      now,
    );
    return id;
  });
}

/**
 * Indexes the formula and displayed text of every cell that a record points at,
 * so the drill-down can show "this came from =SUM(D4:D19)" rather than only a
 * cell address.
 */
function buildFormulaLookup(files: ParsedFileResult[]): Map<string, { formula: string | null; text: string }> {
  const lookup = new Map<string, { formula: string | null; text: string }>();

  for (const file of files) {
    if (!file.rawSheets) continue;
    for (const sheet of file.rawSheets) {
      for (let r = 0; r < sheet.rowCount; r += 1) {
        const row = sheet.rows[r];
        if (!row || row.length === 0) continue;
        for (let c = 0; c < row.length; c += 1) {
          const cell = row[c];
          if (!cell) continue;
          const address = `${columnLetters(sheet.originCol + c)}${sheet.originRow + r + 1}`;
          lookup.set(`${file.fileName} ${sheet.name} ${address}`, {
            formula: cell.f ?? null,
            text: cellText(cell),
          });
        }
      }
    }
  }

  return lookup;
}

function columnLetters(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

function persistRecords(
  db: ReturnType<typeof getDb>,
  snapshotId: string,
  importId: string,
  reportDate: string,
  data: NormalizedDataset,
  refIds: string[],
  companyId: string,
): number {
  const refIdOf = (index: number | undefined) =>
    index !== undefined && index >= 0 && index < refIds.length ? refIds[index] : null;

  /**
   * The company a record belongs to.
   *
   * A project decides it when the record has one, because a project belongs to
   * exactly one company and a file can carry rows for several projects. A row
   * with no project falls back to the company being imported into — it was
   * uploaded there deliberately, and leaving it null would hide it from every
   * company at once.
   */
  const companyOf = (projectId: string | null | undefined): string =>
    (projectId ? projectCompany.get(projectId) : null) ?? companyId;

  const projectCompany = new Map<string, string | null>(
    db
      .prepare<[], { id: string; company_id: string | null }>('SELECT id, company_id FROM projects')
      .all()
      .map((r) => [r.id, r.company_id]),
  );

  /**
   * Who, inside the group, is on the other side of each transaction.
   *
   * Resolved once per import against every name the group knows its companies
   * by. Almost always null — the great majority of trade is with the outside
   * world — but without it a management fee between two subsidiaries would be
   * counted in full on both sides of any group total.
   */
  const counterparties = new CounterpartyResolver(
    db
      .prepare<[], { id: string; company_code: string; legal_name: string; display_name: string }>(
        'SELECT id, company_code, legal_name, display_name FROM companies',
      )
      .all()
      .map((c) => ({
        id: c.id,
        companyCode: c.company_code,
        legalName: c.legal_name,
        displayName: c.display_name,
        aliases: [],
      })),
  );

  /** The counterparty for a row, seen from the company being imported into. */
  const counterparty = (...names: (string | null | undefined)[]): string | null => {
    for (const name of names) {
      const found = counterparties.resolve(name, companyId);
      if (found) return found;
    }
    return null;
  };

  let count = 0;

  const bank = db.prepare(
    `INSERT INTO bank_balances
       (id, snapshot_id, import_id, project_id, company_id, report_date, bank_name, account_no,
        current_amount, pending_expense, source_ref_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of data.bank) {
    bank.run(newId(), snapshotId, importId, r.projectId, companyOf(r.projectId), reportDate, r.bankName, r.accountNo,
      r.currentAmount, r.pendingExpense, refIdOf(r.sourceRefIndex));
    count += 1;
  }

  const receivable = db.prepare(
    `INSERT INTO receivable_records
       (id, snapshot_id, import_id, project_id, company_id, report_date, category, customer, unit,
        contractual_amount, receive_amount, accrue_amount, computed_accrue, due_date,
        counterparty_company_id, source_ref_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of data.receivable) {
    receivable.run(newId(), snapshotId, importId, r.projectId, companyOf(r.projectId), reportDate, r.category, r.customer,
      r.unit, r.contractualAmount, r.receiveAmount, r.accrueAmount,
      r.contractualAmount - r.receiveAmount, r.dueDate,
      counterparty(r.customer), refIdOf(r.sourceRefIndex));
    count += 1;
  }

  const payable = db.prepare(
    `INSERT INTO payable_records
       (id, snapshot_id, import_id, project_id, company_id, report_date, vendor, invoice_no,
        description, category, invoice_date, due_date, invoice_amount, paid_amount,
        stated_outstanding, counterparty_company_id, source_ref_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of data.payable) {
    payable.run(newId(), snapshotId, importId, r.projectId, companyOf(r.projectId), reportDate,
      r.vendor, r.invoiceNo, r.description, r.category, r.invoiceDate, r.dueDate,
      r.invoiceAmount, r.paidAmount, r.statedOutstanding,
      counterparty(r.vendor, r.description), refIdOf(r.sourceRefIndex));
    count += 1;
  }

  const income = db.prepare(
    `INSERT INTO income_records
       (id, snapshot_id, import_id, project_id, company_id, report_date, category, description, month,
        contractual_amount, received_amount, accrued_amount, is_forecast,
        counterparty_company_id, source_ref_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of data.income) {
    income.run(newId(), snapshotId, importId, r.projectId, companyOf(r.projectId), reportDate, r.category, r.description,
      r.month, r.contractualAmount, r.receivedAmount, r.accruedAmount, toDbBool(r.isForecast),
      counterparty(r.description), refIdOf(r.sourceRefIndex));
    count += 1;
  }

  const expense = db.prepare(
    `INSERT INTO expense_records
       (id, snapshot_id, import_id, project_id, company_id, report_date, category, description, month,
        amount, paid_amount, pending_amount, is_forecast, counterparty_company_id, source_ref_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of data.expense) {
    expense.run(newId(), snapshotId, importId, r.projectId, companyOf(r.projectId), reportDate, r.category, r.description,
      r.month, r.amount, r.paidAmount, r.pendingAmount, toDbBool(r.isForecast),
      counterparty(r.description), refIdOf(r.sourceRefIndex));
    count += 1;
  }

  const boq = db.prepare(
    `INSERT INTO boq_records
       (id, snapshot_id, import_id, project_id, company_id, report_date, account_code, description, contractor,
        cost_category, month, boq_amount, boq_to_date, paid_amount, pending_amount, source_ref_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of data.boq) {
    boq.run(newId(), snapshotId, importId, r.projectId, companyOf(r.projectId), reportDate, r.accountCode, r.description,
      r.contractor, r.costCategory, r.month, r.boqAmount, r.boqToDate, r.paidAmount,
      r.pendingAmount, refIdOf(r.sourceRefIndex));
    count += 1;
  }

  const wip = db.prepare(
    `INSERT INTO wip_records
       (id, snapshot_id, import_id, project_id, company_id, report_date, account_code, account_name,
        current_period, ytd, advance_payment, stated_closing, source_ref_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of data.wip) {
    wip.run(newId(), snapshotId, importId, r.projectId, companyOf(r.projectId), reportDate, r.accountCode, r.accountName,
      r.currentPeriod, r.ytd, r.advancePayment, r.statedClosing, refIdOf(r.sourceRefIndex));
    count += 1;
  }

  const gl = db.prepare(
    `INSERT INTO gl_entries
       (id, snapshot_id, import_id, project_id, company_id, report_date, account_code, account_name,
        entry_date, voucher_no, vendor, description, cost_code, module, job,
        debit, credit, balance, is_opening, counterparty_company_id, source_ref_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of data.gl) {
    gl.run(newId(), snapshotId, importId, r.projectId, companyOf(r.projectId), reportDate, r.accountCode, r.accountName,
      r.entryDate, r.voucherNo, r.vendor, r.description, r.costCode, r.module, r.job,
      r.debit, r.credit, r.balance, toDbBool(r.isOpeningBalance),
      counterparty(r.vendor, r.description), refIdOf(r.sourceRefIndex));
    count += 1;
  }

  const cashflow = db.prepare(
    `INSERT INTO cashflow_forecasts
       (id, snapshot_id, import_id, project_id, company_id, report_date, month, opening_balance,
        expected_income, expected_expense, net_cashflow, closing_balance, is_computed, source_ref_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of data.cashflow) {
    cashflow.run(newId(), snapshotId, importId, r.projectId, companyOf(r.projectId), reportDate, r.month, r.openingBalance,
      r.expectedIncome, r.expectedExpense, r.netCashflow, r.closingBalance,
      toDbBool(r.isComputed), refIdOf(r.sourceRefIndex));
    count += 1;
  }

  return count;
}

function persistMetrics(
  snapshotId: string,
  importId: string,
  projectId: string | null,
  companyId: string,
  reportDate: string,
  metrics: Metric[],
  refIds: string[],
  now: string,
): number {
  const stmt = getDb().prepare(
    `INSERT INTO calculated_metrics
       (id, snapshot_id, import_id, project_id, company_id, report_date, metric_key, label, section,
        value, unit, formula, inputs_json, source_ref_ids_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const metric of metrics) {
    const ids = metric.sourceRefIndexes
      .map((i) => refIds[i])
      .filter((id): id is string => !!id)
      // A metric can touch thousands of cells; the drill-down only needs
      // enough to be useful, and the rest are reachable through the records.
      .slice(0, 500);

    stmt.run(
      newId(), snapshotId, importId, projectId, companyId, reportDate, metric.key, metric.label,
      metric.section, metric.value, metric.unit, metric.formula,
      JSON.stringify(metric.inputs), JSON.stringify(ids), now,
    );
  }

  return metrics.length;
}

function persistValidations(
  snapshotId: string,
  importId: string,
  results: ValidationResult[],
  refIds: string[],
  now: string,
): number {
  const stmt = getDb().prepare(
    `INSERT INTO validation_results
       (id, snapshot_id, import_id, project_id, rule_key, label, scope, expected_value,
        imported_value, difference, status, severity, message, source_ref_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const result of results) {
    stmt.run(
      newId(), snapshotId, importId, result.projectId, result.ruleKey, result.label, result.scope,
      result.expected, result.imported, result.difference, result.status, result.severity,
      result.message, refIds[result.sourceRefIndexes[0]] ?? null, now,
    );
  }

  return results.length;
}

function persistIssues(
  importId: string,
  issues: ImportIssue[],
  fileIdByName: Map<string, string>,
  now: string,
): void {
  const stmt = getDb().prepare(
    `INSERT INTO import_issues
       (id, import_id, import_file_id, severity, code, message, source_file, source_sheet,
        source_row, source_cell, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const issue of issues) {
    stmt.run(
      newId(), importId, fileIdByName.get(issue.source.file) ?? null, issue.severity, issue.code,
      issue.message, issue.source.file, issue.source.sheet ?? null, issue.source.row ?? null,
      issue.source.cell ?? null, now,
    );
  }
}

// ---------------------------------------------------------------- duplicates

export interface DuplicateMatch {
  fileName: string;
  hash: string;
  importId: string;
  importedAt: string;
  reportDate: string;
  projectName: string | null;
  reportType: string | null;
}

/**
 * Duplicate detection (requirement 29): identical bytes, or the same report
 * date + project + report type already on file.
 */
/**
 * Duplicates are looked for within one company only.
 *
 * Two companies uploading the same month's template is normal, and a match
 * across them would both mislead the person uploading and disclose that the
 * other company has filed — the file name, project and date of an import they
 * cannot otherwise see.
 */
export function findDuplicates(
  companyId: string,
  files: { fileName: string; hash: string; reportDate: string; projectId: string | null; reportType: string }[],
): DuplicateMatch[] {
  const db = getDb();
  const matches: DuplicateMatch[] = [];

  const byHash = db.prepare<[string, string], {
    import_id: string; created_at: string; report_date: string;
    detected_project_label: string | null; report_type: string | null;
  }>(
    `SELECT f.import_id, f.created_at, f.report_date, f.detected_project_label, f.report_type
       FROM import_files f
       JOIN imports i ON i.id = f.import_id
      WHERE f.file_hash = ? AND i.company_id = ? AND i.status = 'completed'
      ORDER BY f.created_at DESC LIMIT 1`,
  );

  const bySignature = db.prepare<[string, string, string, string], {
    import_id: string; created_at: string; report_date: string;
    detected_project_label: string | null; report_type: string | null;
  }>(
    `SELECT f.import_id, f.created_at, f.report_date, f.detected_project_label, f.report_type
       FROM import_files f
       JOIN imports i ON i.id = f.import_id
      WHERE f.report_date = ? AND f.report_type = ? AND IFNULL(f.project_id, '') = ?
        AND i.company_id = ? AND i.status = 'completed'
      ORDER BY f.created_at DESC LIMIT 1`,
  );

  for (const file of files) {
    const hit =
      byHash.get(file.hash, companyId) ??
      bySignature.get(file.reportDate, file.reportType, file.projectId ?? '', companyId);
    if (!hit) continue;

    matches.push({
      fileName: file.fileName,
      hash: file.hash,
      importId: hit.import_id,
      importedAt: hit.created_at,
      reportDate: hit.report_date,
      projectName: hit.detected_project_label,
      reportType: hit.report_type,
    });
  }

  return matches;
}

// ------------------------------------------------------------------ history

export interface ImportSummary {
  id: string;
  reportDate: string;
  label: string | null;
  status: string;
  uploadedBy: string | null;
  fileCount: number;
  rowCount: number;
  warningCount: number;
  errorCount: number;
  createdAt: string;
  completedAt: string | null;
  snapshotId: string | null;
  isCurrent: boolean;
  projects: string[];
}

export function listImports(companyId: string, limit = 100): ImportSummary[] {
  const db = getDb();
  const rows = db
    .prepare<[string, number], {
      id: string; report_date: string; label: string | null; status: string;
      user_name: string | null; file_count: number; row_count: number;
      warning_count: number; error_count: number; created_at: string;
      completed_at: string | null; snapshot_id: string | null; is_current: number | null;
    }>(
      `SELECT i.id, i.report_date, i.label, i.status, u.name AS user_name,
              i.file_count, i.row_count, i.warning_count, i.error_count,
              i.created_at, i.completed_at,
              s.id AS snapshot_id, s.is_current
         FROM imports i
         LEFT JOIN users u ON u.id = i.uploaded_by
         LEFT JOIN financial_snapshots s ON s.import_id = i.id
        WHERE i.company_id = ?
        ORDER BY i.created_at DESC
        LIMIT ?`,
    )
    .all(companyId, limit);

  const projectStmt = db.prepare<[string], { name: string }>(
    `SELECT DISTINCT COALESCE(p.name, f.detected_project_label, 'Unassigned') AS name
       FROM import_files f
       LEFT JOIN projects p ON p.id = f.project_id
      WHERE f.import_id = ?`,
  );

  return rows.map((row) => ({
    id: row.id,
    reportDate: row.report_date,
    label: row.label,
    status: row.status,
    uploadedBy: row.user_name,
    fileCount: row.file_count,
    rowCount: row.row_count,
    warningCount: row.warning_count,
    errorCount: row.error_count,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    snapshotId: row.snapshot_id,
    isCurrent: row.is_current === 1,
    projects: projectStmt.all(row.id).map((p) => p.name),
  }));
}

export function getImportIssues(companyId: string, importId: string) {
  return getDb()
    .prepare<[string, string], {
      severity: string; code: string; message: string; source_file: string | null;
      source_sheet: string | null; source_row: number | null; source_cell: string | null;
    }>(
      `SELECT n.severity, n.code, n.message, n.source_file, n.source_sheet, n.source_row, n.source_cell
         FROM import_issues n
         JOIN imports i ON i.id = n.import_id
        WHERE n.import_id = ? AND i.company_id = ?
        ORDER BY CASE n.severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, n.source_file`,
    )
    .all(importId, companyId);
}

export function getImportFiles(companyId: string, importId: string) {
  return getDb()
    .prepare<[string, string], {
      id: string; file_name: string; container_file: string | null; file_type: string;
      file_hash: string; file_size: number; report_type: string | null; report_date: string | null;
      sheet_count: number; row_count: number; status: string; error_message: string | null;
      project_name: string | null;
    }>(
      `SELECT f.id, f.file_name, f.container_file, f.file_type, f.file_hash, f.file_size,
              f.report_type, f.report_date, f.sheet_count, f.row_count, f.status,
              f.error_message, COALESCE(p.name, f.detected_project_label) AS project_name
         FROM import_files f
         JOIN imports i ON i.id = f.import_id
         LEFT JOIN projects p ON p.id = f.project_id
        WHERE f.import_id = ? AND i.company_id = ?
        ORDER BY f.file_name`,
    )
    .all(importId, companyId);
}

/**
 * Rolls an import back.
 *
 * The import row is retained with status `rolled_back` so history stays
 * honest; its records cascade away, and the most recent surviving snapshot for
 * that report date becomes live again.
 */
export function rollbackImport(companyId: string, importId: string): boolean {
  const db = getDb();

  return transaction(() => {
    // Company first: an import id from another company must read as "not
    // found" here, exactly as it would if it did not exist.
    const row = db
      .prepare<[string, string], { report_date: string; status: string }>(
        'SELECT report_date, status FROM imports WHERE id = ? AND company_id = ?',
      )
      .get(importId, companyId);

    if (!row || row.status === 'rolled_back') return false;

    // Snapshot deletion cascades to every record, metric and validation.
    db.prepare('DELETE FROM financial_snapshots WHERE import_id = ?').run(importId);
    db.prepare("UPDATE imports SET status = 'rolled_back' WHERE id = ?").run(importId);

    // The snapshot promoted back to live is this company's, and only this
    // company's flags are touched.
    const survivor = db
      .prepare<[string, string], { id: string }>(
        `SELECT id FROM financial_snapshots
          WHERE report_date = ? AND company_id = ?
          ORDER BY created_at DESC LIMIT 1`,
      )
      .get(row.report_date, companyId);

    if (survivor) {
      db.prepare(
        'UPDATE financial_snapshots SET is_current = 0 WHERE report_date = ? AND company_id = ?',
      ).run(row.report_date, companyId);
      db.prepare('UPDATE financial_snapshots SET is_current = 1 WHERE id = ?').run(survivor.id);
    }

    return true;
  });
}

export function getImportSummary(companyId: string, importId: string): ImportSummary | null {
  return listImports(companyId, 500).find((i) => i.id === importId) ?? null;
}

export { parseJson };
