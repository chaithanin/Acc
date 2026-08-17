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
  results.push(...validateIncomeComponents(calc, projectId));
  results.push(...validateExpenseComponents(data, calc, projectId));
  results.push(...validateBoq(data, calc, projectId));
  results.push(...validateCashflowMonths(calc, projectId));

  return results;
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

/** Bank − Pending must equal the Available Cash the engine reports. */
function validateBankIdentity(
  data: NormalizedDataset,
  calc: CalculationResult,
  projectId: string | null,
): ValidationResult[] {
  const bank = calc.byKey.get('bank_current_amount')?.value ?? null;
  const pending = calc.byKey.get('pending_expense')?.value ?? null;
  const available = calc.byKey.get('available_cash')?.value ?? null;

  if (data.bank.length === 0) {
    return [
      skipped('bank_identity', 'Bank − Pending = Available', 'Bank', projectId,
        'No bank records were imported.'),
    ];
  }

  const expected = round2((bank ?? 0) - (pending ?? 0));
  return [
    compare('bank_identity', 'Bank − Pending = Available', 'Bank', projectId, expected, available,
      calc.byKey.get('available_cash')?.sourceRefIndexes ?? []),
  ];
}

/** The income components must add up to the reported total. */
function validateIncomeComponents(calc: CalculationResult, projectId: string | null): ValidationResult[] {
  const contractual = calc.byKey.get('total_contractual_income')?.value ?? 0;
  const received = calc.byKey.get('received_income')?.value ?? 0;
  const accrued = calc.byKey.get('accrued_income')?.value ?? 0;

  if (contractual === 0 && received === 0) {
    return [
      skipped('income_components', 'Received + Accrued = Total Contractual', 'Income', projectId,
        'No income or receivable records were imported.'),
    ];
  }

  return [
    compare('income_components', 'Received + Accrued = Total Contractual', 'Income', projectId,
      contractual, round2(received + accrued),
      calc.byKey.get('total_contractual_income')?.sourceRefIndexes ?? []),
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

/** BOQ Paid + BOQ Outstanding must reconcile with BOQ To Date. */
function validateBoq(
  data: NormalizedDataset,
  calc: CalculationResult,
  projectId: string | null,
): ValidationResult[] {
  if (data.boq.length === 0) {
    return [
      skipped('boq_reconciliation', 'BOQ Paid + Outstanding = BOQ To Date', 'BOQ', projectId,
        'No BOQ records were imported.'),
    ];
  }

  const toDate = calc.byKey.get('boq_to_date')?.value ?? 0;
  const paid = calc.byKey.get('boq_paid')?.value ?? 0;
  const outstanding = calc.byKey.get('boq_outstanding')?.value ?? 0;

  const results: ValidationResult[] = [
    compare('boq_reconciliation', 'BOQ Paid + Outstanding = BOQ To Date', 'BOQ', projectId,
      toDate, round2(paid + outstanding),
      calc.byKey.get('boq_to_date')?.sourceRefIndexes ?? []),
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
