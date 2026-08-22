/**
 * The Customer Card report.
 *
 * Finance exports a "ลูกหนี้คงค้าง" (outstanding receivable) customer card from
 * the sales system: one row per instalment per unit, carrying the contract, the
 * due date, the amount due, and the receipt if it has been paid. This module
 * turns that into the Interest / Advance-received workbook the accountants
 * keep by hand today.
 *
 * The two are not the same shape. The customer card is a payment ledger; the
 * report is a matrix of months. Everything here exists to cross that gap
 * without losing a payment or counting one twice.
 */

/** One line of the customer card, as read from the sheet. */
export interface CustomerCardRow {
  /** 1-based row in the source sheet, so every figure can be traced back. */
  sourceRow: number;
  sequence: string | null;
  customerCode: string | null;
  customerName: string | null;
  coBuyerName: string | null;
  /**
   * The unit as the report names it: building and room together, "A103".
   *
   * Composed, because the card gives them in two columns and 163 room numbers
   * are shared across four buildings — the room number alone names four
   * different flats.
   */
  unit: string | null;
  /** แปลง/ห้อง exactly as the card has it, for the audit trail. */
  room: string | null;
  houseType: string | null;
  houseNo: string | null;
  contractNo: string | null;
  contractPrice: number | null;
  adjustment: number | null;
  /** ราคาขายสุทธิ — preferred over the contract price where both exist. */
  netPrice: number | null;
  /** ประเภทงวด — จอง / สัญญา / ดาวน์ งวด n / โอน … */
  installmentType: string | null;
  /** วันครบกำหนดชำระเงินตามสัญญา — drives the InsPlan matrix. */
  dueDate: string | null;
  dueAmount: number | null;
  /** วันที่ชำระ — drives the InsPaid matrix. Never the due date. */
  paidDate: string | null;
  receiptNo: string | null;
  paidAmount: number | null;
  /** จำนวนเงินคงเหลือ — reconciled against, never used as an amount paid. */
  outstanding: number | null;
  quota: string | null;
  area: string | null;
}

/** Every card line for one unit, gathered under its contract. */
export interface ContractGroup {
  key: string;
  unit: string;
  contractNo: string | null;
  customerName: string | null;
  /** ราคาขายสุทธิ, falling back to ราคาขายตามสัญญา. */
  salePrice: number;
  /** Which of the two the price came from — reported, not guessed at. */
  salePriceSource: 'net' | 'contract' | 'missing';
  /** Earliest transaction date on the card: the contract's start. */
  contractDate: string | null;
  /** month key (YYYY-MM) → amount due that month. */
  plan: Map<string, number>;
  /** month key (YYYY-MM) → cash actually received that month. */
  paid: Map<string, number>;
  /**
   * The transfer instalment, where the card carries no due date for it.
   *
   * A handover payment is due "on transfer", which has no scheduled month, so
   * it has its own column in the report rather than being dropped for want of
   * a date — dropping it would leave every unit's plan short by half.
   */
  onKey: number;
  /** The outstanding figure the source itself reports, for reconciliation. */
  outstandingFromSource: number | null;
  rows: CustomerCardRow[];
  issues: ReportIssue[];
}

export type IssueSeverity = 'info' | 'warning' | 'error';

export interface ReportIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  unit?: string | null;
  contractNo?: string | null;
  sourceRow?: number | null;
}

/** One row of the Data_Check sheet. */
export interface CheckRow {
  unit: string;
  contractNo: string | null;
  salePrice: number;
  planTotal: number;
  paidTotal: number;
  outstandingSource: number | null;
  outstandingCalculated: number;
  difference: number | null;
  status: 'OK' | 'CHECK' | 'ERROR';
  note: string;
}

export interface ReportOptions {
  /** Report title, e.g. "SUN9". Taken from the project, not from the file. */
  projectLabel: string;
  /** As-at date. Governs nothing in the arithmetic; it labels the report. */
  reportDate: string;
  /**
   * Expected building completion.
   *
   * The whole selling-price uplift and every effective interest rate hang off
   * this date, and the source file does not contain it. It is carried over
   * from the previous report and reported as unconfirmed rather than inferred.
   */
  completionDate: string;
  /** Selling-price uplift at the far end of the schedule. From the template. */
  maxUplift: number;
  /** Tolerance, in baht, within which a reconciliation difference reads OK. */
  tolerance: number;
}

export const DEFAULT_OPTIONS: Omit<ReportOptions, 'projectLabel' | 'reportDate'> = {
  // Both carried over from Interest-Advance received_SUN9. Neither is derivable
  // from the customer card, and inventing either would move every figure in the
  // interest sheets.
  completionDate: '2028-09-30',
  maxUplift: 0.2,
  tolerance: 1,
};

export interface ReportModel {
  options: ReportOptions;
  /** Month keys (YYYY-MM) spanning the whole report, in order. */
  months: string[];
  contracts: ContractGroup[];
  /** Per-contract effective interest rate, solved for, not read. */
  eir: Map<string, number>;
  /** month key → uplift fraction applied to a sale price starting that month. */
  uplift: Map<string, number>;
  /**
   * The month the uplift is anchored on: the first an instalment falls due.
   * Written into '%sellingprice' so the sheet's own arithmetic matches.
   */
  anchorMonth: string;
  checks: CheckRow[];
  issues: ReportIssue[];
  summary: ReportSummary;
}

export interface ReportSummary {
  sourceRows: number;
  contracts: number;
  units: number;
  totalSalePrice: number;
  totalExpectedSellingPrice: number;
  totalPlan: number;
  totalPaid: number;
  totalOutstanding: number;
  totalInterestExpense: number;
  ok: number;
  check: number;
  error: number;
  /** Assumptions Finance still has to confirm. Never silently accepted. */
  needsConfirmation: string[];
}
