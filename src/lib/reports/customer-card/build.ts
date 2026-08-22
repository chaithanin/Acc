import { monthKey } from '@/lib/excel/cells';
import { groupContracts } from './group';
import { monthsToCompletion, solveEir, upliftTable } from './interest';
import type {
  CheckRow,
  ContractGroup,
  CustomerCardRow,
  ReportIssue,
  ReportModel,
  ReportOptions,
  ReportSummary,
} from './types';

/**
 * Assembling the report.
 *
 * Every figure here comes from the customer card or from arithmetic over it.
 * Where the two disagree — the plan not adding up to the contract price, the
 * outstanding not matching what was paid — the difference is reported and left
 * standing. Nothing is nudged to make a total balance, because a report that
 * balances by construction cannot tell anybody that the data does not.
 */

/** Issues about the assumptions rather than about the unit's own figures. */
const ADVISORY_CODES = new Set(['EIR_IMPLAUSIBLE']);

export function buildReport(rows: CustomerCardRow[], options: ReportOptions): ReportModel {
  const { contracts, issues } = groupContracts(rows, options.reportDate);

  const months = monthGrid(contracts, options.completionDate);
  const completionMonth = options.completionDate.slice(0, 7);
  const anchorMonth = firstPlanMonth(contracts) ?? months[0] ?? completionMonth;
  const uplift = upliftTable(months, completionMonth, options.maxUplift, anchorMonth);

  const eir = new Map<string, number>();

  for (const contract of contracts) {
    const expected = expectedSellingPrice(contract, uplift, options);
    const result = solveEir(contract.plan, options.completionDate, expected, contract.onKey);
    eir.set(contract.key, result.rate);

    // A plausible effective rate for these contracts is a few per cent. A very
    // high one is arithmetically correct and financially meaningless: it means
    // the uplift is being carried by a small part of the plan, which happens
    // when the completion date or the uplift assumption does not match the
    // schedule the customer card actually contains.
    const IMPLAUSIBLE_RATE = 0.25;
    if (result.solved && result.rate > IMPLAUSIBLE_RATE) {
      const issue: ReportIssue = {
        severity: 'warning',
        code: 'EIR_IMPLAUSIBLE',
        message: `${contract.unit} solves to an effective interest rate of ${(result.rate * 100).toFixed(1)}%. That is arithmetically right but not a real financing rate; check the completion date (${options.completionDate}) and the ${(options.maxUplift * 100).toFixed(0)}% uplift against this unit's payment schedule.`,
        unit: contract.unit,
        contractNo: contract.contractNo,
      };
      contract.issues.push(issue);
      issues.push(issue);
    }

    if (!result.solved) {
      const issue: ReportIssue = {
        severity: 'warning',
        code: 'EIR_NOT_SOLVED',
        message: `No effective interest rate could be solved for ${contract.unit}: ${result.reason} The rate is reported as ${(result.rate * 100).toFixed(2)}% and the interest figures for this unit should not be relied on.`,
        unit: contract.unit,
        contractNo: contract.contractNo,
      };
      contract.issues.push(issue);
      issues.push(issue);
    }
  }

  const checks = reconcile(contracts, options, issues);
  const summary = summarise(rows, contracts, checks, uplift, options, issues);

  return { options, months, contracts, eir, uplift, anchorMonth, checks, issues, summary };
}

/**
 * The earliest month any contract has an instalment falling due.
 *
 * This anchors the uplift, and it is deliberately not the first month of the
 * grid. A deposit received before the plan began would otherwise lengthen the
 * schedule and shave a few per cent off every expected price in the project.
 */
export function firstPlanMonth(contracts: ContractGroup[]): string | null {
  let earliest: string | null = null;
  for (const contract of contracts) {
    for (const month of contract.plan.keys()) {
      if (earliest === null || month < earliest) earliest = month;
    }
  }
  return earliest;
}

/** A payment plan longer than this is a data error, not a plan. */
const MAX_MONTHS = 240;

/**
 * The month columns.
 *
 * Runs from the earliest month anything happens to the later of the last
 * instalment and completion. Future instalments are never trimmed: a plan
 * running to 2029 is the report's own subject matter, not overflow.
 */
export function monthGrid(contracts: ContractGroup[], completionDate: string): string[] {
  const keys = new Set<string>();

  for (const contract of contracts) {
    for (const month of contract.plan.keys()) keys.add(month);
    for (const month of contract.paid.keys()) keys.add(month);
    if (contract.contractDate) keys.add(monthKey(contract.contractDate));
  }

  if (keys.size === 0) return [];

  const sorted = [...keys].sort();
  const first = sorted[0];
  const last = maxMonth(sorted[sorted.length - 1], completionDate.slice(0, 7));

  const months: string[] = [];
  let [year, month] = first.split('-').map(Number);

  for (;;) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    months.push(key);
    if (key === last) break;
    // A grid this long means the dates are wrong, not that the plan is. It
    // should be unreachable — implausible due dates are dropped before this —
    // so stopping here silently would hide whatever got through.
    if (months.length >= MAX_MONTHS) {
      throw new Error(
        `The payment dates span more than ${Math.round(MAX_MONTHS / 12)} years (${first} to ${last}). Check the customer card for a placeholder date such as 31/12/2088.`,
      );
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return months;
}

function maxMonth(a: string, b: string): string {
  return a >= b ? a : b;
}

/** Sale price uplifted by the month the contract starts in. */
export function expectedSellingPrice(
  contract: ContractGroup,
  uplift: Map<string, number>,
  options: ReportOptions,
): number {
  const start = startMonth(contract);
  if (!start) return contract.salePrice;

  const rate =
    uplift.get(start) ??
    // A contract starting after the last month in the grid — possible only if
    // the grid was cut short — falls back to its own months remaining.
    (monthsToCompletion(start, options.completionDate.slice(0, 7)) === 0 ? 0 : options.maxUplift);

  return contract.salePrice * (1 + rate);
}

/** First of the month the contract began in. */
export function startMonth(contract: ContractGroup): string | null {
  return contract.contractDate ? monthKey(contract.contractDate) : null;
}

/** Everything due under the contract, the handover instalment included. */
export function planTotal(contract: ContractGroup): number {
  return [...contract.plan.values()].reduce((sum, v) => sum + v, contract.onKey);
}

export function paidTotal(contract: ContractGroup): number {
  return [...contract.paid.values()].reduce((sum, v) => sum + v, 0);
}

/**
 * The per-unit reconciliation behind the Data_Check sheet.
 *
 * `Outstanding calculated` is sale price less what has been received.
 * `Outstanding source` is what the card itself last reported. Where the two
 * disagree the row says CHECK and the amount of the disagreement, which is the
 * only useful thing to say — the report cannot know which of the two is right.
 */
function reconcile(
  contracts: ContractGroup[],
  options: ReportOptions,
  issues: ReportIssue[],
): CheckRow[] {
  const seenUnits = new Map<string, string[]>();
  const seenContracts = new Map<string, string[]>();

  for (const contract of contracts) {
    const units = seenUnits.get(contract.unit) ?? [];
    units.push(contract.key);
    seenUnits.set(contract.unit, units);

    if (contract.contractNo) {
      const list = seenContracts.get(contract.contractNo) ?? [];
      list.push(contract.unit);
      seenContracts.set(contract.contractNo, list);
    }
  }

  for (const [unit, keys] of seenUnits) {
    if (keys.length > 1) {
      issues.push({
        severity: 'warning',
        code: 'UNIT_WITH_SEVERAL_CONTRACTS',
        message: `Unit ${unit} appears under ${keys.length} different contracts. Each is reported as its own row; confirm the unit was genuinely resold.`,
        unit,
      });
    }
  }

  for (const [contractNo, units] of seenContracts) {
    if (new Set(units).size > 1) {
      issues.push({
        severity: 'error',
        code: 'CONTRACT_ACROSS_UNITS',
        message: `Contract ${contractNo} covers more than one unit (${[...new Set(units)].join(', ')}). The grouping is by contract, so these units share one row.`,
        contractNo,
      });
    }
  }

  return contracts.map((contract) => {
    const plan = planTotal(contract);
    const paid = paidTotal(contract);
    const calculated = contract.salePrice - paid;
    const source = contract.outstandingFromSource;
    const difference = source === null ? null : source - calculated;

    const notes: string[] = [];
    let status: CheckRow['status'] = 'OK';

    const fail = (note: string) => {
      status = 'ERROR';
      notes.push(note);
    };
    const warn = (note: string) => {
      if (status !== 'ERROR') status = 'CHECK';
      notes.push(note);
    };

    if (contract.salePriceSource === 'missing' || contract.salePrice === 0) {
      fail('No sale price on the card.');
    } else if (contract.salePriceSource === 'contract') {
      warn('ราคาขายสุทธิ was blank; ราคาขายตามสัญญา used.');
    }

    if (!contract.contractNo) warn('No contract number.');
    if (!contract.contractDate) fail('No dates at all, so the contract has no start month.');

    if (paid > contract.salePrice + options.tolerance) {
      fail(`Paid exceeds the sale price by ${(paid - contract.salePrice).toFixed(2)}.`);
    }
    if (calculated < -options.tolerance) fail('Outstanding is negative.');

    if (contract.salePrice > 0 && Math.abs(plan - contract.salePrice) > options.tolerance) {
      warn(
        `The instalment plan totals ${plan.toFixed(2)} against a sale price of ${contract.salePrice.toFixed(2)}.`,
      );
    }

    if (difference !== null && Math.abs(difference) > options.tolerance) {
      warn(`Outstanding differs from the card by ${difference.toFixed(2)}.`);
    }
    if (source === null) warn('The card reports no outstanding figure to check against.');

    // Status is about whether this unit's money reconciles. An assumption that
    // looks wrong is worth saying — it goes in the note — but it is not a fault
    // in the row, and marking every row CHECK because the completion date is
    // unconfirmed would make the column useless.
    const substantive = contract.issues.filter((i) => !ADVISORY_CODES.has(i.code));
    if (substantive.some((i) => i.severity === 'error')) status = 'ERROR';
    else if (substantive.length > 0 && status === 'OK') status = 'CHECK';

    for (const issue of contract.issues) notes.push(issue.code);

    return {
      unit: contract.unit,
      contractNo: contract.contractNo,
      salePrice: contract.salePrice,
      planTotal: plan,
      paidTotal: paid,
      outstandingSource: source,
      outstandingCalculated: calculated,
      difference,
      status,
      note: notes.join(' '),
    };
  });
}

function summarise(
  rows: CustomerCardRow[],
  contracts: ContractGroup[],
  checks: CheckRow[],
  uplift: Map<string, number>,
  options: ReportOptions,
  issues: ReportIssue[],
): ReportSummary {
  const totalSalePrice = contracts.reduce((sum, c) => sum + c.salePrice, 0);
  const totalExpected = contracts.reduce(
    (sum, c) => sum + expectedSellingPrice(c, uplift, options),
    0,
  );

  const needsConfirmation: string[] = [
    `Expected building completion ${options.completionDate} — carried over from the previous report; the customer card does not contain it.`,
    `Selling-price uplift of ${(options.maxUplift * 100).toFixed(0)}% over the full schedule — carried over from the previous report.`,
  ];

  if (issues.some((i) => i.code === 'RECEIPT_DUPLICATE_SUSPECTED')) {
    needsConfirmation.push(
      'One or more receipts appear more than once for the same amount on the same day. Both amounts are included; confirm they are two allocations of one receipt and not the same line entered twice.',
    );
  }

  return {
    sourceRows: rows.length,
    contracts: contracts.filter((c) => c.contractNo).length,
    units: new Set(contracts.map((c) => c.unit)).size,
    totalSalePrice,
    totalExpectedSellingPrice: totalExpected,
    totalPlan: contracts.reduce((sum, c) => sum + planTotal(c), 0),
    totalPaid: contracts.reduce((sum, c) => sum + paidTotal(c), 0),
    totalOutstanding: checks.reduce((sum, c) => sum + c.outstandingCalculated, 0),
    totalInterestExpense: totalExpected - totalSalePrice,
    ok: checks.filter((c) => c.status === 'OK').length,
    check: checks.filter((c) => c.status === 'CHECK').length,
    error: checks.filter((c) => c.status === 'ERROR').length,
    needsConfirmation,
  };
}
