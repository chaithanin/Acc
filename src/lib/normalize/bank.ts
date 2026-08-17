import type { BankRecord } from '@/lib/types';
import { dataRows, type NormalizeContext } from './context';
import { extractKeyValues } from './key-value';

/**
 * Bank statement / cash position sheets.
 *
 * Handles both a per-account table and the very common summary layout where
 * "Bank Current Amount" and "Pending Expense" are single labelled figures.
 */
export function normalizeBank(ctx: NormalizeContext): BankRecord[] {
  const tabular = normalizeTable(ctx);
  if (tabular.length > 0) return tabular;
  return normalizeSummary(ctx);
}

function normalizeTable(ctx: NormalizeContext): BankRecord[] {
  const { detection } = ctx;
  const hasAmount = detection.columns.some(
    (c) => c.field === 'bank_current_amount' || c.field === 'pending_expense',
  );
  if (!hasAmount || detection.headerRow === null) return [];

  const records: BankRecord[] = [];

  for (const row of dataRows(ctx)) {
    if (row.isTotalRow()) continue;

    const current = row.num('bank_current_amount');
    const pending = row.num('pending_expense');
    if (current === null && pending === null) continue;

    const project = row.project();

    records.push({
      kind: 'bank',
      sourceRef: row.ref('bank_current_amount'),
      projectId: project.id,
      projectLabel: project.label,
      bankName: row.text('bank_name') ?? row.text('description'),
      accountNo: row.text('bank_account'),
      currentAmount: current ?? 0,
      pendingExpense: pending ?? 0,
    });
  }

  return records;
}

/**
 * Label/value fallback. Emitted as a single record so the KPI engine sees one
 * cash position for the sheet rather than a table of one-line accounts.
 */
function normalizeSummary(ctx: NormalizeContext): BankRecord[] {
  const hits = extractKeyValues(ctx.sheet, ctx.fileName, {
    fields: ['bank_current_amount', 'pending_expense'],
  });
  if (hits.length === 0) return [];

  // Sum repeated labels: a summary sheet often lists several bank accounts,
  // each with its own labelled balance.
  let current = 0;
  let pending = 0;
  let currentSeen = false;
  let pendingSeen = false;
  let ref = hits[0].valueRef;

  for (const hit of hits) {
    if (hit.field === 'bank_current_amount') {
      current += hit.value;
      if (!currentSeen) ref = hit.valueRef;
      currentSeen = true;
    } else if (hit.field === 'pending_expense') {
      pending += hit.value;
      pendingSeen = true;
    }
  }

  if (!currentSeen && !pendingSeen) return [];

  return [
    {
      kind: 'bank',
      sourceRef: ref,
      projectId: ctx.defaultProjectId,
      projectLabel: ctx.defaultProjectLabel,
      bankName: null,
      accountNo: null,
      currentAmount: current,
      pendingExpense: pending,
    },
  ];
}
