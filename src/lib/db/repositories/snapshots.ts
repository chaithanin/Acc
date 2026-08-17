import { calculateMetrics } from '@/lib/calc/kpi';
import { filterByProject, indexSourceRefs, projectIdsIn } from '@/lib/calc/aggregate';
import type { CashflowProjection } from '@/lib/calc/cashflow';
import { runValidations } from '@/lib/validate/rules';
import {
  emptyDataset,
  type Metric,
  type MetricSection,
  type NormalizedDataset,
  type SourceRef,
  type ValidationResult,
} from '@/lib/types';
import { fromDbBool, getDb, newId, nowIso, parseJson, transaction } from '../index';

/**
 * Read model for the dashboards.
 *
 * Metrics are read from `calculated_metrics` (fast path). The normalized
 * records are also loadable so the engine can recalculate everything from
 * stored data without touching the original files (requirement 24).
 */

export interface SnapshotInfo {
  id: string;
  importId: string;
  reportDate: string;
  label: string | null;
  isCurrent: boolean;
  createdAt: string;
}

export function listSnapshots(): SnapshotInfo[] {
  return getDb()
    .prepare<[], {
      id: string; import_id: string; report_date: string; label: string | null;
      is_current: number; created_at: string;
    }>(
      `SELECT s.id, s.import_id, s.report_date, s.label, s.is_current, s.created_at
         FROM financial_snapshots s
         JOIN imports i ON i.id = s.import_id
        WHERE i.status = 'completed'
        ORDER BY s.report_date DESC, s.created_at DESC`,
    )
    .all()
    .map((row) => ({
      id: row.id,
      importId: row.import_id,
      reportDate: row.report_date,
      label: row.label,
      isCurrent: fromDbBool(row.is_current),
      createdAt: row.created_at,
    }));
}

/** The live snapshot: newest report date whose snapshot is flagged current. */
export function getCurrentSnapshot(): SnapshotInfo | null {
  return listSnapshots().find((s) => s.isCurrent) ?? null;
}

export function getSnapshot(snapshotId: string): SnapshotInfo | null {
  return listSnapshots().find((s) => s.id === snapshotId) ?? null;
}

/**
 * The snapshot immediately preceding `snapshotId` by report date — the default
 * comparison baseline (requirement 11).
 */
export function getPreviousSnapshot(snapshotId: string): SnapshotInfo | null {
  const all = listSnapshots().filter((s) => s.isCurrent);
  const index = all.findIndex((s) => s.id === snapshotId);
  if (index === -1) {
    const target = getSnapshot(snapshotId);
    if (!target) return null;
    return all.find((s) => s.reportDate < target.reportDate) ?? null;
  }
  return all[index + 1] ?? null;
}

// ------------------------------------------------------------------ metrics

export interface StoredMetric extends Metric {
  projectId: string | null;
  sourceRefIds: string[];
}

export function getMetrics(snapshotId: string, projectId: string | null): StoredMetric[] {
  const db = getDb();
  const rows = projectId
    ? db
        .prepare<[string, string], MetricRow>(
          `SELECT * FROM calculated_metrics WHERE snapshot_id = ? AND project_id = ?`,
        )
        .all(snapshotId, projectId)
    : db
        .prepare<[string], MetricRow>(
          `SELECT * FROM calculated_metrics WHERE snapshot_id = ? AND project_id IS NULL`,
        )
        .all(snapshotId);

  return rows.map(toStoredMetric);
}

interface MetricRow {
  project_id: string | null;
  metric_key: string;
  label: string;
  section: string;
  value: number | null;
  unit: string;
  formula: string | null;
  inputs_json: string | null;
  source_ref_ids_json: string | null;
}

function toStoredMetric(row: MetricRow): StoredMetric {
  return {
    key: row.metric_key,
    label: row.label,
    section: row.section as MetricSection,
    value: row.value,
    unit: (row.unit as Metric['unit']) ?? 'THB',
    formula: row.formula ?? '',
    inputs: parseJson(row.inputs_json, []),
    sourceRefIndexes: [],
    projectId: row.project_id,
    sourceRefIds: parseJson(row.source_ref_ids_json, []),
  };
}

export function getMetric(
  snapshotId: string,
  projectId: string | null,
  metricKey: string,
): StoredMetric | null {
  return getMetrics(snapshotId, projectId).find((m) => m.key === metricKey) ?? null;
}

// -------------------------------------------------------------- validations

export function getValidations(snapshotId: string, projectId: string | null): ValidationResult[] {
  const db = getDb();
  const rows = projectId
    ? db
        .prepare<[string, string], ValidationRow>(
          'SELECT * FROM validation_results WHERE snapshot_id = ? AND project_id = ?',
        )
        .all(snapshotId, projectId)
    : db
        .prepare<[string], ValidationRow>(
          'SELECT * FROM validation_results WHERE snapshot_id = ? AND project_id IS NULL',
        )
        .all(snapshotId);

  return rows.map((row) => ({
    ruleKey: row.rule_key,
    label: row.label,
    scope: row.scope,
    projectId: row.project_id,
    expected: row.expected_value,
    imported: row.imported_value,
    difference: row.difference,
    status: row.status as ValidationResult['status'],
    severity: row.severity as ValidationResult['severity'],
    message: row.message ?? '',
    sourceRefIndexes: [],
  }));
}

interface ValidationRow {
  project_id: string | null;
  rule_key: string;
  label: string;
  scope: string;
  expected_value: number | null;
  imported_value: number | null;
  difference: number | null;
  status: string;
  severity: string;
  message: string | null;
}

/** Every validation across all scopes, for the reconciliation page. */
export function getAllValidations(snapshotId: string) {
  return getDb()
    .prepare<[string], ValidationRow & { project_name: string | null; source_ref_id: string | null }>(
      `SELECT v.*, p.name AS project_name, v.source_ref_id
         FROM validation_results v
         LEFT JOIN projects p ON p.id = v.project_id
        WHERE v.snapshot_id = ?
        ORDER BY CASE v.status WHEN 'error' THEN 0 WHEN 'warning' THEN 1 WHEN 'pass' THEN 2 ELSE 3 END,
                 v.scope`,
    )
    .all(snapshotId);
}

// ------------------------------------------------------------ source lookup

export interface SourceReferenceRow {
  id: string;
  sourceFile: string;
  sourceSheet: string | null;
  sourceRow: number | null;
  sourceCell: string | null;
  sourceFormula: string | null;
  rawValue: string | null;
  importedAt: string;
}

export function getSourceReferences(ids: string[]): SourceReferenceRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return getDb()
    .prepare<string[], {
      id: string; source_file: string; source_sheet: string | null; source_row: number | null;
      source_cell: string | null; source_formula: string | null; raw_value: string | null;
      created_at: string;
    }>(`SELECT * FROM source_references WHERE id IN (${placeholders})`)
    .all(...ids)
    .map((row) => ({
      id: row.id,
      sourceFile: row.source_file,
      sourceSheet: row.source_sheet,
      sourceRow: row.source_row,
      sourceCell: row.source_cell,
      sourceFormula: row.source_formula,
      rawValue: row.raw_value,
      importedAt: row.created_at,
    }));
}

// -------------------------------------------------------------- record load

/**
 * Rebuilds the normalized dataset from the database.
 *
 * This is what makes "Recalculate" possible without the original files: the
 * stored records are the same objects the calculation engine consumed at
 * import time.
 */
export function loadDataset(
  snapshotId: string,
): { data: NormalizedDataset; refs: SourceRef[]; refIds: string[] } {
  const db = getDb();
  const data = emptyDataset();

  const refIds: string[] = [];
  const refs: SourceRef[] = [];
  const refIndexById = new Map<string, number>();

  const refRows = db
    .prepare<[string], {
      id: string; source_file: string; source_sheet: string | null;
      source_row: number | null; source_col: number | null; source_cell: string | null;
    }>(
      `SELECT sr.id, sr.source_file, sr.source_sheet, sr.source_row, sr.source_col, sr.source_cell
         FROM source_references sr
         JOIN financial_snapshots s ON s.import_id = sr.import_id
        WHERE s.id = ?`,
    )
    .all(snapshotId);

  for (const row of refRows) {
    refIndexById.set(row.id, refs.length);
    refIds.push(row.id);
    refs.push({
      file: row.source_file,
      sheet: row.source_sheet,
      row: row.source_row,
      col: row.source_col,
      cell: row.source_cell,
    });
  }

  const indexOf = (id: string | null) => (id ? refIndexById.get(id) ?? -1 : -1);
  const blankRef: SourceRef = { file: '', sheet: null, row: null, col: null, cell: null };
  const refAt = (index: number) => (index >= 0 ? refs[index] : blankRef);

  for (const row of db.prepare<[string], any>('SELECT * FROM bank_balances WHERE snapshot_id = ?').all(snapshotId)) {
    const index = indexOf(row.source_ref_id);
    data.bank.push({
      kind: 'bank', sourceRef: refAt(index), sourceRefIndex: index,
      projectId: row.project_id, projectLabel: null,
      bankName: row.bank_name, accountNo: row.account_no,
      currentAmount: row.current_amount, pendingExpense: row.pending_expense,
    });
  }

  for (const row of db.prepare<[string], any>('SELECT * FROM receivable_records WHERE snapshot_id = ?').all(snapshotId)) {
    const index = indexOf(row.source_ref_id);
    data.receivable.push({
      kind: 'receivable', sourceRef: refAt(index), sourceRefIndex: index,
      projectId: row.project_id, projectLabel: null,
      category: row.category, customer: row.customer, unit: row.unit,
      contractualAmount: row.contractual_amount, receiveAmount: row.receive_amount,
      accrueAmount: row.accrue_amount, dueDate: row.due_date,
    });
  }

  for (const row of db.prepare<[string], any>('SELECT * FROM income_records WHERE snapshot_id = ?').all(snapshotId)) {
    const index = indexOf(row.source_ref_id);
    data.income.push({
      kind: 'income', sourceRef: refAt(index), sourceRefIndex: index,
      projectId: row.project_id, projectLabel: null,
      category: row.category, description: row.description, month: row.month,
      contractualAmount: row.contractual_amount, receivedAmount: row.received_amount,
      accruedAmount: row.accrued_amount, isForecast: fromDbBool(row.is_forecast),
    });
  }

  for (const row of db.prepare<[string], any>('SELECT * FROM expense_records WHERE snapshot_id = ?').all(snapshotId)) {
    const index = indexOf(row.source_ref_id);
    data.expense.push({
      kind: 'expense', sourceRef: refAt(index), sourceRefIndex: index,
      projectId: row.project_id, projectLabel: null,
      category: row.category, description: row.description, month: row.month,
      amount: row.amount, paidAmount: row.paid_amount, pendingAmount: row.pending_amount,
      isForecast: fromDbBool(row.is_forecast),
    });
  }

  for (const row of db.prepare<[string], any>('SELECT * FROM boq_records WHERE snapshot_id = ?').all(snapshotId)) {
    const index = indexOf(row.source_ref_id);
    data.boq.push({
      kind: 'boq', sourceRef: refAt(index), sourceRefIndex: index,
      projectId: row.project_id, projectLabel: null,
      accountCode: row.account_code, description: row.description, contractor: row.contractor,
      costCategory: row.cost_category, month: row.month, boqAmount: row.boq_amount,
      boqToDate: row.boq_to_date, paidAmount: row.paid_amount, pendingAmount: row.pending_amount,
    });
  }

  for (const row of db.prepare<[string], any>('SELECT * FROM wip_records WHERE snapshot_id = ?').all(snapshotId)) {
    const index = indexOf(row.source_ref_id);
    data.wip.push({
      kind: 'wip', sourceRef: refAt(index), sourceRefIndex: index,
      projectId: row.project_id, projectLabel: null,
      accountCode: row.account_code, accountName: row.account_name,
      currentPeriod: row.current_period, ytd: row.ytd, advancePayment: row.advance_payment,
    });
  }

  for (const row of db.prepare<[string], any>('SELECT * FROM gl_entries WHERE snapshot_id = ?').all(snapshotId)) {
    const index = indexOf(row.source_ref_id);
    data.gl.push({
      kind: 'gl', sourceRef: refAt(index), sourceRefIndex: index,
      projectId: row.project_id, projectLabel: null,
      accountCode: row.account_code, accountName: row.account_name, entryDate: row.entry_date,
      voucherNo: row.voucher_no, vendor: row.vendor, description: row.description,
      costCode: row.cost_code, module: row.module, job: row.job,
      debit: row.debit, credit: row.credit, balance: row.balance,
      isOpeningBalance: fromDbBool(row.is_opening),
    });
  }

  for (const row of db.prepare<[string], any>('SELECT * FROM cashflow_forecasts WHERE snapshot_id = ?').all(snapshotId)) {
    const index = indexOf(row.source_ref_id);
    data.cashflow.push({
      kind: 'cashflow', sourceRef: refAt(index), sourceRefIndex: index,
      projectId: row.project_id, projectLabel: null,
      month: row.month, openingBalance: row.opening_balance,
      expectedIncome: row.expected_income, expectedExpense: row.expected_expense,
      netCashflow: row.net_cashflow, closingBalance: row.closing_balance,
      isComputed: fromDbBool(row.is_computed),
    });
  }

  return { data, refs, refIds };
}

/** The engine's live projection for a snapshot, recomputed from stored records. */
export function getProjection(snapshotId: string, projectId: string | null): CashflowProjection {
  const snapshot = getSnapshot(snapshotId);
  const { data } = loadDataset(snapshotId);
  const scoped = filterByProject(data, projectId);
  return calculateMetrics(scoped, snapshot?.reportDate ?? nowIso().slice(0, 10)).projection;
}

/**
 * Recalculates every metric and validation for a snapshot from stored records
 * and rewrites them. Used by "Recalculate" in Import History — no file needed.
 */
export function recalculateSnapshot(snapshotId: string): { metrics: number; validations: number } {
  const snapshot = getSnapshot(snapshotId);
  if (!snapshot) throw new Error('Snapshot not found.');

  const db = getDb();
  const { data, refIds } = loadDataset(snapshotId);

  return transaction(() => {
    db.prepare('DELETE FROM calculated_metrics WHERE snapshot_id = ?').run(snapshotId);
    db.prepare('DELETE FROM validation_results WHERE snapshot_id = ?').run(snapshotId);

    // Refs are already indexed on load; re-stamp so metric indexes stay aligned.
    indexSourceRefs(data);

    const now = nowIso();
    let metrics = 0;
    let validations = 0;

    const metricStmt = db.prepare(
      `INSERT INTO calculated_metrics
         (id, snapshot_id, import_id, project_id, report_date, metric_key, label, section,
          value, unit, formula, inputs_json, source_ref_ids_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const validationStmt = db.prepare(
      `INSERT INTO validation_results
         (id, snapshot_id, import_id, project_id, rule_key, label, scope, expected_value,
          imported_value, difference, status, severity, message, source_ref_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const projectId of [null, ...projectIdsIn(data)]) {
      const scoped = filterByProject(data, projectId);
      const calc = calculateMetrics(scoped, snapshot.reportDate);

      for (const metric of calc.metrics) {
        const ids = metric.sourceRefIndexes
          .map((i) => refIds[i])
          .filter((id): id is string => !!id)
          .slice(0, 500);

        metricStmt.run(
          newId(), snapshotId, snapshot.importId, projectId, snapshot.reportDate, metric.key,
          metric.label, metric.section, metric.value, metric.unit, metric.formula,
          JSON.stringify(metric.inputs), JSON.stringify(ids), now,
        );
        metrics += 1;
      }

      for (const result of runValidations(scoped, calc, projectId)) {
        validationStmt.run(
          newId(), snapshotId, snapshot.importId, result.projectId, result.ruleKey, result.label,
          result.scope, result.expected, result.imported, result.difference, result.status,
          result.severity, result.message, refIds[result.sourceRefIndexes[0]] ?? null, now,
        );
        validations += 1;
      }
    }

    return { metrics, validations };
  });
}

/** Project ids that actually carry data in a snapshot. */
export function getSnapshotProjectIds(snapshotId: string): string[] {
  return getDb()
    .prepare<[string], { project_id: string }>(
      `SELECT DISTINCT project_id FROM calculated_metrics
        WHERE snapshot_id = ? AND project_id IS NOT NULL`,
    )
    .all(snapshotId)
    .map((r) => r.project_id);
}
