import type { ReportType } from './detection-rules';
import type { CanonicalField } from './field-synonyms';

/**
 * Seed template mappings (requirement 26).
 *
 * A template is a hint, not a hard-coded reader: when its match rules fire, its
 * column hints are applied ON TOP of header detection, and its cell map is used
 * only for fields that header detection could not resolve. That ordering is
 * what keeps requirement 25 true — cell positions are a fallback, never the
 * sole strategy.
 *
 * Templates are stored in `template_mappings` and editable at runtime.
 */

export interface TemplateMatchRules {
  /** Any one matching is enough. Matched loosely against the file name. */
  fileNamePatterns?: string[];
  sheetNamePatterns?: string[];
  /** ALL of these must appear among the detected headers. */
  requiredHeaders?: string[];
}

export interface DefaultTemplate {
  name: string;
  reportType: ReportType;
  /** Alias of the project this template implies, resolved at seed time. */
  projectAlias: string | null;
  description: string;
  matchRules: TemplateMatchRules;
  /** canonical field -> the header text to bind it to. */
  columnMap?: Partial<Record<CanonicalField, string>>;
  /** canonical field -> "A1"-style address, used only as a last resort. */
  cellMap?: Partial<Record<CanonicalField, string>>;
  priority: number;
}

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    name: 'Financial Summary Template',
    reportType: 'financial_report',
    projectAlias: null,
    description:
      'Group-level FINANCIAL REPORT / Conclude workbooks carrying the headline bank position.',
    matchRules: {
      fileNamePatterns: ['financial report', 'financial', 'conclude'],
      sheetNamePatterns: ['financial report', 'conclude', 'summarize', 'summary'],
    },
    columnMap: {
      bank_current_amount: 'Bank Current Amount',
      pending_expense: 'Pending Expense',
    },
    priority: 50,
  },
  {
    name: 'Hamonia Receivable Template',
    reportType: 'receivable',
    projectAlias: 'Hamonia',
    description: 'Hamonia / SUN9 customer and receivable reports.',
    matchRules: {
      fileNamePatterns: ['hamonia', 'harmonia', 'sun9', 'sun 9', 'sun09'],
      sheetNamePatterns: ['summary', 'report sun', 'การ์ดลูกหนี้', 'ค้างรับ'],
    },
    columnMap: {
      contractual_amount: 'Contractual Amount',
      receive_amount: 'Receive Amount',
      accrue_amount: 'Accrue Amount',
    },
    priority: 40,
  },
  {
    name: 'VTR Receivable Template',
    reportType: 'receivable',
    projectAlias: 'VTR',
    description: 'Marina Golden Bay / VTR reservation and down-payment reports.',
    matchRules: {
      fileNamePatterns: ['vtr', 'marina', 'victoria', 'reservation', 'down'],
      sheetNamePatterns: ['summary', 'report vtr', 'vtr ค้างรับ', 'data_vtr'],
    },
    columnMap: {
      contractual_amount: 'Contractual Amount',
      receive_amount: 'Receive Amount',
      accrue_amount: 'Accrue Amount',
    },
    priority: 40,
  },
  {
    name: 'Sun9 WIP Template',
    reportType: 'wip',
    projectAlias: 'SUN9',
    description: 'SUN9 work-in-progress account ledger.',
    matchRules: {
      fileNamePatterns: ['sun9', 'sun09', 'sun 9', 'wip'],
      sheetNamePatterns: ['wip sun09', 'wip sun9', 'data_sun9', 'fn sun'],
      requiredHeaders: ['account'],
    },
    columnMap: {
      account_code: 'Account Code',
      account_name: 'Account Name',
      current_period: 'Current Period',
      ytd: 'YTD',
      advance_payment: 'Advance Payment',
    },
    priority: 40,
  },
  {
    name: 'VTR WIP Template',
    reportType: 'wip',
    projectAlias: 'VTR',
    description: 'Marina Golden Bay / VTR work-in-progress account ledger.',
    matchRules: {
      fileNamePatterns: ['vtr', 'marina', 'victoria'],
      sheetNamePatterns: ['vtr wip', 'data_vtr', 'fn vtr'],
      requiredHeaders: ['account'],
    },
    columnMap: {
      account_code: 'Account Code',
      account_name: 'Account Name',
      current_period: 'Current Period',
      ytd: 'YTD',
      advance_payment: 'Advance Payment',
    },
    priority: 40,
  },
  {
    name: 'BOQ Monthly Template',
    reportType: 'boq',
    projectAlias: null,
    description: 'Monthly construction cost sheets ("คชจ BOQ แต่ละเดือน").',
    matchRules: {
      sheetNamePatterns: ['boq', 'คชจ', 'construction'],
    },
    columnMap: {
      boq_amount: 'BOQ',
      paid_amount: 'Paid',
      pending_amount: 'Pending',
      contractor: 'Contractor',
    },
    priority: 45,
  },
];
