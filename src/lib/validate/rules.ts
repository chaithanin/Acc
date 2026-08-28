import { round2 } from '@/lib/calc/aggregate';
import type { CalculationResult } from '@/lib/calc/kpi';
import type { NormalizedDataset, ValidationResult } from '@/lib/types';

/**
 * Reconciliation rules (requirement 15).
 *
 * Each rule states what the figure SHOULD be from first principles and what
 * was actually imported, then reports the gap. Rules never modify data — they
 * only describe disagreement so a human can decide.
 */

/** Differences under this are rounding noise, not a reconciliation failure. */
const TOLERANCE = 1;
/** Above this a mismatch is an error rather than a warning. */
const ERROR_THRESHOLD = 1000;

export function runValidations(
  data: NormalizedDataset,
  calc: CalculationResult,
  projectId: string | null,
): ValidationResult[] {
  const results: ValidationResult[] = [];

  results.push(...validateReceivableRows(data, projectId));
  results.push(...validateBankIdentity(data, calc, projectId));
  results.push(...validateIncomeComponents(data, projectId));
  results.push(...validateExpenseComponents(data, calc, projectId));
  results.push(...validateBoq(data, calc, projectId));
  results.push(...validateCashflowMonths(calc, projectId));
  results.push(...validateLedgerFooters(data, projectId));
  results.push(...validateTransactionIdentity(data, projectId));

  return results;
}

/**
 * The same transaction, imported twice.
 *
 * Duplicate control was at file level: the same workbook uploaded again, or a
 * second file for a report date already on record. Neither notices a contract
 * repeated inside one file, or an invoice that appears on both a summary tab
 * and a detail tab of the same workbook — and a duplicated payable is a bill
 * the company may pay twice.
 *
 * Keyed on whatever identity the row actually carries: an invoice number for a
 * payable, a voucher number for a ledger posting, customer and unit for a
 * receivable. Rows with no identity at all are not compared, because every
 * blank row would match every other.
 */
function validateTransactionIdentity(
  data: NormalizedDataset,
  projectId: string | null,
): ValidationResult[] {
  const label = 'No transaction appears twice';

  const keyed: { key: string; amount: number; refIndex?: number }[] = [];

  for (const row of data.payable) {
    if (!row.invoiceNo) continue;
    keyed.push({
      key: `payable|${row.vendor ?? ''}|${row.invoiceNo}`,
      amount: row.invoiceAmount,
      refIndex: row.sourceRefIndex,
    });
  }

  for (const row of data.gl) {
    if (!row.voucherNo || row.isOpeningBalance) continue;
    keyed.push({
      key: `gl|${row.voucherNo}|${row.accountCode ?? ''}|${row.debit}|${row.credit}`,
      amount: row.debit || row.credit,
      refIndex: row.sourceRefIndex,
    });
  }

  for (const row of data.receivable) {
    // A customer and a unit together identify an instalment schedule; either
    // alone does not, and a repeated instalment inside one schedule is normal.
    if (!row.customer || !row.unit) continue;
    keyed.push({
      key: `receivable|${row.customer}|${row.unit}|${row.category}|${row.contractualAmount}|${row.dueDate ?? ''}`,
      amount: row.contractualAmount,
      refIndex: row.sourceRefIndex,
    });
  }

  if (keyed.length === 0) {
    return [
      skipped('transaction_identity', label, 'Import', projectId,
        'No imported row carries an invoice number, a voucher number or a customer and unit together.'),
    ];
  }

  const seen = new Map<string, number>();
  let duplicated = 0;
  const refIndexes: number[] = [];

  for (const row of keyed) {
    const before = seen.get(row.key) ?? 0;
    if (before > 0) {
      duplicated = round2(duplicated + row.amount);
      if (row.refIndex !== undefined && row.refIndex >= 0) refIndexes.push(row.refIndex);
    }
    seen.set(row.key, before + 1);
  }

  // Expected nothing repeated; imported whatever was found more than once.
  return [
    compare('transaction_identity', label, 'Import', projectId, 0, duplicated, refIndexes),
  ];
}

/**
 * Our recomputed ledger balance against the accounting system's own printed
 * total.
 *
 * This is the strongest check available: the source system independently
 * states the closing balance, so a mismatch means our reading of the postings
 * is wrong, not merely inconsistent.
 */
function validateLedgerFooters(data: NormalizedDataset, projectId: string | null): ValidationResult[] {
  const stated = data.wip.filter((row) => row.statedClosing !== null);

  if (stated.length === 0) {
    return [
      skipped('ledger_footer', 'Recomputed ledger balance = printed total', 'General Ledger', projectId,
        'No ledger report with a printed total was imported.'),
    ];
  }

  const mismatched = stated.filter(
    (row) => Math.abs(round2(row.ytd - (row.statedClosing ?? 0))) > TOLERANCE,
  );

  if (mismatched.length === 0) {
    const total = round2(stated.reduce((sum, r) => sum + r.ytd, 0));
    return [
      {
        ruleKey: 'ledger_footer',
        label: 'Recomputed ledger balance = printed total',
        scope: 'General Ledger',
        projectId,
        expected: total,
        imported: total,
        difference: 0,
        status: 'pass',
        severity: 'info',
        message:
          `All ${stated.length} ledger account(s) reconcile with the printed Grand Total.`,
        sourceRefIndexes: stated
          .map((r) => r.sourceRefIndex)
          .filter((i): i is number => i !== undefined),
      },
    ];
  }

  const worst = mismatched.reduce((a, b) =>
    Math.abs(a.ytd - (a.statedClosing ?? 0)) > Math.abs(b.ytd - (b.statedClosing ?? 0)) ? a : b,
  );

  return [
    {
      ruleKey: 'ledger_footer',
      label: 'Recomputed ledger balance = printed total',
      scope: 'General Ledger',
      projectId,
      expected: worst.statedClosing,
      imported: round2(worst.ytd),
      difference: round2((worst.statedClosing ?? 0) - worst.ytd),
      status: 'error',
      severity: 'error',
      message:
        `${mismatched.length} of ${stated.length} ledger account(s) do not match the printed total; ` +
        `the largest gap is on account ${worst.accountCode ?? '—'}. Some postings may not have been read.`,
      sourceRefIndexes: mismatched
        .map((r) => r.sourceRefIndex)
        .filter((i): i is number => i !== undefined),
    },
  ];
}

/**
 * Contractual − Received must equal the Accrued figure printed in the file.
 * A mismatch means the sheet's own arithmetic disagrees with itself.
 */
function validateReceivableRows(data: NormalizedDataset, projectId: string | null): ValidationResult[] {
  const mismatched = data.receivable.filter((row) => {
    const expected = round2(row.contractualAmount - row.receiveAmount);
    return Math.abs(expected - round2(row.accrueAmount)) > TOLERANCE;
  });

  if (data.receivable.length === 0) {
    return [
      skipped('receivable_row_identity', 'Contractual − Received = Accrued', 'Receivable rows', projectId,
        'No receivable records were imported.'),
    ];
  }

  if (mismatched.length === 0) {
    return [
      {
        ruleKey: 'receivable_row_identity',
        label: 'Contractual − Received = Accrued',
        scope: 'Receivable rows',
        projectId,
        expected: null,
        imported: null,
        difference: 0,
        status: 'pass',
        severity: 'info',
        message: `All ${data.receivable.length} receivable rows reconcile.`,
        sourceRefIndexes: [],
      },
    ];
  }

  const totalExpected = round2(
    mismatched.reduce((sum, r) => sum + (r.contractualAmount - r.receiveAmount), 0),
  );
  const totalImported = round2(mismatched.reduce((sum, r) => sum + r.accrueAmount, 0));

  return [
    {
      ruleKey: 'receivable_row_identity',
      label: 'Contractual − Received = Accrued',
      scope: 'Receivable rows',
      projectId,
      expected: totalExpected,
      imported: totalImported,
      difference: round2(totalExpected - totalImported),
      status: Math.abs(totalExpected - totalImported) > ERROR_THRESHOLD ? 'error' : 'warning',
      severity: 'warning',
      message:
        `${mismatched.length} of ${data.receivable.length} receivable rows have an accrued amount ` +
        'that does not equal contractual minus received.',
      sourceRefIndexes: mismatched
        .map((r) => r.sourceRefIndex)
        .filter((i): i is number => i !== undefined)
        .slice(0, 200),
    },
  ];
}

/**
 * Pending as the bank sheets state it, against pending as the expense records
 * carry it.
 *
 * This used to compare Available Cash with Bank − Pending, which is how
 * Available Cash is defined: the two were equal by construction and the rule
 * could not fail. It sat on the dashboard beside the real checks in the same
 * green, which overstated how much had been verified.
 *
 * The two figures below are stated independently — one by whoever prepared the
 * bank summary, one by whoever entered the payment run — so they can disagree,
 * and when they do somebody has committed money in one place and not the
 * other.
 */
function validateBankIdentity(
  data: NormalizedDataset,
  calc: CalculationResult,
  projectId: string | null,
): ValidationResult[] {
  if (data.bank.length === 0) {
    return [
      skipped('bank_identity', 'Pending on the bank sheet = pending on the expense records', 'Bank',
        projectId, 'No bank records were imported.'),
    ];
  }

  const fromBank = round2(data.bank.reduce((sum, r) => sum + r.pendingExpense, 0));
  const fromExpense = round2(data.expense.reduce((sum, r) => sum + r.pendingAmount, 0));

  // A sheet that states no pending at all is not disagreeing with anything.
  if (fromBank === 0 || fromExpense === 0) {
    return [
      skipped('bank_identity', 'Pending on the bank sheet = pending on the expense records', 'Bank',
        projectId,
        fromBank === 0
          ? 'The bank sheets carry no pending column.'
          : 'The expense records carry no pending amounts.'),
    ];
  }

  return [
    compare('bank_identity', 'Pending on the bank sheet = pending on the expense records', 'Bank',
      projectId, fromBank, fromExpense,
      calc.byKey.get('pending_expense')?.sourceRefIndexes ?? []),
  ];
}

/**
 * The receivable ledger against the sales ledger, where both describe the same
 * contracts.
 *
 * This used to check that Received + Accrued equals Total Contractual, which
 * is how Accrued is defined — true by construction, and unable to fail.
 *
 * What can go wrong, and did, is that a receivable export and a sales export
 * covering the same contracts are both ordinary monthly files, both are
 * accepted, and their contractual amounts are added together. Revenue doubles
 * and nothing says so. Matching is on the customer or unit the two ledgers
 * name, because that is the only identity they share.
 */
function validateIncomeComponents(
  data: NormalizedDataset,
  projectId: string | null,
): ValidationResult[] {
  const label = 'The sales ledger does not restate the receivable ledger';

  if (data.receivable.length === 0 || data.income.length === 0) {
    return [
      skipped('income_components', label, 'Income', projectId,
        'Only one of the two ledgers was imported, so there is nothing to compare.'),
    ];
  }

  const key = (text: string | null) => (text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

  const inReceivable = new Map<string, number>();
  for (const row of data.receivable) {
    for (const name of [row.customer, row.unit]) {
      const k = key(name);
      if (k.length < 3) continue;
      inReceivable.set(k, round2((inReceivable.get(k) ?? 0) + row.contractualAmount));
    }
  }

  let overlap = 0;
  const refIndexes: number[] = [];
  for (const row of data.income) {
    const k = key(row.description);
    if (k.length < 3) continue;
    if (!inReceivable.has(k)) continue;
    overlap = round2(overlap + row.contractualAmount);
    if (row.sourceRefIndex !== undefined && row.sourceRefIndex >= 0) refIndexes.push(row.sourceRefIndex);
  }

  // Expected nothing in common; imported whatever was found twice.
  return [
    compare('income_components', label, 'Income', projectId, 0, overlap, refIndexes),
  ];
}

/** Paid + Pending across expense records must equal the expense total. */
function validateExpenseComponents(
  data: NormalizedDataset,
  calc: CalculationResult,
  projectId: string | null,
): ValidationResult[] {
  if (data.expense.length === 0) {
    return [
      skipped('expense_components', 'Paid + Pending = Total Expense', 'Expense', projectId,
        'No expense records were imported.'),
    ];
  }

  const total = calc.byKey.get('total_expense')?.value ?? 0;
  const components = round2(
    data.expense.reduce((sum, r) => sum + r.paidAmount + r.pendingAmount, 0),
  );

  // Many sheets state a total without splitting paid and pending. That is not
  // an error — it just means the check cannot run.
  const anySplit = data.expense.some((r) => r.paidAmount !== 0 || r.pendingAmount !== 0);
  if (!anySplit) {
    return [
      skipped('expense_components', 'Paid + Pending = Total Expense', 'Expense', projectId,
        'Expense records do not carry a paid/pending split.'),
    ];
  }

  return [
    compare('expense_components', 'Paid + Pending = Total Expense', 'Expense', projectId,
      total, components, calc.byKey.get('total_expense')?.sourceRefIndexes ?? []),
  ];
}

/**
 * The BOQ sheet's own pending column against the gap between certified and
 * paid.
 *
 * This used to check that Paid + Outstanding equals To Date, which is how
 * Outstanding is defined — a third rule that could not fail.
 *
 * A BOQ sheet states its own pending amount, so it can be compared with what
 * remains unpaid on the certified work. When they disagree, either work has
 * been certified and not raised for payment, or a payment has been raised
 * against work that was never certified.
 */
function validateBoq(
  data: NormalizedDataset,
  calc: CalculationResult,
  projectId: string | null,
): ValidationResult[] {
  const label = 'BOQ pending as stated = certified less paid';

  if (data.boq.length === 0) {
    return [
      skipped('boq_reconciliation', label, 'BOQ', projectId, 'No BOQ records were imported.'),
    ];
  }

  const toDate = calc.byKey.get('boq_to_date')?.value ?? 0;
  const paid = calc.byKey.get('boq_paid')?.value ?? 0;
  const statedPending = round2(data.boq.reduce((sum, r) => sum + r.pendingAmount, 0));

  const results: ValidationResult[] = statedPending === 0
    ? [skipped('boq_reconciliation', label, 'BOQ', projectId,
        'The BOQ sheets carry no pending column to compare with.')]
    : [
        compare('boq_reconciliation', label, 'BOQ', projectId,
          round2(toDate - paid), statedPending,
          calc.byKey.get('boq_outstanding')?.sourceRefIndexes ?? []),
      ];

  // Work billed to date can never exceed the contract value.
  const total = calc.byKey.get('boq_total')?.value ?? 0;
  if (total > 0 && toDate > total + ERROR_THRESHOLD) {
    results.push({
      ruleKey: 'boq_to_date_within_total',
      label: 'BOQ To Date ≤ Total BOQ',
      scope: 'BOQ',
      projectId,
      expected: total,
      imported: toDate,
      difference: round2(total - toDate),
      status: 'error',
      severity: 'error',
      message: 'Work-to-date exceeds the total BOQ value, which should not be possible.',
      sourceRefIndexes: calc.byKey.get('boq_to_date')?.sourceRefIndexes ?? [],
    });
  }

  return results;
}

/**
 * Where the source sheet stated its own closing balance, our recomputed
 * running balance must agree with it.
 */
function validateCashflowMonths(calc: CalculationResult, projectId: string | null): ValidationResult[] {
  const stated = calc.projection.months.filter((m) => m.statedClosing !== null);
  if (stated.length === 0) {
    return [
      skipped('cashflow_running_balance', 'Recomputed closing cash = stated closing cash',
        'Cash Flow', projectId, 'The source files did not state a closing balance.'),
    ];
  }

  const mismatched = stated.filter(
    (m) => Math.abs(round2(m.closingCash - (m.statedClosing ?? 0))) > TOLERANCE,
  );

  if (mismatched.length === 0) {
    return [
      {
        ruleKey: 'cashflow_running_balance',
        label: 'Recomputed closing cash = stated closing cash',
        scope: 'Cash Flow',
        projectId,
        expected: null,
        imported: null,
        difference: 0,
        status: 'pass',
        severity: 'info',
        message: `All ${stated.length} stated monthly balances match the recomputed running balance.`,
        sourceRefIndexes: [],
      },
    ];
  }

  const worst = mismatched.reduce((a, b) =>
    Math.abs(a.closingCash - (a.statedClosing ?? 0)) > Math.abs(b.closingCash - (b.statedClosing ?? 0)) ? a : b,
  );

  return [
    {
      ruleKey: 'cashflow_running_balance',
      label: 'Recomputed closing cash = stated closing cash',
      scope: 'Cash Flow',
      projectId,
      expected: worst.closingCash,
      imported: worst.statedClosing,
      difference: round2(worst.closingCash - (worst.statedClosing ?? 0)),
      status: 'warning',
      severity: 'warning',
      message:
        `${mismatched.length} month(s) disagree with the recomputed running balance; ` +
        `the largest gap is in ${worst.month}.`,
      sourceRefIndexes: worst.refIndexes,
    },
  ];
}

// ---------------------------------------------------------------- helpers

function compare(
  ruleKey: string,
  label: string,
  scope: string,
  projectId: string | null,
  expected: number | null,
  imported: number | null,
  sourceRefIndexes: number[],
): ValidationResult {
  const difference =
    expected !== null && imported !== null ? round2(expected - imported) : null;
  const magnitude = difference === null ? 0 : Math.abs(difference);

  const status: ValidationResult['status'] =
    difference === null ? 'skipped' : magnitude <= TOLERANCE ? 'pass' : magnitude > ERROR_THRESHOLD ? 'error' : 'warning';

  return {
    ruleKey,
    label,
    scope,
    projectId,
    expected,
    imported,
    difference,
    status,
    severity: status === 'error' ? 'error' : status === 'warning' ? 'warning' : 'info',
    message:
      status === 'pass'
        ? 'Reconciled.'
        : `Expected and imported values differ by ${magnitude.toLocaleString('en-US')}.`,
    sourceRefIndexes,
  };
}

function skipped(
  ruleKey: string,
  label: string,
  scope: string,
  projectId: string | null,
  message: string,
): ValidationResult {
  return {
    ruleKey,
    label,
    scope,
    projectId,
    expected: null,
    imported: null,
    difference: null,
    status: 'skipped',
    severity: 'info',
    message,
    sourceRefIndexes: [],
  };
}
