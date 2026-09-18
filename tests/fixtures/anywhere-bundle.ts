import type { AnywhereBundle } from '@/lib/sources/anywhere/types';

/**
 * Built from a live answer, column for column.
 *
 * The shapes here are not invented: `grade_inv` per row for the receivable
 * ageing and `Grade_A..D` across one row for the payable ageing is what the two
 * screens actually return, and the bank endpoint really does carry twenty-five
 * columns of which one is the balance.
 */
export const anywhereFixture = (): AnywhereBundle => ({
  arBalances: [
    { maincode: 'MG2', customer_code: 'C-001', customer_name: 'ABC Trading Co., Ltd.', total_inv: 2, total_amt: 450_000, balance_amt: 1_250_000, grade_customer: 'A' },
    { maincode: 'MG2', customer_code: 'C-002', customer_name: 'XYZ Limited', total_inv: 3, total_amt: 900_000, balance_amt: 0, grade_customer: 'A' },
    // Money arrives as a formatted string as often as a number.
    { maincode: 'MG2', customer_code: 'C-003', customer_name: 'Somchai Ltd', total_inv: 1, total_amt: '240,000.50', balance_amt: '750,000', grade_customer: 'B' },
    /**
     * Owes more than total_amt shows — sixteen of twenty-seven customers did in
     * the live answer, which is what settled that total_amt is this period's
     * billing rather than everything ever invoiced.
     */
    { maincode: 'MG2', customer_code: 'C-004', customer_name: 'Owes More Co', total_inv: 1, total_amt: 100_000, balance_amt: 250_000, grade_customer: 'C' },
    // Nothing on it at all.
    { maincode: 'MG2', customer_code: 'C-005', customer_name: 'Dormant Co', total_inv: 0, total_amt: 0, balance_amt: 0, grade_customer: '' },
  ],

  apBalances: [
    { mainname: 'MG2', acct_no: '2101-01', cust_name: 'Supplier A Co., Ltd.', total_inv: 9, total_amt: 3_200_000, balance_amt: 890_000, grade_vender: 'A' },
    { mainname: 'MG2', acct_no: '2101-02', cust_name: 'Contractor B', total_inv: 4, total_amt: 1_100_000, balance_amt: 0, grade_vender: 'B' },
  ],

  arByMonth: [
    { maincode: 'MG2', rl_year: 2026, rl_month: 8, receipt_net_amount: 1_800_000 },
    { maincode: 'MG2', rl_year: 2026, rl_month: 9, receipt_net_amount: 950_000 },
    // A second row for the same month, which has to add rather than replace.
    { maincode: 'MG2', rl_year: 2026, rl_month: 9, receipt_net_amount: 50_000 },
    // Unusable period.
    { maincode: 'MG2', rl_year: 2026, rl_month: 0, receipt_net_amount: 99_999 },
  ],

  apByMonth: [
    { maincode: 'MG2', pay_year: 2026, pay_month: 8, pay_amount: 1_200_000 },
    { maincode: 'MG2', pay_year: 2026, pay_month: 9, pay_amount: 400_000 },
  ],

  // One row per band.
  // Agrees with the sum of balance_amt to the baht, as the live answer does —
  // which is what confirmed that balance_amt is the real outstanding.
  arAgeing: [
    { grade_inv: 'A', balamt: 1_250_000 },
    { grade_inv: 'B', balamt: 750_000 },
    { grade_inv: 'C', balamt: 250_000 },
  ],

  // One row, one column per band — the other way round.
  apAgeing: [
    { Grade_A: 890_000, Grade_B: 0, Grade_C: 0, Grade_D: 0 },
  ],

  arYear: [{ rl_year: 2026, receipt_amount2: 12_500_000 }],
  apYear: [{ pay_year: 2026, pay_amount2: 8_100_000 }],

  bankAccounts: [
    {
      account_name: 'บัญชีกระแสรายวัน', account_type: 'CA', ac_code: '1112-01',
      bank_id: 'SCB', name: 'ไทยพาณิชย์', name_eng: 'Siam Commercial Bank',
      branch_id: '0123', branch_name: 'Pattaya', account_code: '123-4-56789-0',
      expenses: 150_000, income: 0, suspense: 0,
      balamt: 45_200_000, begamt: 40_000_000, begdate: '2026-01-01',
    },
    {
      account_name: 'บัญชีออมทรัพย์', account_type: 'SA', ac_code: '1112-02',
      bank_id: 'KBANK', name: 'กสิกรไทย', name_eng: 'Kasikornbank',
      branch_id: '0456', branch_name: 'Jomtien', account_code: '987-6-54321-0',
      expenses: 0, income: 0, suspense: 0,
      balamt: '8,750,000', begamt: 8_000_000, begdate: '2026-01-01',
    },
    /**
     * A balance the other way round, which is what made the live total minus
     * 112 million. One endpoint returns these alongside the cash accounts, and
     * `account_type` is the only thing distinguishing them.
     */
    {
      account_name: 'เงินกู้ระยะยาว', account_type: 'LN', ac_code: '2312-01',
      bank_id: 'SCB', name: 'ไทยพาณิชย์', name_eng: 'Siam Commercial Bank',
      account_code: 'LOAN-0001', expenses: 0, income: 0, suspense: 0,
      balamt: -180_000_000, begamt: -200_000_000, begdate: '2026-01-01',
    },
  ],

  // Same endpoint, one parameter different. Not cash.
  bankGuarantees: [
    {
      account_name: 'หนังสือค้ำประกัน', ac_code: '1129-01', bank_id: 'SCB',
      name: 'ไทยพาณิชย์', name_eng: 'Siam Commercial Bank',
      account_code: 'LG-2026-001', balamt: 15_000_000, expenses: 0,
    },
  ],
});
