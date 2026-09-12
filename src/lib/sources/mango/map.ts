import { round2 } from '@/lib/calc/aggregate';
import type { IncomeCategory, ImportIssue, NormalizedDataset, SourceRef } from '@/lib/types';
import { emptyDataset } from '@/lib/types';
import type { MangoBundle, MangoTransaction, MangoTransactionDetail, MangoValue } from './types';

/**
 * Turning Mango's sales ledger into the records this system reports on.
 *
 * Three decisions here are accounting decisions rather than plumbing, and each
 * is the kind that would otherwise be buried in a coercion:
 *
 *   A cancelled booking is not a receivable. Mango keeps cancelled rows in the
 *   same list with `cancel_status` set, and summing the list without checking
 *   would report money nobody owes.
 *
 *   What has been collected is the receipts, not a column. `transaction` has no
 *   "received" field; `transaction_detail` has one row per receipt. Collected
 *   is their sum per contract, which is also why a receipt for a contract that
 *   is not in the transaction list is reported rather than dropped.
 *
 *   The asking price is what the project expects to sell for. Summing the
 *   active price list gives the total sale value that revenue recognition
 *   needs and that somebody has been typing in by hand.
 */

export interface MangoMapOptions {
  /** The date this pull represents. Every record is stamped with it. */
  reportDate: string;
  /** Acc project id per Mango project code, where one is known. */
  projectIdByCode?: Map<string, string>;
}

export interface MangoMapResult {
  data: NormalizedDataset;
  issues: ImportIssue[];
  /** Total asking price of the active price list, per Mango project code. */
  saleValueByProject: Map<string, number>;
  /**
   * Receipts by the kind Mango files them under, with totals.
   *
   * Reported rather than acted on: which kinds count as payment of the
   * contract price is an accounting decision.
   */
  collectedByDoctype: Map<string, { count: number; amount: number }>;
  /**
   * Receipts banked, by month.
   *
   * Collections, not income raised — Mango issues no monthly invoice. Returned
   * rather than written into the income ledger, where it would be added to the
   * contracts it is payment for and count the same money twice.
   */
  collectedByMonth: Map<string, number>;
  /** Monthly targets, per Mango project code and month, for the budget screen. */
  targets: { projectCode: string | null; month: string; income: number | null; expense: number | null }[];
  counts: {
    contracts: number;
    cancelled: number;
    /** Rows Mango has retired, kept in the list and not counted. */
    superseded: number;
    /** Receipts against contracts absent from the pull — the sign of a short pull. */
    receiptsWithoutContract: number;
    receipts: number;
    orphanReceipts: number;
    units: number;
  };
}

// ------------------------------------------------------------------ coercion

/** Mango sends money as a number, a numeric string, or a string with commas. */
function money(value: MangoValue): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;

  const cleaned = value.replace(/[,\s฿]/g, '');
  if (cleaned === '' || cleaned === '-') return 0;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: MangoValue): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * A date as YYYY-MM-DD, or null.
 *
 * Mango mixes ISO timestamps with `dd/MM/yyyy`, and its Thai screens sometimes
 * carry a Buddhist year. A year past 2400 is converted rather than accepted:
 * left alone it would make every due date 543 years away and every receivable
 * read as not yet due.
 */
export function mangoDate(value: MangoValue): string | null {
  const raw = text(value);
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return normaliseYear(Number(iso[1]), iso[2]!, iso[3]!);

  const slashed = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashed) {
    return normaliseYear(
      Number(slashed[3]),
      String(slashed[2]).padStart(2, '0'),
      String(slashed[1]).padStart(2, '0'),
    );
  }

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

function normaliseYear(year: number, month: string, day: string): string | null {
  const gregorian = year > 2400 ? year - 543 : year;
  if (gregorian < 1900 || gregorian > 2200) return null;
  return `${gregorian}-${month}-${day}`;
}

/** Mango marks a flag with Y, 1, true or a Thai word; anything else is not set. */
function flagged(value: MangoValue): boolean {
  const raw = text(value);
  if (!raw) return false;
  if (/^(n|0|false|no)$/i.test(raw)) return false;
  return true;
}

/**
 * Whether a row is still the live one.
 *
 * Deliberately not `flagged()`. A retired row is marked "N"; everything else,
 * including a build that does not send the column at all, is live. Requiring a
 * positive Y instead would drop every row the moment Mango stopped sending it,
 * turning a whole project into zero without an error anywhere.
 */
function live(value: MangoValue): boolean {
  return !/^n$/i.test(text(value) ?? '');
}

// ------------------------------------------------------------------- mapping

export function mapMangoBundle(bundle: MangoBundle, options: MangoMapOptions): MangoMapResult {
  const { reportDate, projectIdByCode = new Map() } = options;
  const data = emptyDataset();
  const issues: ImportIssue[] = [];

  const transactions = Array.isArray(bundle.transaction) ? bundle.transaction : [];
  const details = Array.isArray(bundle.transaction_detail) ? bundle.transaction_detail : [];
  const pricelist = Array.isArray(bundle.pricelist) ? bundle.pricelist : [];
  const saleTargets = Array.isArray(bundle.sale_target) ? bundle.sale_target : [];

  const ref = (row: number, note: string): SourceRef => ({
    file: 'Mango RE — All_Transaction_Data',
    sheet: note,
    row,
    col: 1,
    cell: `${note}!${row}`,
  });

  // --- receipts, grouped by the contract they belong to
  const receiptsByDoc = new Map<string, MangoTransactionDetail[]>();
  for (const detail of details) {
    const docno = text(detail.docno);
    if (!docno) continue;
    const existing = receiptsByDoc.get(docno);
    if (existing) existing.push(detail);
    else receiptsByDoc.set(docno, [detail]);
  }

  let cancelled = 0;
  let contracts = 0;
  let superseded = 0;
  const seenDocs = new Set<string>();
  /**
   * Why a contract is not in the receivable list, where it is in the pull.
   *
   * A receipt against a contract that was cancelled is a refund, and a receipt
   * against a contract that is nowhere in the pull means the contract is
   * invisible to this account — the pull is short, and the collected figure
   * with it. Counting those together hides the second behind the first.
   */
  const droppedDocs = new Map<string, 'cancelled' | 'superseded' | 'empty'>();

  transactions.forEach((row, index) => {
    const docno = text(row.docno);
    const project = text(row.pre_event2);
    const unit = text(row.pre_event);

    // A superseded row is not a second contract. Mango keeps the old row in
    // the same list marked inactive when a unit is rebooked, so summing
    // without checking reports the same unit's money more than once.
    if (!live(row.active)) {
      superseded += 1;
      if (docno) droppedDocs.set(docno, 'superseded');
      return;
    }

    // A cancelled booking is not a receivable. Mango keeps the row with
    // cancel_status set, and summing the list without checking would report
    // money nobody owes.
    if (flagged(row.cancel_status)) {
      cancelled += 1;
      if (docno) droppedDocs.set(docno, 'cancelled');
      return;
    }

    const contractual = money(row.netamount) || money(row.amount);
    const receipts = docno ? (receiptsByDoc.get(docno) ?? []) : [];
    const received = round2(receipts.reduce((sum, r) => sum + money(r.amount), 0));

    // A row with no money on it is a placeholder, not a contract.
    if (contractual === 0 && received === 0) {
      if (docno) droppedDocs.set(docno, 'empty');
      return;
    }

    if (docno) seenDocs.add(docno);
    contracts += 1;

    if (received > contractual + 1) {
      issues.push({
        severity: 'warning',
        code: 'MANGO_OVERPAID',
        message:
          `${unit ?? docno ?? 'A contract'} has receipts of ${received.toLocaleString()} `
          + `against a contract value of ${contractual.toLocaleString()}. Either the contract value `
          + 'was revised down after payment, or a receipt is filed against the wrong contract.',
        source: ref(index + 1, 'transaction'),
      });
    }

    data.receivable.push({
      kind: 'receivable',
      sourceRef: ref(index + 1, 'transaction'),
      projectId: project ? projectIdByCode.get(project) ?? null : null,
      projectLabel: project,
      category: stageOf(row),
      customer: text(row.customer_name) ?? text(row.customer_code),
      unit,
      contractualAmount: contractual,
      receiveAmount: received,
      // Derived rather than read: the sheet's own accrued column is the figure
      // this system has always recomputed, and Mango has none at all.
      accrueAmount: round2(contractual - received),
      // What the buyer has to complete by. Without it a receivable cannot be
      // aged, and unaged money is money nobody is chasing.
      dueDate: mangoDate(row.transfer_due_date) ?? mangoDate(row.transfer_date),
    });
  });

  // --- receipts filed against a contract that is not in the list
  /**
   * What kind of receipt each payment is.
   *
   * Every receipt filed against a contract is summed as money collected
   * against that contract, which assumes they are all payments of the contract
   * price. A real pull collected more than was ever contracted, so at least
   * some of them are not — transfer fees, common area charges and tax are all
   * filed against the same contract and are not payments of it.
   *
   * Which ones is an accounting question, not a coercion, so this reports the
   * kinds and their totals rather than quietly picking some to drop.
   */
  const byDoctype = new Map<string, { count: number; amount: number }>();
  for (const detail of details) {
    const kind = text(detail.doctype) ?? '(no type)';
    const held = byDoctype.get(kind) ?? { count: 0, amount: 0 };
    held.count += 1;
    held.amount = round2(held.amount + money(detail.amount));
    byDoctype.set(kind, held);
  }

  let orphanReceipts = 0;
  const orphansByCause = { cancelled: 0, superseded: 0, empty: 0, unknown: 0 };
  for (const [docno, rows] of receiptsByDoc) {
    if (seenDocs.has(docno)) continue;
    orphanReceipts += rows.length;
    orphansByCause[droppedDocs.get(docno) ?? 'unknown'] += rows.length;
  }
  if (orphanReceipts > 0) {
    issues.push({
      severity: 'warning',
      code: 'MANGO_ORPHAN_RECEIPT',
      message:
        `${orphanReceipts} receipt${orphanReceipts === 1 ? '' : 's'} belong`
        + `${orphanReceipts === 1 ? 's' : ''} to no contract in the receivable list, and `
        + `${orphanReceipts === 1 ? 'is' : 'are'} not counted as collections: `
        + [
          orphansByCause.cancelled && `${orphansByCause.cancelled} against cancelled bookings`,
          orphansByCause.superseded && `${orphansByCause.superseded} against replaced bookings`,
          orphansByCause.empty && `${orphansByCause.empty} against rows carrying no contract value`,
          orphansByCause.unknown && `${orphansByCause.unknown} against contracts absent from this pull entirely`,
        ].filter(Boolean).join(', ') + '.',
      source: ref(0, 'transaction_detail'),
    });
  }

  // --- collections, by the month they were banked in
  //
  // Deliberately NOT written into the income ledger. Mango RE is one ledger:
  // its transactions are the receivables and its details are the payments
  // against them. This system has two, and a figure that appears in both is
  // counted twice — revenue would read as the contracts plus the receipts for
  // the same contracts. That is the exact defect the income-overlap rule was
  // written to catch, and it should not be introduced on the way in.
  //
  // The monthly figure is real and useful, so it is returned for the caller to
  // report rather than filed under a heading that means something else. It is
  // collections, not income raised: Mango raises no monthly invoice.
  const collectedByMonth = new Map<string, number>();
  let undatedReceipts = 0;

  for (const detail of details) {
    const amount = money(detail.amount);
    if (amount === 0) continue;

    const date = mangoDate(detail.rcptdate);
    if (!date) {
      undatedReceipts += 1;
      continue;
    }

    const month = date.slice(0, 7);
    collectedByMonth.set(month, round2((collectedByMonth.get(month) ?? 0) + amount));
  }

  /**
   * Receipts whose contract is nowhere in the pull.
   *
   * The other causes are bookkeeping — a refund on a cancelled booking is
   * meant to sit outside the receivable list. This one is different: the
   * contract exists, somebody paid against it, and this account cannot see it.
   * Every figure derived from the pull is short by whatever those contracts
   * hold, and nothing else in the output would say so.
   */
  if (orphansByCause.unknown > 0) {
    issues.push({
      severity: 'error',
      code: 'MANGO_INCOMPLETE_PULL',
      message:
        `${orphansByCause.unknown} receipt${orphansByCause.unknown === 1 ? '' : 's'} `
        + `${orphansByCause.unknown === 1 ? 'is' : 'are'} filed against contracts this pull did not `
        + 'return at all — not cancelled, not replaced, simply absent. Money was collected against '
        + 'contracts this account cannot see, so the contracted and outstanding totals are short by '
        + 'whatever those contracts hold. Widen the account\u2019s project rights before trusting '
        + 'these figures.',
      source: ref(0, 'transaction_detail'),
    });
  }

  if (undatedReceipts > 0) {
    issues.push({
      severity: 'warning',
      code: 'MANGO_UNDATED_RECEIPT',
      message:
        `${undatedReceipts} receipt${undatedReceipts === 1 ? '' : 's'} carr`
        + `${undatedReceipts === 1 ? 'ies' : 'y'} no usable date. `
        + `${undatedReceipts === 1 ? 'It still counts' : 'They still count'} towards what a `
        + `customer has paid, but ${undatedReceipts === 1 ? 'it cannot' : 'they cannot'} be placed `
        + `in a month, so the monthly collection figure is short by ${undatedReceipts === 1 ? 'its' : 'their'} value.`,
      source: ref(0, 'transaction_detail'),
    });
  }

  // --- what each project expects to sell for
  const saleValueByProject = new Map<string, number>();
  const unitsByProject = new Map<string, number>();
  const units = new Set<string>();
  for (const row of pricelist) {
    // An inactive unit is not for sale, and counting it would overstate what
    // the project can earn.
    if (!live(row.active)) continue;

    const project = text(row.pre_event2);

    /**
     * `asking_price`, and only that.
     *
     * `revise` was read here as a revised price, on the reasonable-sounding
     * assumption that a column named revise beside a price holds one. It does
     * not: it is the revision number. Preferring it priced 1,839 units at
     * 24,035 baht in total — about thirteen baht each — and reported that as
     * what a project expects to sell for.
     */
    const price = money(row.asking_price);
    if (price === 0) continue;

    const unit = text(row.pre_event);
    if (unit) units.add(unit);
    if (!project) continue;

    unitsByProject.set(project, (unitsByProject.get(project) ?? 0) + 1);
    saleValueByProject.set(project, round2((saleValueByProject.get(project) ?? 0) + price));
  }

  // --- monthly targets, which the budget screen compares actuals against
  const targets = saleTargets
    .map((row) => {
      const year = Number(text(row.year));
      const month = Number(text(row.month));
      if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;

      const gregorian = year > 2400 ? year - 543 : year;
      return {
        projectCode: text(row.pre_event2),
        month: `${gregorian}-${String(month).padStart(2, '0')}`,
        income: hasValue(row.target_sale_amount) ? money(row.target_sale_amount) : null,
        expense: hasValue(row.budget) ? money(row.budget) : hasValue(row.expenses) ? money(row.expenses) : null,
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  void reportDate;

  /**
   * A sanity check on the price column.
   *
   * This is where the last mistake would have been caught: a sale value
   * averaging thirteen baht a unit is not a cheap project, it is the wrong
   * column. The threshold is deliberately far below any real Thai condominium
   * unit, so it fires on a misread and never on a genuine figure.
   */
  for (const [project, value] of saleValueByProject) {
    const count = unitsByProject.get(project) ?? 0;
    if (count === 0) continue;
    const average = value / count;
    if (average >= 50_000) continue;

    issues.push({
      severity: 'error',
      code: 'MANGO_IMPLAUSIBLE_PRICE',
      message:
        `${project} prices ${count} units at ${Math.round(value).toLocaleString('en-US')} in total — `
        + `about ${Math.round(average).toLocaleString('en-US')} each. That is not a price; the price `
        + 'column has been misread or has changed. The sale value for this project is not usable.',
      source: ref(0, 'pricelist'),
    });
  }

  /**
   * Collected more than was ever contracted.
   *
   * Per contract this is a warning — a price revised down, a receipt on the
   * wrong contract. Across the whole pull it is neither: it means the two
   * sides are measuring different things, and an outstanding balance computed
   * from them is a negative number presented as a debt.
   */
  const totalContracted = round2(data.receivable.reduce((sum, r) => sum + r.contractualAmount, 0));
  const totalReceived = round2(data.receivable.reduce((sum, r) => sum + r.receiveAmount, 0));

  if (totalReceived > totalContracted && totalContracted > 0) {
    const kinds = [...byDoctype.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .slice(0, 6)
      .map(([kind, held]) => `${kind} ${Math.round(held.amount).toLocaleString('en-US')}`)
      .join(', ');

    issues.push({
      severity: 'error',
      code: 'MANGO_COLLECTED_EXCEEDS_CONTRACTED',
      message:
        `Receipts total ${Math.round(totalReceived).toLocaleString('en-US')} against contracts of `
        + `${Math.round(totalContracted).toLocaleString('en-US')} — `
        + `${Math.round(totalReceived - totalContracted).toLocaleString('en-US')} more collected than `
        + 'was ever owed, which makes the outstanding balance negative. Not every receipt filed '
        + 'against a contract is a payment of it: transfer fees, common area charges and tax are '
        + `filed the same way. The kinds present, by value: ${kinds}. Decide which are payments of `
        + 'the contract before these figures are used.',
      source: ref(0, 'transaction_detail'),
    });
  }

  return {
    data,
    issues,
    saleValueByProject,
    collectedByDoctype: byDoctype,
    collectedByMonth,
    targets,
    counts: {
      contracts,
      cancelled,
      superseded,
      receipts: details.length,
      orphanReceipts,
      receiptsWithoutContract: orphansByCause.unknown,
      units: units.size,
    },
  };
}

const hasValue = (value: MangoValue) => value !== null && value !== undefined && String(value).trim() !== '';

/**
 * How far along a contract is, in the categories this system reports.
 *
 * Read from the furthest stage the row has reached rather than from a type
 * column, because Mango records progress as a set of status flags and a
 * contract that has transferred is no longer a booking.
 */
function stageOf(row: MangoTransaction): IncomeCategory {
  if (flagged(row.transfer_status)) return 'transfer_fee';
  if (flagged(row.down_status)) return 'down_payment';
  if (flagged(row.contract_status)) return 'contract';
  if (flagged(row.book_status)) return 'reservation';
  return 'contract';
}
