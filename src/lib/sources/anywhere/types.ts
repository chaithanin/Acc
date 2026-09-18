/**
 * What Mango Anywhere's finance dashboard answers with.
 *
 * Every field here was read off a live answer rather than guessed at. That
 * matters more than it sounds: on the estate side a column called `revise`
 * sitting beside `asking_price` was taken for a revised price and turned out to
 * be the revision number, which priced 1,839 units at thirteen baht each.
 * Nothing in this file is named from its sound alone.
 */

/** A balance owed to the company, one row per customer. */
export interface AnywhereArBalance {
  maincode?: string | null;
  customer_code?: string | null;
  customer_name?: string | null;
  /**
   * Unverified. It reads as "total invoices" and could be a count or a value;
   * nothing here uses it, and the mapper reports which it looks like.
   */
  total_inv?: number | string | null;
  /** Invoiced in total. */
  total_amt?: number | string | null;
  /** Still outstanding. */
  balance_amt?: number | string | null;
  /** Mango's own ageing band for the customer. */
  grade_customer?: string | null;
  [key: string]: unknown;
}

/** A balance the company owes, one row per vendor. */
export interface AnywhereApBalance {
  mainname?: string | null;
  acct_no?: string | null;
  /** The vendor. Named cust_name in the answer, which is Mango's wording. */
  cust_name?: string | null;
  total_inv?: number | string | null;
  total_amt?: number | string | null;
  balance_amt?: number | string | null;
  grade_vender?: string | null;
  [key: string]: unknown;
}

/** Receipts banked in a month. Collections, not revenue. */
export interface AnywhereArMonth {
  maincode?: string | null;
  rl_year?: number | string | null;
  rl_month?: number | string | null;
  receipt_net_amount?: number | string | null;
  [key: string]: unknown;
}

/** Payments made in a month. */
export interface AnywhereApMonth {
  maincode?: string | null;
  pay_year?: number | string | null;
  pay_month?: number | string | null;
  pay_amount?: number | string | null;
  [key: string]: unknown;
}

/** Receivable ageing: one row per band. */
export interface AnywhereArAgeing {
  grade_inv?: string | null;
  balamt?: number | string | null;
  [key: string]: unknown;
}

/**
 * Payable ageing: one row, one column per band.
 *
 * Deliberately not the same shape as the receivable ageing, which is one row
 * per band. Two screens of the same system disagreeing about how to return a
 * breakdown is exactly the kind of thing that gets normalised by accident.
 */
export interface AnywhereApAgeing {
  Grade_A?: number | string | null;
  Grade_B?: number | string | null;
  Grade_C?: number | string | null;
  Grade_D?: number | string | null;
  [key: string]: unknown;
}

/** A bank account, with rather more about it than is needed. */
export interface AnywhereBankAccount {
  account_name?: string | null;
  account_type?: string | null;
  ac_code?: string | null;
  bank_id?: string | null;
  /** The bank, in Thai. `name_eng` is the same in English. */
  name?: string | null;
  name_eng?: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
  account_code?: string | null;
  assignment?: unknown;
  expenses?: number | string | null;
  income?: number | string | null;
  suspense?: number | string | null;
  /** The balance. */
  balamt?: number | string | null;
  /** Opening balance and its date. */
  begamt?: number | string | null;
  begdate?: string | null;
  [key: string]: unknown;
}

/** The answers, keyed by the endpoint that returned them. */
export interface AnywhereBundle {
  arBalances?: AnywhereArBalance[];
  apBalances?: AnywhereApBalance[];
  arByMonth?: AnywhereArMonth[];
  apByMonth?: AnywhereApMonth[];
  arAgeing?: AnywhereArAgeing[];
  apAgeing?: AnywhereApAgeing[];
  arYear?: { rl_year?: number | string | null; receipt_amount2?: number | string | null }[];
  apYear?: { pay_year?: number | string | null; pay_amount2?: number | string | null }[];
  bankAccounts?: AnywhereBankAccount[];
  bankGuarantees?: AnywhereBankAccount[];
}

/** The endpoint each part of the bundle comes from. */
export const BUNDLE_SOURCES: Record<keyof AnywhereBundle, string> = {
  arBalances: 'anywhereAPI/Dashboard/balanceArReadList',
  apBalances: 'anywhereAPI/Dashboard/balanceApReadList',
  arByMonth: 'anywhereAPI/Dashboard/viewArRead',
  apByMonth: 'anywhereAPI/Dashboard/viewApRead',
  arAgeing: 'anywhereAPI/Dashboard/BarchartArRead',
  apAgeing: 'anywhereAPI/Dashboard/BarchartAPRead',
  arYear: 'anywhereAPI/Dashboard/yearDetailARRead',
  apYear: 'anywhereAPI/Dashboard/yearDetailAPRead',
  bankAccounts: 'anywhereAPI/Dashboard/view_bank_all_v2?bank_guarantee=N',
  bankGuarantees: 'anywhereAPI/Dashboard/view_bank_all_v2?bank_guarantee=Y',
};
