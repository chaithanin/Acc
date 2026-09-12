import type { MangoBundle } from '@/lib/sources/mango/types';

/**
 * A Mango RE payload, built to the columns the September 2026 survey recorded.
 *
 * Not a copy of live data — the account holding it is not reachable from a
 * build machine, and a snapshot of real customers has no business in a
 * repository. Every column is one the survey listed, every quirk is one the
 * survey or the surrounding systems actually produce: money as a comma string,
 * dates in three formats, a Buddhist year, a cancelled booking still sitting in
 * the list, and a receipt filed against a contract that is not in the pull.
 *
 * Eight contracts, chosen so every total below can be worked out by hand.
 */
export function mangoFixture(): MangoBundle {
  return {
    transaction: [
      // Transferred and paid in full. Buddhist year on the due date.
      {
        docno: 'BK-0001', pre_event2: 'HAMONIA', pre_event: 'A-101',
        customer_code: 'C001', customer_name: 'สมชาย ใจดี',
        salecode: 'S01', salename: 'Ploy',
        amount: 3_200_000, disamount: 200_000, netamount: 3_000_000,
        book_status: 'Y', book_amount: 50_000, book_date: '2025-11-04', book_number: 'B0001',
        contract_status: 'Y', contract_start_date: '2025-12-01', contract_number: 'CT0001',
        down_status: 'Y',
        transfer_status: 'Y', transfer_date: '2026-06-30', transfer_due_date: '30/06/2569',
        cancel_status: 'N', cancel_date: null,
      },
      // Under contract, part paid. Money arrives as a comma string.
      {
        docno: 'BK-0002', pre_event2: 'HAMONIA', pre_event: 'A-102',
        customer_code: 'C002', customer_name: 'Somsri P.',
        salecode: 'S01', salename: 'Ploy',
        amount: '2,600,000', disamount: '100,000', netamount: '2,500,000',
        book_status: 'Y', book_amount: 50_000, book_date: '01/02/2026', book_number: 'B0002',
        contract_status: 'Y', contract_start_date: '15/02/2026', contract_number: 'CT0002',
        down_status: 'Y',
        transfer_status: 'N', transfer_date: null, transfer_due_date: '2026-07-31',
        cancel_status: 'N',
      },
      // Booked only, nothing collected beyond the fee.
      {
        docno: 'BK-0003', pre_event2: 'HAMONIA', pre_event: 'A-103',
        customer_name: 'Anan K.', netamount: 1_800_000,
        book_status: 'Y', book_amount: 50_000, book_date: '2026-08-10',
        contract_status: 'N', down_status: 'N', transfer_status: 'N',
        transfer_due_date: '2027-03-31',
        cancel_status: 'N',
      },
      // Cancelled. Still in the list, and must not be a receivable.
      {
        docno: 'BK-0004', pre_event2: 'HAMONIA', pre_event: 'A-104',
        customer_name: 'Cancelled Buyer', netamount: 4_000_000,
        book_status: 'Y', contract_status: 'Y', transfer_status: 'N',
        transfer_due_date: '2026-05-31',
        cancel_status: 'Y', cancel_date: '2026-04-02',
      },
      /**
       * Superseded. V-201 was booked, the booking was replaced, and Mango
       * keeps the old row in the same list marked inactive rather than
       * removing it. Summing without checking reports this unit twice — and
       * at a value nobody ever owed.
       */
      {
        docno: 'BK-0005-OLD', pre_event2: 'MARINA_VTR', pre_event: 'V-201',
        customer_name: 'Wichai T.', netamount: 4_800_000,
        book_status: 'Y', contract_status: 'Y', transfer_status: 'N',
        cancel_status: 'N', active: 'N',
      },
      // A second project, so project filtering can be checked.
      {
        docno: 'BK-0005', pre_event2: 'MARINA_VTR', pre_event: 'V-201',
        customer_name: 'Wichai T.', netamount: 5_000_000,
        book_status: 'Y', contract_status: 'Y', down_status: 'Y', transfer_status: 'N',
        transfer_due_date: '2026-09-30',
        cancel_status: 'N',
      },
      // Overpaid: receipts exceed the contract value. Worth a warning.
      {
        docno: 'BK-0006', pre_event2: 'MARINA_VTR', pre_event: 'V-202',
        customer_name: 'Overpaid Buyer', netamount: 1_000_000,
        book_status: 'Y', contract_status: 'Y', transfer_status: 'N',
        transfer_due_date: '2026-10-31',
        cancel_status: 'N',
      },
      // No money on it at all — a placeholder row, not a contract.
      {
        docno: 'BK-0007', pre_event2: 'MARINA_VTR', pre_event: 'V-203',
        customer_name: 'Empty Row', netamount: 0, amount: 0,
        book_status: 'N', contract_status: 'N', transfer_status: 'N',
        cancel_status: 'N',
      },
      // Cancelled with a lowercase flag, to prove the check is not literal.
      {
        docno: 'BK-0008', pre_event2: 'MARINA_VTR', pre_event: 'V-204',
        customer_name: 'Also Cancelled', netamount: 2_000_000,
        book_status: 'Y', contract_status: 'Y', transfer_status: 'N',
        cancel_status: 'true',
      },
    ],

    transaction_detail: [
      // BK-0001 paid in full across three receipts.
      { docno: 'BK-0001', rcptno: 'RC-1001', rcptdate: '2025-11-04', amount: 50_000, doctype: 'เงินจอง', period_number: 0 },
      { docno: 'BK-0001', rcptno: 'RC-1002', rcptdate: '2025-12-01', amount: 450_000, doctype: 'เงินดาวน์', period_number: 1 },
      { docno: 'BK-0001', rcptno: 'RC-1003', rcptdate: '2026-06-30', amount: 2_500_000, doctype: 'โอนกรรมสิทธิ์', period_number: 2 },

      // BK-0002 part paid.
      { docno: 'BK-0002', rcptno: 'RC-2001', rcptdate: '01/02/2026', amount: 50_000, doctype: 'เงินจอง' },
      { docno: 'BK-0002', rcptno: 'RC-2002', rcptdate: '15/03/2026', amount: '450,000', doctype: 'เงินดาวน์' },
      { docno: 'BK-0002', rcptno: 'RC-2003', rcptdate: '2026-08-15', amount: 100_000, doctype: 'งวดที่ 3' },

      // BK-0003 booking fee only.
      { docno: 'BK-0003', rcptno: 'RC-3001', rcptdate: '2026-08-10', amount: 50_000, doctype: 'เงินจอง' },

      // BK-0005.
      { docno: 'BK-0005', rcptno: 'RC-5001', rcptdate: '2026-08-20', amount: 1_000_000, doctype: 'เงินดาวน์' },

      // BK-0006 overpaid: 1,200,000 against a 1,000,000 contract.
      { docno: 'BK-0006', rcptno: 'RC-6001', rcptdate: '2026-07-01', amount: 700_000, doctype: 'งวดที่ 1' },
      { docno: 'BK-0006', rcptno: 'RC-6002', rcptdate: '2026-08-01', amount: 500_000, doctype: 'งวดที่ 2' },

      // Filed against the cancelled booking — no longer a collection.
      { docno: 'BK-0004', rcptno: 'RC-4001', rcptdate: '2026-03-01', amount: 200_000, doctype: 'เงินจอง' },

      /**
       * Filed against a contract that is nowhere in this pull — not cancelled,
       * not replaced, absent. Somebody paid against a contract this account
       * cannot see, which is the one kind of orphan that means the pull is
       * short rather than merely tidy.
       */
      { docno: 'BK-9999', rcptno: 'RC-9001', rcptdate: '2026-08-05', amount: 75_000, doctype: 'เงินจอง' },

      // A receipt with no usable date — cannot be placed in a month.
      { docno: 'BK-0002', rcptno: 'RC-2004', rcptdate: '', amount: 25_000, doctype: 'งวดที่ 4' },
    ],

    /**
     * `revise` is the revision number, not a revised price.
     *
     * It reads like one beside a column called asking_price, and was taken for
     * one — which priced a real project's 1,839 units at 24,035 baht in total,
     * because the values here are 1, 2, 3. The small integers are the point of
     * this fixture.
     */
    pricelist: [
      { pre_event2: 'HAMONIA', pre_event: 'A-101', asking_price: 3_200_000, revise: 2, active: 'Y' },
      { pre_event2: 'HAMONIA', pre_event: 'A-102', asking_price: 2_600_000, revise: null, active: 'Y' },
      { pre_event2: 'HAMONIA', pre_event: 'A-103', asking_price: '1,800,000', revise: 0, active: 'Y' },
      // Sold and withdrawn from sale: not part of what the project can earn.
      { pre_event2: 'HAMONIA', pre_event: 'A-104', asking_price: 4_000_000, revise: 1, active: 'N' },
      { pre_event2: 'MARINA_VTR', pre_event: 'V-201', asking_price: 5_000_000, revise: null, active: 'Y' },
      { pre_event2: 'MARINA_VTR', pre_event: 'V-202', asking_price: 1_000_000, revise: 3, active: '1' },
    ],

    sale_target: [
      { pre_event2: 'HAMONIA', year: 2026, month: 8, target_sale_qty: 4, target_sale_amount: 12_000_000, target_transfer_qty: 2, target_transfer_amount: 6_000_000, budget: 800_000, expenses: 750_000, target_lead_qty: 120 },
      // A Buddhist year, as the Thai screens sometimes send.
      { pre_event2: 'HAMONIA', year: 2569, month: 9, target_sale_amount: 10_000_000, budget: 700_000 },
      { pre_event2: 'MARINA_VTR', year: 2026, month: 8, target_sale_amount: 20_000_000, budget: 1_200_000 },
      // Unusable: no month.
      { pre_event2: 'MARINA_VTR', year: 2026, month: null, target_sale_amount: 5_000_000 },
    ],

    status_loan: [
      { docno: 'BK-0002', bank_id: 'SCB', select_bank: 'Y', sign_contact: 'Y', status: 'APPROVED' },
      { docno: 'BK-0005', bank_id: 'KBANK', select_bank: 'Y', sign_contact: 'N', status: 'PENDING' },
    ],

    project_rights: [{ pre_event2: 'HAMONIA' }, { pre_event2: 'MARINA_VTR' }],
  };
}
