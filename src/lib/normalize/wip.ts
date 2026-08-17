import type { WipRecord } from '@/lib/types';
import { dataRows, type NormalizeContext } from './context';

/**
 * Work-in-progress sheets (Sun9 WIP, VTR WIP).
 *
 * These are account-code ledgers: one row per account with a current-period
 * figure and a year-to-date figure.
 */
export function normalizeWip(ctx: NormalizeContext): WipRecord[] {
  const records: WipRecord[] = [];

  for (const row of dataRows(ctx)) {
    if (row.isTotalRow()) continue;

    const current = row.num('current_period');
    const ytd = row.num('ytd');
    const advance = row.num('advance_payment');
    const fallback = row.num('amount');

    if (current === null && ytd === null && advance === null && fallback === null) continue;

    const accountCode = row.text('account_code');
    const accountName = row.text('account_name') ?? row.text('description');

    // A ledger row with neither a code nor a name is a layout artefact.
    if (!accountCode && !accountName) continue;

    const project = row.project();

    records.push({
      kind: 'wip',
      sourceRef: row.ref('ytd') ?? row.ref('current_period'),
      projectId: project.id,
      projectLabel: project.label,
      accountCode,
      accountName,
      currentPeriod: current ?? fallback ?? 0,
      ytd: ytd ?? 0,
      advancePayment: advance ?? 0,
    });
  }

  return records;
}
