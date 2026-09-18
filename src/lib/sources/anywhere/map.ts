import { round2 } from '@/lib/calc/aggregate';
import { emptyDataset, type ImportIssue, type NormalizedDataset, type SourceRef } from '@/lib/types';
import {
  BUNDLE_SOURCES,
  type AnywhereApAgeing,
  type AnywhereArAgeing,
  type AnywhereBundle,
} from './types';

/**
 * Turning Mango Anywhere's dashboard answers into the records reported here.
 *
 * This is the accounting system: what the group is owed, what it owes, and what
 * is in the bank. Until now all three arrived because somebody exported a
 * workbook.
 *
 * Two decisions in here are accounting decisions rather than plumbing.
 *
 * The monthly figures are collections and payments — cash moved — not revenue
 * and expense. They are returned for reporting and deliberately not written
 * into the income or expense ledgers, because the balances already carry the
 * invoiced amounts and writing both would report the same money twice. That is
 * the double count the income-overlap rule exists to catch, and the same trap
 * the estate-side receipts fell into.
 *
 * A bank guarantee is not cash. Mango serves it from the same endpoint as the
 * bank balances with one parameter changed, which makes it easy to add to the
 * cash position by accident. It is kept apart and reported separately.
 */

export interface AnywhereMapOptions {
  /** The date these figures represent. */
  reportDate: string;
  /** The Mango company code the figures belong to. */
  maincode: string;
  /** Acc project id, where the company maps to a single project. */
  projectId?: string | null;
  /**
   * Negate the bank balances.
   *
   * Mango returned every one of eleven accounts as a negative number, which is
   * a sign convention rather than a company nine figures overdrawn — but which
   * convention is a question for whoever knows the chart of accounts, so it is
   * answered here rather than assumed. Left unset, the balances are taken as
   * they arrive and a negative total is refused.
   */
  flipBankSign?: boolean;
}

export interface AnywhereMapResult {
  data: NormalizedDataset;
  issues: ImportIssue[];
  /** Receipts banked by month — collections, not revenue. Reported, not filed. */
  collectedByMonth: Map<string, number>;
  /** Payments made by month. */
  paidByMonth: Map<string, number>;
  /** Mango's own ageing bands, as it returns them. */
  ageing: {
    receivable: { band: string; amount: number }[];
    payable: { band: string; amount: number }[];
  };
  totals: {
    receivable: number;
    receivableOutstanding: number;
    payable: number;
    payableOutstanding: number;
    cash: number;
    guarantees: number;
  };
  counts: {
    customers: number;
    vendors: number;
    bankAccounts: number;
    guaranteeAccounts: number;
  };
  /** Bank balances grouped by the type Mango files them under. */
  bankByType: Map<string, { count: number; amount: number }>;
}

/** Mango sends money as a number, a numeric string, or a string with commas. */
function money(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  const cleaned = value.replace(/[,\s฿]/g, '');
  if (!cleaned || cleaned === '-') return 0;
  // (1,234) is negative in Thai accounting exports.
  const negative = /^\(.*\)$/.test(cleaned);
  const parsed = Number.parseFloat(negative ? cleaned.slice(1, -1) : cleaned);
  if (!Number.isFinite(parsed)) return 0;
  return negative ? -parsed : parsed;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

export function mapAnywhereBundle(
  bundle: AnywhereBundle,
  options: AnywhereMapOptions,
): AnywhereMapResult {
  const { maincode, projectId = null, flipBankSign = false } = options;
  const bankSign = flipBankSign ? -1 : 1;
  // reportDate is part of the contract and belongs to the import wrapper rather
  // than to any record here; the records are a position, not a period.
  void options.reportDate;
  const data = emptyDataset();
  const issues: ImportIssue[] = [];

  const ref = (part: keyof AnywhereBundle, row: number): SourceRef => ({
    file: `Mango Anywhere — ${maincode}`,
    sheet: BUNDLE_SOURCES[part],
    row,
    col: 1,
    cell: `${BUNDLE_SOURCES[part]}!${row}`,
  });

  // ------------------------------------------------------------- receivable

  const arBalances = bundle.arBalances ?? [];
  let receivableTotal = 0;
  let receivableOutstanding = 0;
  let arInconsistent = 0;

  /**
   * `balance_amt` is what is owed. `total_amt` is not what was invoiced.
   *
   * Read as invoiced-less-outstanding, the live answer had customers owing
   * three times what had been billed to them, sixteen of twenty-seven of them
   * individually impossible. What settles it is that the ageing bands total
   * exactly the sum of `balance_amt` — 22,655,727 to the baht — so the balance
   * is the balance, and `total_amt` beside a `total_inv` of one to four
   * invoices is this period's billing rather than the account's history.
   *
   * So nothing here derives a payment. A balance is what is unpaid; that is
   * what it is recorded as, and what was collected is a question these two
   * columns cannot answer.
   */
  arBalances.forEach((row, index) => {
    const outstanding = money(row.balance_amt);
    const billedThisPeriod = money(row.total_amt);
    if (outstanding === 0 && billedThisPeriod === 0) return;
    if (outstanding === 0) return;

    if (billedThisPeriod > 0 && outstanding > billedThisPeriod + 1) arInconsistent += 1;

    receivableTotal = round2(receivableTotal + billedThisPeriod);
    receivableOutstanding = round2(receivableOutstanding + outstanding);

    data.receivable.push({
      kind: 'receivable',
      sourceRef: ref('arBalances', index + 1),
      projectId,
      projectLabel: text(row.maincode) ?? maincode,
      category: 'other_income',
      customer: text(row.customer_name) ?? text(row.customer_code),
      unit: null,
      // The whole of a balance is outstanding, by definition.
      contractualAmount: round2(outstanding),
      receiveAmount: 0,
      accrueAmount: round2(outstanding),
      dueDate: null,
    });
  });

  if (arInconsistent > 0) {
    issues.push({
      severity: 'info',
      code: 'ANYWHERE_TOTAL_AMT_IS_NOT_THE_HISTORY',
      message:
        // "1 of 27 customers owes": the noun follows the population, the verb
        // follows the count. Pluralising the noun from the count produced
        // "1 of 27 customer owes".
        `${arInconsistent} of ${arBalances.length} customers owe`
        + `${arInconsistent === 1 ? 's' : ''} more than total_amt shows against them, which is why `
        + 'total_amt is not treated as everything ever invoiced. Alongside a '
        + 'total_inv of a handful of documents it reads as this period\u2019s billing. Only the '
        + 'balance is used, and no figure here claims to say what was collected.',
      source: ref('arBalances', 0),
    });
  }

  // ---------------------------------------------------------------- payable

  const apBalances = bundle.apBalances ?? [];
  let payableTotal = 0;
  let payableOutstanding = 0;

  apBalances.forEach((row, index) => {
    const outstanding = money(row.balance_amt);
    const billedThisPeriod = money(row.total_amt);
    if (outstanding === 0) return;

    payableTotal = round2(payableTotal + billedThisPeriod);
    payableOutstanding = round2(payableOutstanding + outstanding);

    data.payable.push({
      kind: 'payable',
      sourceRef: ref('apBalances', index + 1),
      projectId,
      projectLabel: text(row.mainname) ?? maincode,
      vendor: text(row.cust_name),
      // `acct_no` is the ledger account, not an invoice number. Putting it
      // where an invoice number goes would make every row look documented.
      invoiceNo: null,
      description: text(row.acct_no) ? `account ${text(row.acct_no)}` : null,
      category: text(row.grade_vender),
      invoiceDate: null,
      dueDate: null,
      // A balance owed is wholly unpaid; nothing here knows what was paid.
      invoiceAmount: round2(outstanding),
      paidAmount: 0,
      statedOutstanding: round2(outstanding),
    });
  });

  // ------------------------------------------------------------------- bank

  const bankAccounts = bundle.bankAccounts ?? [];
  let cash = 0;
  /**
   * What kind of account each balance belongs to.
   *
   * The live answer summed to minus 112 million, which is not a cash position.
   * Eleven accounts arrive from one endpoint and `account_type` distinguishes
   * them, so the likeliest reading is that the list is not all cash — an
   * overdraft or a loan account is a balance the other way round.
   *
   * Which types are cash is a question for whoever knows the chart of
   * accounts, so the types are reported with their totals rather than guessed
   * at, and a negative total is refused rather than published.
   */
  const bankByType = new Map<string, { count: number; amount: number }>();

  bankAccounts.forEach((row, index) => {
    const balance = round2(money(row.balamt) * bankSign);
    cash = round2(cash + balance);

    const kind = text(row.account_type) ?? '(no type)';
    const held = bankByType.get(kind) ?? { count: 0, amount: 0 };
    held.count += 1;
    held.amount = round2(held.amount + balance);
    bankByType.set(kind, held);

    data.bank.push({
      kind: 'bank',
      sourceRef: ref('bankAccounts', index + 1),
      projectId,
      projectLabel: maincode,
      bankName: text(row.name_eng) ?? text(row.name),
      accountNo: text(row.account_code) ?? text(row.ac_code),
      currentAmount: round2(balance),
      pendingExpense: round2(money(row.expenses)),
    });
  });

  if (cash < 0) {
    const types = [...bankByType.entries()]
      .sort((a, b) => a[1].amount - b[1].amount)
      .map(([kind, held]) => `type ${kind} — ${held.count} account${held.count === 1 ? '' : 's'}, `
        + `${Math.round(held.amount).toLocaleString('en-US')}`)
      .join('; ');

    /**
     * Every account negative is a convention. Some negative is a mixture.
     *
     * A company does not hold eleven bank accounts that are all overdrawn. If
     * the sign is uniform the reading is that Mango keeps these the accounting
     * way round; if it is mixed, the list contains liabilities among the
     * assets. Those want different answers, and calling both "not a cash
     * position" leaves the reader to work out which they have.
     */
    const balances = bankAccounts.map((row) => money(row.balamt)).filter((value) => value !== 0);
    const allNegative = balances.length > 0 && balances.every((value) => value < 0);

    issues.push({
      severity: 'error',
      code: allNegative ? 'ANYWHERE_BANK_SIGN_INVERTED' : 'ANYWHERE_BANK_TOTAL_NEGATIVE',
      message: allNegative
        ? `All ${balances.length} bank accounts came back negative, totalling `
          + `${Math.round(cash).toLocaleString('en-US')}. A group does not hold `
          + `${balances.length} overdrawn accounts, so this is a sign convention rather than a `
          + `position: read the other way round it is ${Math.round(-cash).toLocaleString('en-US')}. `
          + `By account_type: ${types}. Confirm that against one account in Mango\u2019s own screen `
          + 'and the figure becomes usable — a cash position with the sign wrong is worse than none.'
        : `The bank accounts sum to ${Math.round(cash).toLocaleString('en-US')}, which is not a cash `
          + 'position. Some are positive and some negative, so the list holds liabilities among the '
          + `assets — an overdraft or a loan account. By account_type: ${types}. Say which of those `
          + 'are cash and the figure becomes usable; until then it is not.',
      source: ref('bankAccounts', 0),
    });
  }

  /**
   * Guarantees are counted and kept out.
   *
   * Same endpoint, one parameter different, and adding them to cash would
   * overstate the money available by whatever the bank is holding against the
   * group's obligations.
   */
  const guarantees = round2((bundle.bankGuarantees ?? [])
    .reduce((sum, row) => sum + money(row.balamt), 0));

  if (guarantees > 0) {
    issues.push({
      severity: 'info',
      code: 'ANYWHERE_GUARANTEES_EXCLUDED',
      message:
        `${(bundle.bankGuarantees ?? []).length} bank guarantee account`
        + `${(bundle.bankGuarantees ?? []).length === 1 ? '' : 's'} holding `
        + `${Math.round(guarantees).toLocaleString('en-US')} `
        + `${(bundle.bankGuarantees ?? []).length === 1 ? 'is' : 'are'} reported separately and `
        + `${(bundle.bankGuarantees ?? []).length === 1 ? 'is' : 'are'} not part of the cash `
        + 'position. A guarantee is money the bank is holding, not money to spend.',
      source: ref('bankGuarantees', 0),
    });
  }

  // --------------------------------------------------------- monthly, apart

  const collectedByMonth = new Map<string, number>();
  for (const row of bundle.arByMonth ?? []) {
    const year = Number.parseInt(String(row.rl_year ?? ''), 10);
    const month = Number.parseInt(String(row.rl_month ?? ''), 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) continue;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    collectedByMonth.set(key, round2((collectedByMonth.get(key) ?? 0) + money(row.receipt_net_amount)));
  }

  const paidByMonth = new Map<string, number>();
  for (const row of bundle.apByMonth ?? []) {
    const year = Number.parseInt(String(row.pay_year ?? ''), 10);
    const month = Number.parseInt(String(row.pay_month ?? ''), 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) continue;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    paidByMonth.set(key, round2((paidByMonth.get(key) ?? 0) + money(row.pay_amount)));
  }

  // ----------------------------------------------------------------- ageing

  const receivableAgeing = (bundle.arAgeing ?? [])
    .map((row: AnywhereArAgeing) => ({
      band: text(row.grade_inv) ?? '(no band)',
      amount: round2(money(row.balamt)),
    }))
    .filter((row) => row.amount !== 0);

  /**
   * The payable ageing arrives the other way round.
   *
   * One row, one column per band, where the receivable ageing is one row per
   * band. Same system, same screen pair, two shapes — so this reads the shape
   * it is given rather than assuming the two match.
   */
  const payableAgeing: { band: string; amount: number }[] = [];
  for (const row of (bundle.apAgeing ?? []) as AnywhereApAgeing[]) {
    for (const [key, value] of Object.entries(row)) {
      if (!/^grade_/i.test(key)) continue;
      const amount = round2(money(value));
      if (amount === 0) continue;
      payableAgeing.push({ band: key.replace(/^grade_/i, 'Grade '), amount });
    }
  }

  /**
   * Does the ageing agree with the balances?
   *
   * Two independent answers to the same question, so a gap between them is
   * worth surfacing rather than choosing between silently.
   */
  const agedTotal = round2(receivableAgeing.reduce((sum, row) => sum + row.amount, 0));
  if (agedTotal > 0 && receivableOutstanding > 0) {
    const gap = Math.abs(agedTotal - receivableOutstanding);
    if (gap / Math.max(agedTotal, receivableOutstanding) > 0.01) {
      issues.push({
        severity: 'warning',
        code: 'ANYWHERE_AGEING_DISAGREES',
        message:
          `The ageing bands total ${Math.round(agedTotal).toLocaleString('en-US')} where the customer `
          + `balances total ${Math.round(receivableOutstanding).toLocaleString('en-US')}. Two answers `
          + 'to the same question, so one of them is measuring something else — worth knowing which '
          + 'before either is reported as the receivable position.',
        source: ref('arAgeing', 0),
      });
    }
  }

  /**
   * Is `total_inv` a count or an amount?
   *
   * Never used here, and said out loud because a column that reads like a
   * total and holds a count is how the estate side priced 1,839 units at
   * thirteen baht each.
   */
  const invValues = arBalances
    .map((row) => money(row.total_inv))
    .filter((value) => value !== 0);
  if (invValues.length > 0) {
    const looksLikeCount = invValues.every((value) => Number.isInteger(value) && value < 1_000);
    issues.push({
      severity: 'info',
      code: 'ANYWHERE_TOTAL_INV_UNUSED',
      message:
        `total_inv is not used in any figure here. Across ${invValues.length} rows it holds `
        + `${looksLikeCount ? 'small whole numbers, so it is a count of invoices'
          : 'values of a size that suggests amounts rather than a count'} — `
        + `${Math.min(...invValues)} to ${Math.max(...invValues)}. Worth confirming before anything `
        + 'starts treating it as money.',
      source: ref('arBalances', 0),
    });
  }

  return {
    data,
    issues,
    collectedByMonth,
    paidByMonth,
    ageing: { receivable: receivableAgeing, payable: payableAgeing },
    totals: {
      receivable: receivableTotal,
      receivableOutstanding,
      payable: payableTotal,
      payableOutstanding,
      cash,
      guarantees,
    },
    bankByType,
    counts: {
      customers: data.receivable.length,
      vendors: data.payable.length,
      bankAccounts: data.bank.length,
      guaranteeAccounts: (bundle.bankGuarantees ?? []).length,
    },
  };
}
