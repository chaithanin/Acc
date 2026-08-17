/**
 * Sheet classification rules — level 1 of the mapping strategy (requirement 25).
 *
 * A sheet's report type is scored from BOTH its name and the headers found
 * inside it, so a renamed sheet still classifies correctly and sheet position
 * is never used on its own (requirement 4).
 */

import type { CanonicalField } from './field-synonyms';

export type ReportType =
  | 'financial_report'
  | 'bank_statement'
  | 'receivable'
  | 'wip'
  | 'boq'
  | 'cashflow'
  | 'income'
  | 'expense'
  | 'trial_balance'
  | 'general_ledger'
  | 'summary'
  | 'unknown';

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  financial_report: 'Financial Report',
  bank_statement: 'Bank Statement',
  receivable: 'Customer Receivable',
  wip: 'Work In Progress',
  boq: 'BOQ / Construction',
  cashflow: 'Cash Flow Forecast',
  income: 'Income',
  expense: 'Expense',
  trial_balance: 'Trial Balance',
  general_ledger: 'General Ledger',
  summary: 'Summary',
  unknown: 'Unknown',
};

export interface SheetRule {
  type: ReportType;
  /** Sheet-name fragments. Matching several adds up. */
  namePatterns: string[];
  /** Header keywords found in the detected header row. */
  headerKeywords: string[];
  /** Canonical fields that, once mapped, strongly confirm this type. */
  signatureFields: CanonicalField[];
  /** Multiplier applied to this rule's total score. */
  weight: number;
}

/**
 * Ordering is irrelevant — every rule is scored and the best wins. Keeping the
 * rules declarative means a new report shape is a data addition, not a branch.
 */
export const SHEET_RULES: SheetRule[] = [
  {
    type: 'bank_statement',
    namePatterns: ['bank statement', 'bank', 'statement', 'เงินฝาก', 'ธนาคาร'],
    headerKeywords: [
      'bank status',
      'bank current amount',
      'pending expense',
      'bank balance',
      'account no',
      'ยอดคงเหลือ',
      'ค้างจ่าย',
    ],
    signatureFields: ['bank_current_amount', 'pending_expense'],
    weight: 1.15,
  },
  {
    type: 'receivable',
    namePatterns: [
      'receivable',
      'reservation',
      'down payment',
      'customer',
      'ค้างรับ',
      'การ์ดลูกหนี้',
      'ลูกหนี้',
      'report vtr',
      'report sun',
      'summary',
      'summarize',
    ],
    headerKeywords: [
      'contractual amount',
      'receive amount',
      'accrue amount',
      'reservation',
      'contract',
      'down payment',
      'transfer fee',
      'ยอดตามสัญญา',
      'รับแล้ว',
      'ค้างรับ',
      'เงินจอง',
      'เงินดาวน์',
      'ค่าโอน',
    ],
    signatureFields: ['contractual_amount', 'receive_amount', 'accrue_amount'],
    weight: 1.2,
  },
  {
    type: 'wip',
    namePatterns: ['wip', 'work in progress', 'งานระหว่างก่อสร้าง', 'งานระหว่างทำ'],
    headerKeywords: [
      'account code',
      'account name',
      'current period',
      'ytd',
      'advance payment',
      'รหัสบัญชี',
      'ชื่อบัญชี',
      'งวดปัจจุบัน',
      'สะสม',
    ],
    signatureFields: ['account_code', 'account_name', 'current_period', 'ytd'],
    weight: 1.2,
  },
  {
    type: 'boq',
    namePatterns: ['boq', 'construction', 'ก่อสร้าง', 'คชจ', 'ค่าใช้จ่ายก่อสร้าง'],
    headerKeywords: [
      'boq',
      'construction',
      'paid',
      'pending',
      'accrued',
      'contractor',
      'ผู้รับเหมา',
      'จ่ายแล้ว',
      'คงเหลือ',
    ],
    signatureFields: ['boq_amount', 'boq_to_date', 'paid_amount'],
    weight: 1.1,
  },
  {
    type: 'cashflow',
    namePatterns: ['cash flow', 'cashflow', 'forecast', 'projection', 'กระแสเงินสด', 'ประมาณการ'],
    headerKeywords: [
      'opening',
      'closing',
      'expected income',
      'expected expense',
      'net cash flow',
      'cash in',
      'cash out',
      'ยอดยกมา',
      'ยอดยกไป',
      // A month-per-column statement has none of the above as column headers;
      // these block markers are what identify it instead.
      'inflow',
      'outflow',
      'cash balance',
      'cash at bank',
      'total cash inflow',
      'total cash outflow',
    ],
    signatureFields: ['opening_balance', 'closing_balance', 'expected_income', 'expected_expense'],
    weight: 1.1,
  },
  {
    type: 'financial_report',
    namePatterns: ['financial report', 'financial', 'conclude', 'fn ', 'fn', 'งบการเงิน', 'สรุปการเงิน'],
    headerKeywords: ['bank', 'income', 'expense', 'receivable', 'cash', 'รายได้', 'ค่าใช้จ่าย'],
    signatureFields: [],
    weight: 0.95,
  },
  {
    type: 'expense',
    namePatterns: ['expense', 'expense by finance paid', 'คชจ', 'ค่าใช้จ่าย', 'รายจ่าย'],
    headerKeywords: ['expense', 'paid', 'category', 'ค่าใช้จ่าย', 'จ่ายแล้ว', 'ประเภท'],
    signatureFields: ['expense_amount'],
    weight: 1.0,
  },
  {
    type: 'income',
    namePatterns: ['income', 'revenue', 'sales', 'รายได้', 'รายรับ', 'ยอดขาย'],
    headerKeywords: ['income', 'revenue', 'received', 'รายได้', 'รับแล้ว'],
    signatureFields: ['income_amount'],
    weight: 1.0,
  },
  {
    type: 'trial_balance',
    namePatterns: ['tb', 'trial balance', 'งบทดลอง'],
    headerKeywords: ['account code', 'account name', 'debit', 'credit', 'เดบิต', 'เครดิต'],
    signatureFields: ['account_code', 'account_name'],
    weight: 1.0,
  },
  {
    // The accounting system's "Posted and Unposted GL Report" is the most
    // common export in this business, so it is matched on its own vocabulary
    // rather than on the sheet name — which is invariably just "Sheet 1".
    type: 'general_ledger',
    namePatterns: ['gl', 'general ledger', 'ledger', 'บัญชีแยกประเภท', 'gl report'],
    headerKeywords: [
      'voucher no',
      'vendor/customer',
      'debit',
      'credit',
      'balance',
      'tax date',
      'ref. code (proj./dpt)',
      'module',
      'posted and unposted',
      'เลขที่เอกสาร',
      'เดบิต',
      'เครดิต',
    ],
    signatureFields: ['debit', 'credit', 'balance', 'voucher_no'],
    weight: 1.25,
  },
  {
    type: 'summary',
    namePatterns: ['summary', 'summarize', 'conclude', 'overview', 'สรุป', 'สรุปรวม'],
    headerKeywords: ['total', 'summary', 'รวม', 'สรุป'],
    signatureFields: [],
    weight: 0.8,
  },
];

/**
 * Data-only sheets whose name prefix says they feed another sheet. Detected so
 * the inspector can show them without treating them as a report on their own.
 */
export const DATA_SHEET_PREFIXES = ['data_', 'data ', 'raw_', 'raw '];

/** Minimum score before a sheet is accepted as classified rather than `unknown`. */
export const CLASSIFICATION_THRESHOLD = 1.0;
