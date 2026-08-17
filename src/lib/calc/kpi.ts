import type { IncomeCategory } from '@/config/field-synonyms';
import { formatTHB } from '@/lib/format/number';
import type { Metric, MetricInput, MetricSection, NormalizedDataset } from '@/lib/types';
import { addSums, dedupe, round2, sumBy, type Sum } from './aggregate';
import {
  projectCashflow,
  projectionRefIndexes,
  totalForecastExpense,
  totalForecastIncome,
  type CashflowProjection,
} from './cashflow';

/**
 * The KPI engine (requirements 5–10).
 *
 * Two rules govern everything here:
 *
 *   1. Nothing is trusted from an Excel formula result. Every figure is
 *      recomputed from normalized records.
 *   2. Every metric carries its own formula text and the inputs that fed it,
 *      so the UI can render "View Calculation" without a second code path.
 */

export interface CalculationResult {
  metrics: Metric[];
  byKey: Map<string, Metric>;
  projection: CashflowProjection;
}

interface MetricSpec {
  key: string;
  label: string;
  section: MetricSection;
  value: number | null;
  unit?: Metric['unit'];
  formula: string;
  inputs: MetricInput[];
  refIndexes: number[];
}

function metric(spec: MetricSpec): Metric {
  return {
    key: spec.key,
    label: spec.label,
    section: spec.section,
    value: spec.value === null ? null : round2(spec.value),
    unit: spec.unit ?? 'THB',
    formula: spec.formula,
    inputs: spec.inputs,
    sourceRefIndexes: dedupe(spec.refIndexes),
  };
}

function input(label: string, sum: Sum): MetricInput {
  return { label, value: sum.value, sourceRefIndexes: sum.refIndexes };
}

function plain(label: string, value: number): MetricInput {
  return { label, value: round2(value) };
}

const RECEIVABLE_CATEGORIES: { category: IncomeCategory; label: string; key: string }[] = [
  { category: 'reservation', label: 'Reservation Outstanding', key: 'reservation_outstanding' },
  { category: 'contract', label: 'Contract Outstanding', key: 'contract_outstanding' },
  { category: 'down_payment', label: 'Down Payment Outstanding', key: 'down_payment_outstanding' },
  { category: 'transfer_fee', label: 'Transfer Outstanding', key: 'transfer_outstanding' },
];

/**
 * Computes every KPI for a dataset. Call once per project and once for the
 * group-wide roll-up.
 */
export function calculateMetrics(data: NormalizedDataset, reportDate: string): CalculationResult {
  const metrics: Metric[] = [];

  // ------------------------------------------------------------------ bank
  const bankCurrent = sumBy(data.bank, (r) => r.currentAmount);
  const pendingFromBank = sumBy(data.bank, (r) => r.pendingExpense);
  const pendingFromExpense = sumBy(data.expense, (r) => r.pendingAmount);
  const pendingExpense = addSums(pendingFromBank, pendingFromExpense);

  metrics.push(
    metric({
      key: 'bank_current_amount',
      label: 'Current Bank Balance',
      section: 'bank',
      value: bankCurrent.value,
      formula: 'SUM(Bank Current Amount) across all bank records',
      inputs: [input('Bank records', bankCurrent)],
      refIndexes: bankCurrent.refIndexes,
    }),
    metric({
      key: 'pending_expense',
      label: 'Pending Expense',
      section: 'bank',
      value: pendingExpense.value,
      formula: 'SUM(Pending Expense from bank sheets) + SUM(Pending amounts on expense records)',
      inputs: [
        input('Pending expense (bank sheets)', pendingFromBank),
        input('Pending expense (expense records)', pendingFromExpense),
      ],
      refIndexes: pendingExpense.refIndexes,
    }),
    metric({
      key: 'available_cash',
      label: 'Available Cash',
      section: 'bank',
      value: bankCurrent.value - pendingExpense.value,
      formula: 'Bank Current Amount − Pending Expense',
      inputs: [
        input('Bank Current Amount', bankCurrent),
        input('Pending Expense', pendingExpense),
      ],
      refIndexes: [...bankCurrent.refIndexes, ...pendingExpense.refIndexes],
    }),
  );

  const availableCash = bankCurrent.value - pendingExpense.value;

  // ---------------------------------------------------------------- income
  const receivableContractual = sumBy(data.receivable, (r) => r.contractualAmount);
  const receivableReceived = sumBy(data.receivable, (r) => r.receiveAmount);
  const incomeContractual = sumBy(data.income, (r) => r.contractualAmount);
  const incomeReceived = sumBy(data.income, (r) => r.receivedAmount);

  const totalContractual = addSums(receivableContractual, incomeContractual);
  const totalReceived = addSums(receivableReceived, incomeReceived);
  // Accrued is DERIVED, never read from the sheet (requirement 5).
  const accruedIncome = round2(totalContractual.value - totalReceived.value);

  metrics.push(
    metric({
      key: 'total_contractual_income',
      label: 'Total Contractual Income',
      section: 'income',
      value: totalContractual.value,
      formula: 'SUM(Contractual Amount) across receivable and income records',
      inputs: [
        input('Receivable contractual', receivableContractual),
        input('Income contractual', incomeContractual),
      ],
      refIndexes: totalContractual.refIndexes,
    }),
    metric({
      key: 'received_income',
      label: 'Received Income',
      section: 'income',
      value: totalReceived.value,
      formula: 'SUM(Receive Amount) across receivable and income records',
      inputs: [
        input('Receivable received', receivableReceived),
        input('Income received', incomeReceived),
      ],
      refIndexes: totalReceived.refIndexes,
    }),
    metric({
      key: 'accrued_income',
      label: 'Accrued Income',
      section: 'income',
      value: accruedIncome,
      formula: 'Total Contractual Income − Received Income',
      inputs: [
        input('Total Contractual Income', totalContractual),
        input('Received Income', totalReceived),
      ],
      refIndexes: [...totalContractual.refIndexes, ...totalReceived.refIndexes],
    }),
  );

  // -------------------------------------------------------------------- boq
  const boqTotal = sumBy(data.boq, (r) => r.boqAmount);
  const boqToDate = sumBy(data.boq, (r) => r.boqToDate);
  const boqPaid = sumBy(data.boq, (r) => r.paidAmount);
  const boqOutstanding = round2(boqToDate.value - boqPaid.value);
  const remainingBoq = round2(boqTotal.value - boqPaid.value);

  metrics.push(
    metric({
      key: 'boq_total',
      label: 'BOQ Total',
      section: 'boq',
      value: boqTotal.value,
      formula: 'SUM(Total BOQ Project)',
      inputs: [input('BOQ records', boqTotal)],
      refIndexes: boqTotal.refIndexes,
    }),
    metric({
      key: 'boq_to_date',
      label: 'BOQ To Date',
      section: 'boq',
      value: boqToDate.value,
      formula: 'SUM(BOQ Amount To Date)',
      inputs: [input('BOQ records', boqToDate)],
      refIndexes: boqToDate.refIndexes,
    }),
    metric({
      key: 'boq_paid',
      label: 'BOQ Paid',
      section: 'boq',
      value: boqPaid.value,
      formula: 'SUM(BOQ Paid Amount)',
      inputs: [input('BOQ records', boqPaid)],
      refIndexes: boqPaid.refIndexes,
    }),
    metric({
      key: 'boq_outstanding',
      label: 'BOQ Outstanding',
      section: 'boq',
      value: boqOutstanding,
      formula: 'BOQ Amount To Date − BOQ Paid Amount',
      inputs: [input('BOQ To Date', boqToDate), input('BOQ Paid', boqPaid)],
      refIndexes: [...boqToDate.refIndexes, ...boqPaid.refIndexes],
    }),
    metric({
      key: 'remaining_boq',
      label: 'Remaining BOQ',
      section: 'boq',
      value: remainingBoq,
      formula: 'Total BOQ Project − BOQ Paid Amount',
      inputs: [input('BOQ Total', boqTotal), input('BOQ Paid', boqPaid)],
      refIndexes: [...boqTotal.refIndexes, ...boqPaid.refIndexes],
    }),
  );

  // --------------------------------------------------------------- expense
  const expenseTotal = sumBy(data.expense, (r) => r.amount);
  const constructionExpense = sumBy(
    data.expense.filter((r) => r.category === 'construction'),
    (r) => r.amount,
  );
  const otherExpense = round2(expenseTotal.value - constructionExpense.value);

  metrics.push(
    metric({
      key: 'total_expense',
      label: 'Total Expense',
      section: 'expense',
      value: expenseTotal.value,
      formula: 'SUM(all expense categories)',
      inputs: [input('Expense records', expenseTotal)],
      refIndexes: expenseTotal.refIndexes,
    }),
    metric({
      key: 'other_expense',
      label: 'Other Expense',
      section: 'expense',
      value: otherExpense,
      formula: 'Total Expense − Construction / BOQ expense',
      inputs: [
        input('Total Expense', expenseTotal),
        input('Construction expense', constructionExpense),
      ],
      refIndexes: expenseTotal.refIndexes,
    }),
  );

  // -------------------------------------------------------------- cashflow
  const projection = projectCashflow(data, availableCash, reportDate);
  const forecastRefs = projectionRefIndexes(projection);
  const forecastIncome = totalForecastIncome(projection);
  const forecastExpense = totalForecastExpense(projection);
  const hasForecast = projection.months.length > 0;

  // Expected future income comes from the forecast when one exists; otherwise
  // the uncollected contractual balance is the best available estimate. The
  // two are never added together — that would double-count the same money.
  const expectedFutureIncome = hasForecast ? forecastIncome : accruedIncome;
  const expectedFutureIncomeFormula = hasForecast
    ? 'SUM(Expected Income) across all forecast months'
    : 'Accrued Income (no forecast months found in the source files)';

  const totalFutureExpense = hasForecast ? forecastExpense : round2(remainingBoq + pendingExpense.value);
  const totalFutureExpenseFormula = hasForecast
    ? 'SUM(Expected Expense) across all forecast months'
    : 'Remaining BOQ + Pending Expense (no forecast months found in the source files)';

  metrics.push(
    metric({
      key: 'expected_future_income',
      label: 'Expected Future Income',
      section: 'income',
      value: expectedFutureIncome,
      formula: expectedFutureIncomeFormula,
      inputs: hasForecast
        ? [plain('Forecast months', projection.months.length), plain('Forecast income', forecastIncome)]
        : [plain('Accrued Income', accruedIncome)],
      refIndexes: hasForecast ? forecastRefs : [...totalContractual.refIndexes],
    }),
    metric({
      key: 'total_future_expense',
      label: 'Total Future Expense',
      section: 'expense',
      value: totalFutureExpense,
      formula: totalFutureExpenseFormula,
      inputs: hasForecast
        ? [plain('Forecast expense', forecastExpense)]
        : [plain('Remaining BOQ', remainingBoq), input('Pending Expense', pendingExpense)],
      refIndexes: hasForecast ? forecastRefs : [...boqTotal.refIndexes, ...pendingExpense.refIndexes],
    }),
    metric({
      key: 'current_cash',
      label: 'Current Cash',
      section: 'cash',
      value: availableCash,
      formula: 'Bank Current Amount − Pending Expense',
      inputs: [input('Bank Current Amount', bankCurrent), input('Pending Expense', pendingExpense)],
      refIndexes: [...bankCurrent.refIndexes, ...pendingExpense.refIndexes],
    }),
    metric({
      key: 'forecast_cash',
      label: 'Forecast Cash',
      section: 'cash',
      value: projection.forecastCash,
      formula: hasForecast
        ? `Closing cash of the final forecast month (${projection.months[projection.months.length - 1].month})`
        : 'No forecast months found — equals Current Cash',
      inputs: [
        plain('Opening cash', projection.openingCash),
        plain('Forecast income', forecastIncome),
        plain('Forecast expense', forecastExpense),
      ],
      refIndexes: forecastRefs,
    }),
    metric({
      key: 'lowest_forecast_cash',
      label: 'Lowest Forecast Cash',
      section: 'cash',
      value: projection.lowestCash,
      formula: projection.lowestMonth
        ? `MIN(Closing Cash) across forecast months — reached in ${projection.lowestMonth}`
        : 'No forecast months found — equals Current Cash',
      inputs: [plain('Months projected', projection.months.length)],
      refIndexes: forecastRefs,
    }),
    metric({
      key: 'cash_shortfall',
      label: 'Cash Shortfall',
      section: 'cash',
      value: projection.hasShortfall ? projection.lowestCash : 0,
      formula: 'Lowest Forecast Cash when it falls below zero, otherwise 0',
      inputs: [plain('Lowest Forecast Cash', projection.lowestCash)],
      refIndexes: forecastRefs,
    }),
    metric({
      key: 'required_funding',
      label: 'Required Funding',
      section: 'cash',
      value: projection.requiredFunding,
      formula: 'ABS(Lowest Forecast Cash) when negative, otherwise 0',
      inputs: [plain('Lowest Forecast Cash', projection.lowestCash)],
      refIndexes: forecastRefs,
    }),
  );

  // ------------------------------------------------------------ receivable
  let outstandingTotal = 0;
  const outstandingRefs: number[] = [];

  for (const spec of RECEIVABLE_CATEGORIES) {
    const rows = data.receivable.filter((r) => r.category === spec.category);
    const contractual = sumBy(rows, (r) => r.contractualAmount);
    const received = sumBy(rows, (r) => r.receiveAmount);
    const outstanding = round2(contractual.value - received.value);

    outstandingTotal += outstanding;
    outstandingRefs.push(...contractual.refIndexes);

    metrics.push(
      metric({
        key: spec.key,
        label: spec.label,
        section: 'receivable',
        value: outstanding,
        formula: `SUM(Contractual Amount) − SUM(Receive Amount) for ${spec.label.replace(' Outstanding', '')}`,
        inputs: [input('Contractual', contractual), input('Received', received)],
        refIndexes: [...contractual.refIndexes, ...received.refIndexes],
      }),
    );
  }

  const totalReceivableOutstanding = round2(receivableContractual.value - receivableReceived.value);

  metrics.push(
    metric({
      key: 'total_receivable_outstanding',
      label: 'Total Receivable Outstanding',
      section: 'receivable',
      value: totalReceivableOutstanding,
      formula: 'SUM(Contractual Amount) − SUM(Receive Amount) across all receivable records',
      inputs: [
        input('Contractual', receivableContractual),
        input('Received', receivableReceived),
      ],
      refIndexes: [...receivableContractual.refIndexes, ...receivableReceived.refIndexes],
    }),
  );

  // -------------------------------------------------------------- position
  const outstandingExpense = round2(boqOutstanding + pendingExpense.value);
  const netPosition = round2(availableCash + accruedIncome - outstandingExpense);
  const wipYtd = sumBy(data.wip, (r) => r.ytd);
  const advanceOutstanding = sumBy(data.wip, (r) => r.advancePayment);

  metrics.push(
    metric({
      key: 'total_outstanding_expense',
      label: 'Total Outstanding Expense',
      section: 'position',
      value: outstandingExpense,
      formula: 'BOQ Outstanding + Pending Expense',
      inputs: [plain('BOQ Outstanding', boqOutstanding), input('Pending Expense', pendingExpense)],
      refIndexes: [...boqToDate.refIndexes, ...boqPaid.refIndexes, ...pendingExpense.refIndexes],
    }),
    metric({
      key: 'net_financial_position',
      label: 'Net Financial Position',
      section: 'position',
      value: netPosition,
      formula: 'Available Cash + Accrued Income − Total Outstanding Expense',
      inputs: [
        plain('Available Cash', availableCash),
        plain('Accrued Income', accruedIncome),
        plain('Total Outstanding Expense', outstandingExpense),
      ],
      refIndexes: [
        ...bankCurrent.refIndexes,
        ...totalContractual.refIndexes,
        ...boqToDate.refIndexes,
      ],
    }),
    metric({
      key: 'wip_ytd',
      label: 'Work In Progress (YTD)',
      section: 'boq',
      value: wipYtd.value,
      formula: 'SUM(YTD) across WIP account records',
      inputs: [input('WIP records', wipYtd)],
      refIndexes: wipYtd.refIndexes,
    }),
    metric({
      key: 'advance_outstanding',
      label: 'Advances & Deposits Outstanding',
      section: 'position',
      value: advanceOutstanding.value,
      // Money already paid out that has not yet been cleared against a
      // delivery. It is an asset, so it is reported on its own rather than
      // folded into Net Financial Position, where it would double-count
      // against the BOQ commitment it will eventually settle.
      formula: 'SUM(closing balance) across advance and deposit ledger accounts',
      inputs: [input('Ledger accounts', advanceOutstanding)],
      refIndexes: advanceOutstanding.refIndexes,
    }),
    metric({
      key: 'gl_entry_count',
      label: 'Ledger Entries Imported',
      section: 'position',
      value: data.gl.length,
      unit: 'COUNT',
      formula: 'COUNT(general ledger transactions imported)',
      inputs: [plain('Entries', data.gl.length)],
      refIndexes: [],
    }),
  );

  const byKey = new Map(metrics.map((m) => [m.key, m]));
  return { metrics, byKey, projection };
}

/** Renders a metric's inputs as the literal arithmetic behind it. */
export function renderCalculation(m: Metric): string {
  if (m.inputs.length === 0) return formatTHB(m.value ?? 0);
  const parts = m.inputs.map((i) => `${i.label}: ${formatTHB(i.value)}`);
  return `${parts.join('\n')}\n= ${formatTHB(m.value ?? 0)}`;
}
