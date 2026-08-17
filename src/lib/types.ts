import type { ReportType } from '@/config/detection-rules';
import type { CanonicalField, ExpenseCategory, IncomeCategory } from '@/config/field-synonyms';
import type { SourceRef } from '@/lib/excel/types';

export type { ReportType, CanonicalField, IncomeCategory, ExpenseCategory, SourceRef };

export type Role = 'admin' | 'finance' | 'management' | 'viewer';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  /** YYYY-MM-DD. Null means the account never expires. */
  expiresAt: string | null;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  /** Legacy free-text company label, kept while data still carries it. */
  company: string | null;
  /** The company that owns this project. What every scoped query filters on. */
  companyId: string | null;
  sortOrder: number;
  active: boolean;
  aliases: string[];
}

// ---------------------------------------------------------------- normalized
// The "Normalized Data" layer (requirement 34): typed records with no
// presentation concerns and a source pointer on every one.

export interface NormalizedBase {
  sourceRef: SourceRef;
  /**
   * Position of `sourceRef` in the import's deduplicated reference table.
   * Assigned by `indexSourceRefs` after normalization, so metrics can cite the
   * exact cells behind them without carrying whole objects around.
   */
  sourceRefIndex?: number;
  projectId: string | null;
  /** Project text as written in the file, kept even when it resolves cleanly. */
  projectLabel: string | null;
}

export interface BankRecord extends NormalizedBase {
  kind: 'bank';
  bankName: string | null;
  accountNo: string | null;
  currentAmount: number;
  pendingExpense: number;
}

export interface ReceivableRecord extends NormalizedBase {
  kind: 'receivable';
  category: IncomeCategory;
  customer: string | null;
  unit: string | null;
  contractualAmount: number;
  receiveAmount: number;
  /** As printed in the file — may disagree with the computed value. */
  accrueAmount: number;
  dueDate: string | null;
}

export interface IncomeRecord extends NormalizedBase {
  kind: 'income';
  category: IncomeCategory;
  description: string | null;
  month: string | null;
  contractualAmount: number;
  receivedAmount: number;
  accruedAmount: number;
  isForecast: boolean;
}

export interface ExpenseRecord extends NormalizedBase {
  kind: 'expense';
  category: ExpenseCategory;
  description: string | null;
  month: string | null;
  amount: number;
  paidAmount: number;
  pendingAmount: number;
  isForecast: boolean;
}

export interface BoqRecord extends NormalizedBase {
  kind: 'boq';
  accountCode: string | null;
  description: string | null;
  contractor: string | null;
  costCategory: string | null;
  month: string | null;
  boqAmount: number;
  boqToDate: number;
  paidAmount: number;
  pendingAmount: number;
}

export interface WipRecord extends NormalizedBase {
  kind: 'wip';
  accountCode: string | null;
  accountName: string | null;
  currentPeriod: number;
  ytd: number;
  advancePayment: number;
  /**
   * Closing balance as printed by the source system (a ledger's "Total A/C" or
   * "Grand Total" footer). Never used as the value — it exists so
   * reconciliation can check our own arithmetic against the accounting
   * system's, which is the strongest correctness signal available.
   */
  statedClosing: number | null;
}

export interface CashflowRecord extends NormalizedBase {
  kind: 'cashflow';
  month: string;
  openingBalance: number | null;
  expectedIncome: number;
  expectedExpense: number;
  netCashflow: number | null;
  closingBalance: number | null;
  isComputed: boolean;
}

/**
 * One posted or unposted general-ledger line.
 *
 * GL entries are transaction-level detail, kept for the audit trail and
 * drill-down. They deliberately do NOT feed the KPI sums directly — the
 * account-level `WipRecord` derived alongside them does, so a ledger can never
 * be counted twice.
 */
export interface GlRecord extends NormalizedBase {
  kind: 'gl';
  accountCode: string | null;
  accountName: string | null;
  entryDate: string | null;
  voucherNo: string | null;
  vendor: string | null;
  description: string | null;
  costCode: string | null;
  module: string | null;
  job: string | null;
  debit: number;
  credit: number;
  /** Running balance as printed by the accounting system. */
  balance: number | null;
  /** True for the brought-forward opening line. */
  isOpeningBalance: boolean;
}

export type NormalizedRecord =
  | BankRecord
  | ReceivableRecord
  | IncomeRecord
  | ExpenseRecord
  | BoqRecord
  | WipRecord
  | CashflowRecord
  | GlRecord;

export interface NormalizedDataset {
  bank: BankRecord[];
  receivable: ReceivableRecord[];
  income: IncomeRecord[];
  expense: ExpenseRecord[];
  boq: BoqRecord[];
  wip: WipRecord[];
  cashflow: CashflowRecord[];
  gl: GlRecord[];
}

export function emptyDataset(): NormalizedDataset {
  return { bank: [], receivable: [], income: [], expense: [], boq: [], wip: [], cashflow: [], gl: [] };
}

export function mergeDatasets(a: NormalizedDataset, b: NormalizedDataset): NormalizedDataset {
  return {
    bank: [...a.bank, ...b.bank],
    receivable: [...a.receivable, ...b.receivable],
    income: [...a.income, ...b.income],
    expense: [...a.expense, ...b.expense],
    boq: [...a.boq, ...b.boq],
    wip: [...a.wip, ...b.wip],
    cashflow: [...a.cashflow, ...b.cashflow],
    gl: [...a.gl, ...b.gl],
  };
}

export function datasetCount(d: NormalizedDataset): number {
  return (
    d.bank.length + d.receivable.length + d.income.length + d.expense.length +
    d.boq.length + d.wip.length + d.cashflow.length + d.gl.length
  );
}

// ------------------------------------------------------------------- issues
export type IssueSeverity = 'info' | 'warning' | 'error';

export interface ImportIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  source: Partial<SourceRef> & { file: string };
}

// ---------------------------------------------------------------- detection
export interface ColumnMapping {
  field: CanonicalField;
  columnIndex: number;
  header: string;
  /** How the column was identified — shown in the inspector. */
  via: 'header' | 'template' | 'manual' | 'cell-fallback';
  score: number;
}

export interface SheetDetection {
  sheetName: string;
  sheetIndex: number;
  reportType: ReportType;
  confidence: number;
  /** 0-based grid index of the detected header row, null when none found. */
  headerRow: number | null;
  headers: string[];
  columns: ColumnMapping[];
  scores: { type: ReportType; score: number }[];
  templateId: string | null;
  templateName: string | null;
  rowCount: number;
  parsedCount: number;
}

export interface ProjectMatch {
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
  matchedAlias: string | null;
  matchedIn: 'file-name' | 'sheet-name' | 'cell' | 'column' | 'manual' | null;
  confidence: number;
}

// ------------------------------------------------------------------ metrics
export interface MetricInput {
  label: string;
  value: number;
  sourceRefIndexes?: number[];
}

/**
 * A calculated figure plus everything needed to explain it on screen
 * (requirement 27) and drill into it (requirement 16).
 */
export interface Metric {
  key: string;
  label: string;
  section: MetricSection;
  value: number | null;
  /** RATIO renders as "1.42×"; PERCENT as "13.3%"; COUNT unformatted. */
  unit: 'THB' | 'PERCENT' | 'COUNT' | 'RATIO';
  formula: string;
  inputs: MetricInput[];
  /** Source references backing this figure, as indexes into the import's list. */
  sourceRefIndexes: number[];
}

export type MetricSection = 'bank' | 'income' | 'expense' | 'cash' | 'receivable' | 'boq' | 'position';

export interface MetricComparison {
  key: string;
  label: string;
  section: MetricSection;
  unit: Metric['unit'];
  current: number | null;
  previous: number | null;
  difference: number | null;
  /** Null when the previous value is 0 or missing — shown as N/A. */
  differencePct: number | null;
  formula: string;
  inputs: MetricInput[];
}

// --------------------------------------------------------------- validation
export type ValidationStatus = 'pass' | 'warning' | 'error' | 'skipped';

export interface ValidationResult {
  ruleKey: string;
  label: string;
  scope: string;
  projectId: string | null;
  expected: number | null;
  imported: number | null;
  difference: number | null;
  status: ValidationStatus;
  severity: IssueSeverity;
  message: string;
  sourceRefIndexes: number[];
}
