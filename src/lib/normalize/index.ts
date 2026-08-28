import { emptyDataset, type NormalizedDataset } from '@/lib/types';
import { normalizeBank } from './bank';
import { normalizeBoq } from './boq';
import { normalizeCashflow } from './cashflow';
import type { NormalizeContext } from './context';
import { normalizeGeneralLedger } from './general-ledger';
import { normalizeExpense, normalizeIncome } from './income-expense';
import { extractKeyValues } from './key-value';
import { normalizePayable } from './payable';
import { normalizeReceivable } from './receivable';
import { normalizeWip } from './wip';

export type { NormalizeContext } from './context';

/**
 * Routes a classified sheet to the extractor for its report type.
 *
 * `financial_report` and `summary` sheets are roll-ups rather than a single
 * kind of record, so they run several extractors and keep whatever each finds.
 */
export function normalizeSheet(ctx: NormalizeContext): NormalizedDataset {
  const data = emptyDataset();
  const { reportType } = ctx.detection;

  switch (reportType) {
    case 'bank_statement':
      data.bank = normalizeBank(ctx);
      break;

    case 'receivable':
      data.receivable = normalizeReceivable(ctx);
      break;

    case 'payable':
      data.payable = normalizePayable(ctx);
      break;

    case 'wip':
      data.wip = normalizeWip(ctx);
      break;

    case 'boq':
      data.boq = normalizeBoq(ctx);
      break;

    case 'cashflow':
      data.cashflow = normalizeCashflow(ctx);
      break;

    case 'income':
      data.income = normalizeIncome(ctx);
      break;

    case 'expense':
      data.expense = normalizeExpense(ctx);
      break;

    case 'financial_report':
    case 'summary':
      return normalizeRollup(ctx);

    case 'general_ledger': {
      // Transaction detail plus one account-level summary. Only the summary
      // reaches the KPIs, so a ledger is never counted twice.
      const gl = normalizeGeneralLedger(ctx);
      data.gl = gl.entries;
      data.wip = gl.accounts;
      break;
    }

    case 'trial_balance':
      // Read as WIP-shaped account rows: code, name and period amounts.
      data.wip = normalizeWip(ctx);
      break;

    case 'unknown':
    default:
      // An unclassified sheet still gets the label/value sweep — a summary tab
      // with no table often carries the headline bank figures.
      data.bank = normalizeBank(ctx);
      break;
  }

  return data;
}

/**
 * Roll-up sheets mix several report shapes on one tab. Every extractor is run
 * and only non-empty results are kept, so a Conclude sheet contributes its
 * bank position and its receivable lines without needing a dedicated parser.
 */
function normalizeRollup(ctx: NormalizeContext): NormalizedDataset {
  const data = emptyDataset();

  data.bank = normalizeBank(ctx);
  data.receivable = normalizeReceivable(ctx);

  // Only fall back to generic income/expense rows when the sheet did not
  // already yield receivables, otherwise the same money is counted twice.
  if (data.receivable.length === 0) {
    data.income = normalizeIncome(ctx);
    data.expense = normalizeExpense(ctx);
  }

  data.cashflow = normalizeCashflow(ctx);

  return data;
}

/**
 * Sweeps a sheet for labelled figures regardless of type. Used by the Data
 * Inspector so developers can see what the label matcher found on any tab.
 */
export function inspectKeyValues(ctx: NormalizeContext) {
  return extractKeyValues(ctx.sheet, ctx.fileName, { minScore: 0.7 });
}
