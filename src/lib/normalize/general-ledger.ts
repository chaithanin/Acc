import { columnOf } from '@/lib/detect/header-detector';
import { normalizeText } from '@/lib/detect/normalize-text';
import { cellText, getCell, makeSourceRef, parseDateText, parseNumeric } from '@/lib/excel/cells';
import type { GlRecord, WipRecord } from '@/lib/types';
import { dataRows, type NormalizeContext } from './context';

/**
 * General-ledger reports ("Posted and Unposted GL Report").
 *
 * Layout produced by the accounting system:
 *
 *     row 1   GL : 1.5.1. Posted and Unposted GL Report (All Module)
 *     row 2   (v_gl_rpt313) Report Date : 12/08/2026 09:37:15   <- print time
 *     row 4   บริษัท … จำกัด                                     <- company
 *     row 5   (Module : ALL) Date : 01/01/2026 - 31/08/2026      <- period
 *     row 6   Account Code = 1190902
 *     row 8   Date | Voucher No. | … | Debit | Credit | Balance
 *     row 9   A/C (1190902) เงินมัดจำค่าสินค้าและบริการ           <- account
 *     row 10  BF                       175,159.00  0.00  175,159.00
 *     …       transactions
 *     row n   Total A/C 1190902 / Grand Total
 *
 * A workbook may hold several accounts, each introduced by its own `A/C (…)`
 * banner, so the account is tracked as rows are read rather than assumed once.
 *
 * Two things come out of this: the transaction detail (audit trail) and one
 * account-level summary per account (which is what the KPIs consume).
 */

export interface GlResult {
  entries: GlRecord[];
  /** One per account: opening, movement and closing balance. */
  accounts: WipRecord[];
}

/** `A/C (1190902) เงินมัดจำค่าสินค้าและบริการ` */
const ACCOUNT_BANNER = /^A\/C\s*\(([^)]+)\)\s*(.*)$/i;
/** `Total A/C 1190902`, `Grand Total` */
const TOTAL_ROW = /^(grand\s+total|total\s+a\/c\b)/i;
/** The brought-forward opening line. */
const BROUGHT_FORWARD = /^(bf|b\/f|brought\s+forward|ยอดยกมา)$/i;
/** Month summary lines such as `May'26` that trail the transaction block. */
const MONTH_SUMMARY = /^[A-Za-z]{3,9}['’]\s*\d{2,4}$/;

export function normalizeGeneralLedger(ctx: NormalizeContext): GlResult {
  const { sheet, detection } = ctx;

  const debitCol = columnOf(detection.columns, 'debit');
  const creditCol = columnOf(detection.columns, 'credit');

  // Without debit and credit this is not a ledger we can read.
  if (debitCol === null || creditCol === null) return { entries: [], accounts: [] };

  const header = headerAccount(ctx);
  let account = header;

  const entries: GlRecord[] = [];
  const accumulators = new Map<string, AccountAccumulator>();

  for (const row of dataRows(ctx)) {
    const firstText = firstTextOf(ctx, row.rowIndex);

    // A banner switches the account every subsequent row belongs to.
    const banner = ACCOUNT_BANNER.exec(firstText);
    if (banner) {
      account = { code: banner[1].trim(), name: banner[2].trim() || header.name };
      continue;
    }

    // The footer states the accounting system's own closing balance. It is
    // captured for reconciliation but never imported as a transaction.
    if (TOTAL_ROW.test(firstText)) {
      const stated = row.num('balance');
      if (stated !== null) accumulatorFor(accumulators, account).statedClosing = stated;
      continue;
    }
    if (MONTH_SUMMARY.test(firstText)) continue;

    const debit = row.amount('debit');
    const credit = row.amount('credit');
    const balance = row.num('balance');
    const isOpening = BROUGHT_FORWARD.test(firstText) || BROUGHT_FORWARD.test(row.text('voucher_no') ?? '');

    const entryDate = row.date('date') ?? parseDateText(firstText);

    // A ledger line needs either a date or a voucher; anything else is a
    // layout artefact such as a blank separator or a stray note.
    const voucherNo = row.text('voucher_no');
    if (!isOpening && !entryDate && !voucherNo) continue;
    if (!isOpening && debit === 0 && credit === 0 && balance === null) continue;

    const accumulator = accumulatorFor(accumulators, account);

    if (isOpening) {
      accumulator.opening = balance ?? debit - credit;
    } else {
      accumulator.debit += debit;
      accumulator.credit += credit;
    }
    if (balance !== null) accumulator.closing = balance;
    accumulator.lastRow = row.rowIndex;

    entries.push({
      kind: 'gl',
      sourceRef: makeSourceRef(ctx.fileName, sheet, row.rowIndex, debitCol),
      projectId: ctx.defaultProjectId,
      projectLabel: ctx.defaultProjectLabel,
      accountCode: account.code,
      accountName: account.name,
      entryDate,
      voucherNo,
      vendor: row.text('vendor') ?? row.text('customer'),
      description: row.text('description') ?? row.text('note'),
      costCode: row.text('cost_code'),
      module: row.text('module'),
      job: row.text('job'),
      debit,
      credit,
      balance,
      isOpeningBalance: isOpening,
    });
  }

  const accounts: WipRecord[] = [...accumulators.values()].map((acc) => ({
    kind: 'wip',
    sourceRef: makeSourceRef(ctx.fileName, sheet, acc.lastRow, columnOf(detection.columns, 'balance')),
    projectId: ctx.defaultProjectId,
    projectLabel: ctx.defaultProjectLabel,
    accountCode: acc.code,
    accountName: acc.name,
    // Movement for the period covered by the report.
    currentPeriod: round2(acc.debit - acc.credit),
    // The closing balance is the account's position at the report date.
    ytd: round2(acc.closing ?? acc.opening + acc.debit - acc.credit),
    // These ledgers are advance/deposit accounts, so the balance IS the
    // outstanding advance still to be cleared.
    advancePayment: round2(acc.closing ?? acc.opening + acc.debit - acc.credit),
    statedClosing: acc.statedClosing,
  }));

  return { entries, accounts };
}

interface AccountRef {
  code: string | null;
  name: string | null;
}

interface AccountAccumulator extends AccountRef {
  opening: number;
  debit: number;
  credit: number;
  /** Running balance from the last posting read. */
  closing: number | null;
  /** Balance printed on the account's Total / Grand Total footer. */
  statedClosing: number | null;
  lastRow: number;
}

function accumulatorFor(
  map: Map<string, AccountAccumulator>,
  account: AccountRef,
): AccountAccumulator {
  const key = account.code ?? account.name ?? 'unknown';
  let acc = map.get(key);
  if (!acc) {
    acc = {
      code: account.code,
      name: account.name,
      opening: 0,
      debit: 0,
      credit: 0,
      closing: null,
      statedClosing: null,
      lastRow: 0,
    };
    map.set(key, acc);
  }
  return acc;
}

/**
 * Reads `Account Code = 1190902` from the report preamble, so an account is
 * known even before the first `A/C (…)` banner appears.
 */
function headerAccount(ctx: NormalizeContext): AccountRef {
  const limit = Math.min(ctx.sheet.rowCount, ctx.detection.headerRow ?? 12);
  for (let r = 0; r < limit; r += 1) {
    for (let c = 0; c < Math.min(ctx.sheet.colCount, 4); c += 1) {
      const text = cellText(getCell(ctx.sheet, r, c));
      if (!text) continue;
      const match = /account\s*code\s*[=:]\s*([\w.\-]+)/i.exec(text);
      if (match) return { code: match[1].trim(), name: null };
    }
  }
  return { code: null, name: null };
}

function firstTextOf(ctx: NormalizeContext, rowIndex: number): string {
  const row = ctx.sheet.rows[rowIndex];
  if (!row || row.length === 0) return '';
  for (const cell of row) {
    const text = cellText(cell);
    if (text) return text;
  }
  return '';
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Extracts the reporting period from the GL preamble.
 *
 * `(Module : ALL) Date : 01/01/2026 - 31/08/2026` — the END of the range is the
 * report date. The `Report Date :` line above it is when the report was
 * printed, which is a different thing and must not be used.
 */
export function detectGlReportDate(rows: string[]): string | null {
  for (const text of rows) {
    const normalized = normalizeText(text);
    if (!normalized.includes('date')) continue;

    const range = /(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})\s*[-–—]\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/.exec(text);
    if (range) {
      const end = parseDateText(range[2]);
      if (end) return end;
    }
  }
  return null;
}

/** Detects the GL preamble regardless of sheet name. */
export function looksLikeGlReport(surfaceText: string[]): boolean {
  return surfaceText.some((text) => /posted and unposted gl report|v_gl_rpt/i.test(text));
}

export function parseNumericText(text: string): number | null {
  return parseNumeric({ v: text, t: 's' }).value;
}
