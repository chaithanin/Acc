/**
 * What each KPI means, and which records it is read from.
 *
 * The arithmetic lives in `src/lib/calc/kpi.ts` and is not repeated here — a
 * second copy of a formula is a second definition of the same number, and the
 * two drift. What is here is the part the engine cannot express: what the
 * figure is FOR, which records are its source of truth, and what it
 * deliberately leaves out.
 *
 * A test asserts this registry and the engine name exactly the same set of
 * metrics, so a KPI cannot be added to one and forgotten in the other.
 */

export interface KpiDefinition {
  /** One sentence an accountant can agree or disagree with. */
  meaning: string;
  /** The records the figure is computed from — where to look when it is wrong. */
  readsFrom: string;
  /** What it does not include, where leaving that unsaid has caused a dispute. */
  excludes?: string;
}

export const KPI_DEFINITIONS: Record<string, KpiDefinition> = {
  // ------------------------------------------------------------------ bank
  bank_current_amount: {
    meaning: 'Money actually in the bank on the report date, across every account.',
    readsFrom: 'Bank balance records — the current-amount column of each bank sheet.',
    excludes: 'Cheques written but not cleared, which are counted as Pending Expense instead.',
  },
  pending_expense: {
    meaning: 'Committed payments that have left the plan but not yet the bank.',
    readsFrom:
      'The pending column of the bank sheets, plus the pending amount on every expense record.',
  },
  available_cash: {
    meaning: 'What can be spent today without breaking an existing commitment.',
    readsFrom: 'Derived: bank balances less pending payments.',
    excludes: 'Income that is contracted but not received — that is Accrued Income.',
  },

  // ---------------------------------------------------------------- income
  total_contractual_income: {
    meaning: 'The full value of what has been sold, whether or not it has been collected.',
    readsFrom: 'Receivable records and income records — the contractual-amount column of each.',
    excludes: 'Forecast or pipeline sales that carry no contract.',
  },
  received_income: {
    meaning: 'How much of the contracted value has actually been collected.',
    readsFrom: 'The receive-amount column of receivable and income records.',
  },
  accrued_income: {
    meaning: 'Contracted but not yet collected — the collection gap.',
    readsFrom:
      'Derived: contractual less received. Deliberately recomputed rather than read from an accrued column, which the source workbooks often leave stale.',
  },
  period_income: {
    meaning: 'Income belonging to the report month alone — what the monthly budget is compared with.',
    readsFrom: 'Income records dated in the report month, forecast rows excluded.',
    excludes:
      'Receivable rows, which carry a due date rather than a posting month and so cannot be placed in a period; and everything contracted in earlier months, which is a balance rather than a month.',
  },
  period_collected: {
    meaning: 'Cash collected against income raised in the report month.',
    readsFrom: 'The received column of the same month’s income records.',
  },
  period_expense: {
    meaning: 'Spending belonging to the report month alone — what the monthly budget is compared with.',
    readsFrom: 'Expense records dated in the report month, forecast rows excluded.',
  },
  expected_future_income: {
    meaning: 'Collections expected after the report date.',
    readsFrom:
      'Income records dated after the report date, or forecast rows where the file carries them. With neither, it falls back to Accrued Income and the formula says so.',
  },

  // ------------------------------------------------------------------- BOQ
  boq_total: {
    meaning: 'The whole construction contract value, for the life of the project.',
    readsFrom: 'BOQ records — the total-BOQ column.',
  },
  boq_to_date: {
    meaning: 'Work certified as complete so far.',
    readsFrom: 'BOQ records — the amount-to-date column.',
  },
  boq_paid: {
    meaning: 'What has been paid to contractors against certified work.',
    readsFrom: 'BOQ records — the paid-amount column.',
  },
  boq_outstanding: {
    meaning: 'Work already certified but not yet paid for — a payable that is due.',
    readsFrom: 'Derived: certified to date less paid.',
    excludes: 'Contract value not yet built, which is Remaining BOQ.',
  },
  remaining_boq: {
    meaning: 'Contract value still to be spent over the rest of the project.',
    readsFrom: 'Derived: total contract less paid.',
  },
  wip_ytd: {
    meaning: 'Work in progress carried on the balance sheet, year to date.',
    readsFrom: 'WIP account records — the year-to-date column.',
  },

  // ---------------------------------------------------------------- expense
  total_expense: {
    meaning: 'Everything spent in the period, across every category.',
    readsFrom: 'Expense records — the amount column, summed over every category including tax.',
  },
  other_expense: {
    meaning: 'Spending that is not construction — overheads, fees, administration.',
    readsFrom: 'Derived: total expense less the construction and BOQ categories.',
  },
  cost_of_goods_sold: {
    meaning: 'The construction cost of the units revenue has been recognised on.',
    readsFrom:
      'BOQ certified to date, apportioned by the share of the project that is under contract. The construction cost of unsold units is inventory and is not charged here.',
    excludes: 'Overheads, marketing and administration, which are operating costs.',
  },
  operating_expenses: {
    meaning: 'Running the business, as distinct from building the product.',
    readsFrom: 'Derived: total expense less cost of goods sold less tax.',
    excludes: 'Tax, which is deducted once at the bottom of the statement and not twice.',
  },
  taxes: {
    meaning: 'Tax charged in the period.',
    readsFrom: 'Expense records in the tax category.',
  },
  total_future_expense: {
    meaning: 'Money already committed that has still to be paid out.',
    readsFrom:
      'Expense records dated after the report date, or forecast rows. With neither, remaining BOQ plus pending expense, and the formula says so.',
  },

  // ------------------------------------------------------------------ cash
  current_cash: {
    meaning: 'The opening balance the cash-flow projection starts from.',
    readsFrom: 'Derived: the same figure as Available Cash, named for its role in the forecast.',
  },
  forecast_cash: {
    meaning: 'Cash at the end of the projection horizon.',
    readsFrom: 'The month-by-month projection, which runs on forecast records where they exist.',
  },
  lowest_forecast_cash: {
    meaning: 'The worst month in the projection — where funding runs closest to the line.',
    readsFrom: 'The minimum closing balance across the projected months.',
  },
  cash_shortfall: {
    meaning: 'How far below zero cash is expected to go, or zero if it never does.',
    readsFrom: 'Derived from the lowest projected balance.',
  },
  required_funding: {
    meaning: 'The facility needed to keep every projected month above zero.',
    readsFrom: 'Derived: the size of the shortfall, expressed as a positive number.',
  },

  // ------------------------------------------------------------ receivable
  reservation_outstanding: {
    meaning: 'Reservation fees contracted but not collected.',
    readsFrom: 'Receivable records in the reservation category.',
  },
  contract_outstanding: {
    meaning: 'Contract instalments due but not collected.',
    readsFrom: 'Receivable records in the contract category.',
  },
  down_payment_outstanding: {
    meaning: 'Down payments due but not collected.',
    readsFrom: 'Receivable records in the down-payment category.',
  },
  transfer_outstanding: {
    meaning: 'Transfer fees due but not collected.',
    readsFrom: 'Receivable records in the transfer-fee category.',
  },
  receivable_aged_current: {
    meaning: 'Owed but not yet due on the report date.',
    readsFrom: 'Receivable rows whose due date is on or after the report date.',
  },
  receivable_aged_1_30: {
    meaning: 'Between one and thirty days late.',
    readsFrom: 'Receivable rows aged against the report date, not against today.',
  },
  receivable_aged_31_60: {
    meaning: 'Between thirty-one and sixty days late.',
    readsFrom: 'Receivable rows aged against the report date.',
  },
  receivable_aged_61_90: {
    meaning: 'Between sixty-one and ninety days late.',
    readsFrom: 'Receivable rows aged against the report date.',
  },
  receivable_aged_91_120: {
    meaning: 'Between ninety-one and a hundred and twenty days late.',
    readsFrom: 'Receivable rows aged against the report date.',
  },
  receivable_aged_120_plus: {
    meaning: 'More than a hundred and twenty days late — the balance least likely to be collected.',
    readsFrom: 'Receivable rows aged against the report date.',
  },
  receivable_overdue: {
    meaning: 'Everything past its due date and still unpaid.',
    readsFrom: 'The sum of every bucket except Current.',
    excludes: 'Rows the file gives no due date for, which are reported on their own.',
  },
  receivable_undated: {
    meaning: 'Owed, but with no due date in the file, so nobody can say whether it is late.',
    readsFrom: 'Receivable rows with no due date. Reported rather than hidden: an amount that cannot be aged is an amount nobody is chasing.',
  },
  receivable_oldest_days: {
    meaning: 'How old the oldest unpaid instalment is, in days.',
    readsFrom: 'The earliest unpaid due date, measured to the report date.',
  },
  total_receivable_outstanding: {
    meaning: 'Everything sold and not yet collected, across all categories.',
    readsFrom: 'Derived: contractual less received across every receivable record.',
  },

  // -------------------------------------------------------------- position
  total_outstanding_expense: {
    meaning: 'Everything owed and due: certified construction work plus pending payments.',
    readsFrom: 'Derived: BOQ outstanding plus pending expense.',
  },
  net_financial_position: {
    meaning: 'What the company would be worth in cash terms if everything due settled today.',
    readsFrom: 'Derived: available cash plus accrued income less total outstanding expense.',
    excludes: 'Contract value not yet built and not yet sold — neither an asset nor a liability here.',
  },
  advance_outstanding: {
    meaning: 'Advances and deposits paid out and not yet recovered.',
    readsFrom: 'WIP and ledger accounts flagged as advance or deposit.',
  },
  gl_entry_count: {
    meaning: 'How many ledger postings the import read — a completeness check, not a financial figure.',
    readsFrom: 'A count of general-ledger records in the snapshot.',
  },
  contracted_sale_value: {
    meaning: 'What buyers have committed to pay for their units — the order book.',
    readsFrom:
      'Instalment and down-payment receivables plus the sales ledger. Reservation and transfer fees are consideration for something other than the unit and are left out.',
    excludes: 'Units not yet under contract, and any part of the price not yet earned.',
  },
  completion_percent: {
    meaning: 'How much of the building is built, as the construction contract measures it.',
    readsFrom: 'BOQ certified to date over the total BOQ contract value.',
  },
  recognised_revenue: {
    meaning:
      'Revenue actually earned, on the basis stated in the accounting policy — not the value of what has been signed.',
    readsFrom:
      'Contracted sale value multiplied by completion. Reported as not calculable, never as zero, when completion cannot be measured.',
    excludes: 'The part of the order book still to be earned, which is reported on its own.',
  },
  revenue_backlog: {
    meaning: 'Signed but not yet earned — the revenue still to come from work still to do.',
    readsFrom: 'Derived: contracted sale value less recognised revenue.',
  },
  gross_profit: {
    meaning: 'Recognised revenue less the cost of the units that revenue was earned on.',
    readsFrom:
      'Derived: recognised revenue less cost of sales. Not calculable until the project’s total sale value is set, because until then the construction cost of sold units cannot be separated from inventory.',
  },
  operating_profit: {
    meaning: 'Profit from operations, before tax (EBIT).',
    readsFrom: 'Derived: gross profit less operating expenses.',
  },
  net_profit: {
    meaning: 'What is left after every cost, including tax.',
    readsFrom: 'Derived: operating profit less tax.',
  },
  net_profit_margin: {
    meaning: 'Net profit as a share of revenue earned — how much of each baht earned is kept.',
    readsFrom:
      'Derived from recognised revenue, not from the order book. Reported as not calculable when there is no recognised revenue, never as 0%.',
  },
  quick_ratio: {
    meaning: 'Whether cash and near-cash alone cover what is owed.',
    readsFrom: 'Derived: available cash plus receivables, over outstanding expense.',
  },
  current_ratio: {
    meaning:
      'Whether current assets — cash, receivables, advances and work in progress — cover what is owed.',
    readsFrom:
      'Derived: the quick ratio widened by advances and deposits and by work in progress. Reported as not calculable when there are no payables, never as zero.',
  },
};
