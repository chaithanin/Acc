import { monthKey } from '@/lib/excel/cells';
import type { ContractGroup, CustomerCardRow, ReportIssue } from './types';

/**
 * How far past the report date a due date can be and still mean something.
 *
 * The sales system takes 31/12/2088 as "on transfer, date not yet set", and a
 * mistyped contract year turns up as an instalment due in 2035. Either one
 * stretches the month grid across half a century of empty columns, and the
 * second is simply wrong. Ten years covers every real payment plan here — the
 * longest runs to 2030 — with room to spare.
 */
const HORIZON_YEARS = 10;

/**
 * Turning a payment ledger into one row per unit.
 *
 * The customer card carries one line per instalment. The report wants one line
 * per unit, with the instalments spread across months — twice: once by the date
 * they were DUE, and once by the date the cash actually arrived. The two are
 * different matrices and mixing them is the single most consequential mistake
 * available here, so they are built separately and never fall back on each
 * other.
 */

export interface GroupResult {
  contracts: ContractGroup[];
  issues: ReportIssue[];
}

/** Contract number where there is one; the unit otherwise. */
function groupKey(row: CustomerCardRow): string {
  const contract = row.contractNo?.trim();
  if (contract) return `C:${contract}`;
  return `U:${row.unit?.trim() ?? ''}`;
}

export function groupContracts(rows: CustomerCardRow[], reportDate: string): GroupResult {
  const issues: ReportIssue[] = [];
  const horizon = `${Number(reportDate.slice(0, 4)) + HORIZON_YEARS}-12-31`;
  const byKey = new Map<string, CustomerCardRow[]>();

  for (const row of rows) {
    const key = groupKey(row);
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }

  const contracts: ContractGroup[] = [];

  for (const [key, cardRows] of byKey) {
    const first = cardRows[0];
    const unit = (first.unit ?? '').trim();

    const netPrice = firstNumber(cardRows, (r) => r.netPrice);
    const contractPrice = firstNumber(cardRows, (r) => r.contractPrice);

    // ราคาขายสุทธิ first, ราคาขายตามสัญญา only when it is absent. Never the
    // sum of the instalments: a plan that is short by one instalment would
    // then quietly redefine the contract instead of failing its check.
    const salePrice = netPrice ?? contractPrice ?? 0;
    const salePriceSource: ContractGroup['salePriceSource'] =
      netPrice !== null ? 'net' : contractPrice !== null ? 'contract' : 'missing';

    const group: ContractGroup = {
      key,
      unit,
      contractNo: first.contractNo?.trim() ?? null,
      customerName: cardRows.find((r) => r.customerName)?.customerName ?? null,
      salePrice,
      salePriceSource,
      contractDate: earliestDate(cardRows),
      plan: new Map(),
      paid: new Map(),
      onKey: 0,
      outstandingFromSource: lastOutstanding(cardRows),
      rows: cardRows,
      issues: [],
    };

    buildPlan(group, issues, horizon);
    buildPaid(group, issues);
    contracts.push(group);
  }

  // Ordered by unit so the report reads the way the building does, and so two
  // runs over the same file produce identical files.
  contracts.sort((a, b) => a.unit.localeCompare(b.unit, 'en', { numeric: true }));

  return { contracts, issues };
}

function firstNumber(
  rows: CustomerCardRow[],
  pick: (row: CustomerCardRow) => number | null,
): number | null {
  for (const row of rows) {
    const value = pick(row);
    if (value !== null && value !== 0) return value;
  }
  return null;
}

/**
 * The contract's start.
 *
 * The card has no contract-date column, so the earliest date on it is used —
 * the booking, in practice. Where a row has neither date, it contributes
 * nothing rather than a guess.
 */
function earliestDate(rows: CustomerCardRow[]): string | null {
  const dates = rows
    .flatMap((r) => [r.dueDate, r.paidDate])
    .filter((d): d is string => !!d)
    .sort();
  return dates[0] ?? null;
}

function lastOutstanding(rows: CustomerCardRow[]): number | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i].outstanding !== null) return rows[i].outstanding;
  }
  return null;
}

/** Instalment types that fall due on handover rather than in a month. */
const ON_KEY_PATTERNS = ['โอน', 'รับโอน', 'งวดโอน', 'on key', 'onkey', 'transfer', 'งวดสุดท้าย'];

function isOnKey(installmentType: string | null): boolean {
  if (!installmentType) return false;
  const text = installmentType.toLowerCase();
  return ON_KEY_PATTERNS.some((p) => text.includes(p));
}

/** InsPlan: amounts due, bucketed by วันครบกำหนดชำระ. */
function buildPlan(group: ContractGroup, issues: ReportIssue[], horizon: string): void {
  for (const row of group.rows) {
    if (row.dueAmount === null || row.dueAmount === 0) continue;

    // A due date past the horizon is not a date, it is a placeholder or a
    // typo. Treated as absent rather than believed, so it cannot drag the
    // report across fifty years of empty months.
    let dueDate = row.dueDate;
    if (dueDate && dueDate > horizon) {
      const issue: ReportIssue = {
        severity: 'warning',
        code: 'DUE_DATE_IMPLAUSIBLE',
        message: `${describe(row)} is due ${dueDate}, which is past any real payment plan. It is treated as having no due date${isOnKey(row.installmentType) ? ' and counted on On Key' : ', so this amount is not placed in any month'}.`,
        unit: group.unit,
        contractNo: group.contractNo,
        sourceRow: row.sourceRow,
      };
      group.issues.push(issue);
      issues.push(issue);
      dueDate = null;
    }

    // A handover instalment with no scheduled date goes to the On Key column.
    // It is a real part of the price; leaving it out because it has no month
    // would put every unit's plan roughly half short of its contract.
    if (!dueDate && isOnKey(row.installmentType)) {
      group.onKey += row.dueAmount;
      continue;
    }

    if (!dueDate) {
      const issue: ReportIssue = {
        severity: 'warning',
        code: 'DUE_WITHOUT_DATE',
        message: `${describe(row)} has an amount due of ${row.dueAmount.toLocaleString()} but no due date, so it could not be placed in a month.`,
        unit: group.unit,
        contractNo: group.contractNo,
        sourceRow: row.sourceRow,
      };
      group.issues.push(issue);
      issues.push(issue);
      continue;
    }

    // Nobody pays eleven years early. A due date long after the payment that
    // settled it is a mistyped year — C2035080001 for C2025080001, and the due
    // date follows the contract number. Reported, not moved: guessing the year
    // would be inventing a date, and the source is the thing to fix.
    if (row.paidDate && dueDate > addYears(row.paidDate, 2)) {
      const issue: ReportIssue = {
        severity: 'warning',
        code: 'DUE_DATE_AFTER_PAYMENT',
        message: `${describe(row)} is due ${dueDate} but was paid ${row.paidDate}, more than two years earlier. The due date looks mistyped; it is used as it stands and stretches the report to ${dueDate.slice(0, 7)}.`,
        unit: group.unit,
        contractNo: group.contractNo,
        sourceRow: row.sourceRow,
      };
      group.issues.push(issue);
      issues.push(issue);
    }

    const key = monthKey(dueDate);
    group.plan.set(key, (group.plan.get(key) ?? 0) + row.dueAmount);
  }
}

/**
 * InsPaid: cash received, bucketed by วันที่ชำระ.
 *
 * One receipt is routinely applied across several instalments and so appears on
 * several rows; each row carries the part applied to that instalment, and the
 * parts are what add up to the cash received. They are therefore summed, not
 * de-duplicated — dropping a repeat would drop real money.
 *
 * What IS reported is the shape that cannot be told apart from a data-entry
 * duplicate: the same receipt, the same amount, the same day, on the same unit,
 * twice. That is flagged for a human rather than silently resolved either way,
 * because both resolutions are wrong some of the time.
 */
function buildPaid(group: ContractGroup, issues: ReportIssue[]): void {
  const seen = new Map<string, number>();

  for (const row of group.rows) {
    if (row.paidAmount === null || row.paidAmount === 0) {
      if (row.paidDate && row.paidAmount === null) {
        const issue: ReportIssue = {
          severity: 'warning',
          code: 'PAYMENT_DATE_WITHOUT_AMOUNT',
          message: `${describe(row)} has a payment date of ${row.paidDate} but no amount.`,
          unit: group.unit,
          contractNo: group.contractNo,
          sourceRow: row.sourceRow,
        };
        group.issues.push(issue);
        issues.push(issue);
      }
      continue;
    }

    if (!row.paidDate) {
      const issue: ReportIssue = {
        severity: 'warning',
        code: 'PAYMENT_WITHOUT_DATE',
        message: `${describe(row)} records ${row.paidAmount.toLocaleString()} paid but no payment date. The due date was NOT used in its place, so this amount is not in InsPaid.`,
        unit: group.unit,
        contractNo: group.contractNo,
        sourceRow: row.sourceRow,
      };
      group.issues.push(issue);
      issues.push(issue);
      continue;
    }

    if (row.receiptNo) {
      // The instalment is part of the signature. One receipt clearing four
      // down payments of the same size on the same day is the normal case and
      // looked identical without it — which flagged a third of the project.
      // What remains is the same instalment paid twice by one receipt, which
      // is not something the sales system should ever produce.
      const signature = `${row.receiptNo}|${row.paidDate}|${row.paidAmount}|${row.installmentType ?? ''}`;
      const count = (seen.get(signature) ?? 0) + 1;
      seen.set(signature, count);

      if (count > 1) {
        const issue: ReportIssue = {
          severity: 'warning',
          code: 'RECEIPT_DUPLICATE_SUSPECTED',
          message: `Receipt ${row.receiptNo} appears ${count} times on ${group.unit} for ${row.paidAmount.toLocaleString()} on ${row.paidDate}, against the same instalment (${row.installmentType ?? 'unnamed'}). Both amounts are included; confirm this is not the same line entered twice.`,
          unit: group.unit,
          contractNo: group.contractNo,
          sourceRow: row.sourceRow,
        };
        group.issues.push(issue);
        issues.push(issue);
      }
    }

    const key = monthKey(row.paidDate);
    group.paid.set(key, (group.paid.get(key) ?? 0) + row.paidAmount);
  }
}

function addYears(isoDate: string, years: number): string {
  return `${Number(isoDate.slice(0, 4)) + years}${isoDate.slice(4)}`;
}

function describe(row: CustomerCardRow): string {
  const parts = [row.unit, row.installmentType].filter(Boolean);
  return parts.length ? parts.join(' / ') : `Row ${row.sourceRow}`;
}
