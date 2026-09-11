/**
 * The shape Mango RE actually returns.
 *
 * Taken from the September 2026 survey of
 * `chaithanin.mangoanywhere.com/production.re`, which found that every screen
 * already reads its data from a JSON endpoint. These are those endpoints'
 * fields, named as Mango names them.
 *
 * Everything is optional and typed loosely on purpose. These are somebody
 * else's internal endpoints with no published contract: a field that is a
 * number today can be a numeric string tomorrow, and a column can disappear in
 * an upgrade. The parser below coerces rather than trusts, and the schema check
 * reports what moved instead of throwing halfway through an import.
 */

/** Mango wraps every response the same way. */
export interface MangoEnvelope<T> {
  success: boolean;
  error: string | null;
  data: T;
}

export type MangoValue = string | number | boolean | null | undefined;

/** One booking / contract / transfer, per unit. */
export interface MangoTransaction {
  docno?: MangoValue;
  /** Project code. The filter key for every other endpoint. */
  pre_event2?: MangoValue;
  /** Unit code. */
  pre_event?: MangoValue;
  customer_code?: MangoValue;
  customer_name?: MangoValue;
  salecode?: MangoValue;
  salename?: MangoValue;
  amount?: MangoValue;
  disamount?: MangoValue;
  netamount?: MangoValue;
  book_status?: MangoValue;
  book_amount?: MangoValue;
  book_date?: MangoValue;
  book_number?: MangoValue;
  contract_status?: MangoValue;
  contract_start_date?: MangoValue;
  contract_number?: MangoValue;
  down_status?: MangoValue;
  transfer_status?: MangoValue;
  transfer_date?: MangoValue;
  transfer_due_date?: MangoValue;
  cancel_status?: MangoValue;
  cancel_date?: MangoValue;
  [key: string]: MangoValue;
}

/** One receipt against a transaction. */
export interface MangoTransactionDetail {
  docno?: MangoValue;
  rcptno?: MangoValue;
  rcptdate?: MangoValue;
  amount?: MangoValue;
  doctype?: MangoValue;
  period_number?: MangoValue;
  [key: string]: MangoValue;
}

/** Asking price per unit. */
export interface MangoPriceListRow {
  pre_event?: MangoValue;
  pre_event2?: MangoValue;
  asking_price?: MangoValue;
  revise?: MangoValue;
  active?: MangoValue;
  [key: string]: MangoValue;
}

/** Monthly sales and transfer targets, and the marketing budget. */
export interface MangoSaleTarget {
  year?: MangoValue;
  month?: MangoValue;
  pre_event2?: MangoValue;
  target_sale_qty?: MangoValue;
  target_sale_amount?: MangoValue;
  target_transfer_qty?: MangoValue;
  target_transfer_amount?: MangoValue;
  budget?: MangoValue;
  expenses?: MangoValue;
  target_lead_qty?: MangoValue;
  [key: string]: MangoValue;
}

export interface MangoLoanStatus {
  docno?: MangoValue;
  bank_id?: MangoValue;
  select_bank?: MangoValue;
  sign_contact?: MangoValue;
  status?: MangoValue;
  [key: string]: MangoValue;
}

export interface MangoProject {
  maincode?: MangoValue;
  pre_event2?: MangoValue;
  name?: MangoValue;
  name_en?: MangoValue;
  proj_type?: MangoValue;
  total_units?: MangoValue;
  sold_units?: MangoValue;
  active?: MangoValue;
  [key: string]: MangoValue;
}

/** What `re/reportx/All_Transaction_Data` returns in one call. */
export interface MangoBundle {
  transaction?: MangoTransaction[];
  transaction_detail?: MangoTransactionDetail[];
  status_loan?: MangoLoanStatus[];
  pricelist?: MangoPriceListRow[];
  sale_target?: MangoSaleTarget[];
  project_rights?: unknown;
  [key: string]: unknown;
}

/** Every list the mapper reads, and how many rows it expected to find. */
export const BUNDLE_TABLES = [
  'transaction',
  'transaction_detail',
  'status_loan',
  'pricelist',
  'sale_target',
] as const;

export type BundleTable = (typeof BUNDLE_TABLES)[number];
