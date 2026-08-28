/**
 * Canonical field vocabulary.
 *
 * Level 2 of the three-level mapping strategy (requirement 25): header/label
 * detection. Each canonical field lists the header texts that identify it, in
 * English and Thai. Adding a new spelling is a data edit here (or a runtime
 * override in `template_mappings`) — never a code change.
 *
 * `weight` biases ambiguous headers; `exact` requires a full-string match,
 * which is how short tokens like "%" or "TH" avoid matching everything.
 */

export type CanonicalField =
  // shared
  | 'project'
  | 'category'
  | 'description'
  | 'month'
  | 'date'
  | 'unit'
  | 'customer'
  | 'note'
  // bank
  | 'bank_name'
  | 'bank_account'
  | 'bank_current_amount'
  | 'pending_expense'
  | 'bank_available'
  // receivable
  | 'contractual_amount'
  | 'receive_amount'
  | 'accrue_amount'
  | 'due_date'
  | 'percent'
  // wip
  | 'account_code'
  | 'account_name'
  | 'current_period'
  | 'ytd'
  | 'advance_payment'
  // boq
  | 'boq_amount'
  | 'boq_to_date'
  | 'paid_amount'
  | 'pending_amount'
  | 'accrued_amount'
  | 'contractor'
  | 'remaining_amount'
  // payable
  | 'invoice_no'
  | 'invoice_date'
  | 'invoice_amount'
  | 'outstanding_amount'
  // income / expense
  | 'income_amount'
  | 'expense_amount'
  | 'amount'
  // cashflow
  | 'opening_balance'
  | 'expected_income'
  | 'expected_expense'
  | 'net_cashflow'
  | 'closing_balance'
  // general ledger
  | 'debit'
  | 'credit'
  | 'balance'
  | 'voucher_no'
  | 'vendor'
  | 'cost_code'
  | 'module'
  | 'job';

export interface FieldSynonym {
  field: CanonicalField;
  labels: string[];
  weight?: number;
  exact?: boolean;
}

export const FIELD_SYNONYMS: FieldSynonym[] = [
  // --------------------------------------------------------------- payable
  {
    field: 'invoice_no',
    labels: ['invoice no', 'invoice number', 'invoice', 'bill no', 'เลขที่ใบแจ้งหนี้', 'เลขที่บิล', 'เลขที่ใบวางบิล'],
  },
  {
    field: 'invoice_date',
    labels: ['invoice date', 'bill date', 'วันที่ใบแจ้งหนี้', 'วันที่วางบิล', 'ลงวันที่'],
  },
  {
    field: 'invoice_amount',
    labels: ['invoice amount', 'bill amount', 'amount due', 'ยอดใบแจ้งหนี้', 'จำนวนเงินตามใบแจ้งหนี้', 'ยอดหนี้'],
  },
  {
    field: 'outstanding_amount',
    labels: ['outstanding', 'outstanding amount', 'balance due', 'unpaid', 'คงค้าง', 'ยอดคงค้าง', 'ค้างชำระ'],
  },

  // ---------------------------------------------------------------- shared
  {
    field: 'project',
    labels: ['project', 'project name', 'โครงการ', 'ชื่อโครงการ', 'business unit', 'bu'],
  },
  {
    field: 'category',
    labels: ['category', 'type', 'ประเภท', 'หมวด', 'หมวดหมู่', 'รายการ', 'item type', 'cost category'],
  },
  {
    field: 'description',
    labels: ['description', 'detail', 'details', 'item', 'รายละเอียด', 'รายการ', 'name', 'ชื่อรายการ'],
    weight: 0.7,
  },
  { field: 'month', labels: ['month', 'period', 'เดือน', 'งวด', 'งวดที่', 'yyyy-mm', 'mth'] },
  { field: 'date', labels: ['date', 'วันที่', 'as of', 'as of date', 'report date', 'ณ วันที่'] },
  { field: 'unit', labels: ['unit', 'unit no', 'unit no.', 'room', 'ห้อง', 'ยูนิต', 'แปลง', 'บ้านเลขที่', 'house no'] },
  {
    field: 'customer',
    labels: ['customer', 'customer name', 'client', 'buyer', 'ลูกค้า', 'ชื่อลูกค้า', 'ผู้ซื้อ', 'ลูกหนี้'],
  },
  { field: 'note', labels: ['note', 'notes', 'remark', 'remarks', 'หมายเหตุ'] },

  // ------------------------------------------------------------------ bank
  { field: 'bank_name', labels: ['bank', 'bank name', 'bank status', 'ธนาคาร', 'ชื่อธนาคาร'] },
  {
    field: 'bank_account',
    labels: ['account no', 'account number', 'bank account', 'เลขที่บัญชี', 'บัญชี', 'a/c no'],
  },
  {
    field: 'bank_current_amount',
    labels: [
      'bank current amount',
      'current amount',
      'bank balance',
      'current balance',
      'ยอดคงเหลือ',
      'ยอดเงินคงเหลือ',
      'เงินคงเหลือ',
      'ยอดธนาคาร',
    ],
    // A bare "Balance" belongs to the ledger's running-balance column, not to
    // a bank position, so it is deliberately NOT listed here.
    weight: 1.2,
  },
  {
    field: 'pending_expense',
    labels: [
      'pending expense',
      'pending expenses',
      'pending payment',
      'ค่าใช้จ่ายค้างจ่าย',
      'ค้างจ่าย',
      'รอจ่าย',
      'เจ้าหนี้ค้างจ่าย',
    ],
    weight: 1.2,
  },
  {
    field: 'bank_available',
    labels: ['available cash', 'available balance', 'net bank balance', 'เงินคงเหลือสุทธิ', 'เงินสดคงเหลือ'],
  },

  // ------------------------------------------------------------ receivable
  {
    field: 'contractual_amount',
    labels: [
      'contractual amount',
      'contract amount',
      'contract value',
      'total contract',
      'ยอดตามสัญญา',
      'มูลค่าสัญญา',
      'ยอดสัญญา',
      'ราคาขาย',
      'ราคาตามสัญญา',
    ],
    weight: 1.3,
  },
  {
    field: 'receive_amount',
    labels: [
      'receive amount',
      'received amount',
      'received',
      'receive',
      'amount received',
      'collected',
      'รับแล้ว',
      'ยอดรับแล้ว',
      'เงินรับแล้ว',
      'ได้รับแล้ว',
      'ชำระแล้ว',
      'ยอดชำระ',
    ],
    weight: 1.3,
  },
  {
    field: 'accrue_amount',
    labels: [
      'accrue amount',
      'accrued amount',
      'accrued',
      'accrue',
      'outstanding',
      'balance due',
      'receivable',
      'ค้างรับ',
      'ยอดค้างรับ',
      'คงค้าง',
      'ค้างชำระ',
      'ยอดคงค้าง',
    ],
    weight: 1.3,
  },
  { field: 'due_date', labels: ['due date', 'duedate', 'กำหนดชำระ', 'ครบกำหนด', 'วันครบกำหนด'] },
  { field: 'percent', labels: ['%', 'percent', 'percentage', 'ratio', 'เปอร์เซ็นต์', 'ร้อยละ'], exact: true },

  // ------------------------------------------------------------------- wip
  {
    field: 'account_code',
    labels: ['account code', 'acc code', 'code', 'gl code', 'รหัสบัญชี', 'เลขที่บัญชี', 'a/c code'],
    weight: 1.2,
  },
  {
    field: 'account_name',
    labels: ['account name', 'acc name', 'account', 'ชื่อบัญชี', 'บัญชี', 'gl name'],
    weight: 1.1,
  },
  {
    field: 'current_period',
    labels: [
      'current period',
      'current',
      'this period',
      'period amount',
      'งวดปัจจุบัน',
      'ประจำงวด',
      'เดือนนี้',
      'งวดนี้',
    ],
    weight: 1.2,
  },
  {
    field: 'ytd',
    labels: ['ytd', 'year to date', 'yeartodate', 'accumulated', 'สะสม', 'ยอดสะสม', 'ตั้งแต่ต้นปี'],
    weight: 1.2,
  },
  {
    field: 'advance_payment',
    labels: ['advance payment', 'advance', 'prepaid', 'เงินจ่ายล่วงหน้า', 'จ่ายล่วงหน้า', 'เงินมัดจำ'],
  },

  // ------------------------------------------------------------------- boq
  {
    field: 'boq_amount',
    labels: ['boq', 'boq amount', 'total boq', 'boq total', 'contract boq', 'งบประมาณ', 'ยอด boq', 'มูลค่างาน'],
    weight: 1.2,
  },
  {
    field: 'boq_to_date',
    labels: ['boq to date', 'amount to date', 'to date', 'work done', 'ผลงานสะสม', 'ยอดถึงปัจจุบัน', 'มูลค่างานสะสม'],
    weight: 1.2,
  },
  {
    field: 'paid_amount',
    labels: ['paid', 'paid amount', 'payment', 'amount paid', 'จ่ายแล้ว', 'ยอดจ่าย', 'เบิกจ่าย', 'ชำระแล้ว'],
    weight: 1.2,
  },
  {
    field: 'pending_amount',
    labels: ['pending', 'pending amount', 'unpaid', 'ค้างจ่าย', 'รอเบิก', 'ยังไม่จ่าย'],
  },
  {
    field: 'accrued_amount',
    labels: ['accrued expense', 'accrued cost', 'outstanding amount', 'ค่าใช้จ่ายค้าง', 'ต้นทุนค้าง'],
  },
  {
    field: 'contractor',
    labels: ['contractor', 'vendor', 'supplier', 'ผู้รับเหมา', 'ผู้ขาย', 'ผู้จำหน่าย', 'ร้านค้า'],
  },
  {
    field: 'remaining_amount',
    labels: ['remaining', 'remaining boq', 'balance remaining', 'คงเหลือ', 'ยอดคงเหลือ', 'ส่วนที่เหลือ'],
  },

  // -------------------------------------------------------- income/expense
  {
    field: 'income_amount',
    labels: ['income', 'revenue', 'sales', 'รายได้', 'ยอดขาย', 'รายรับ'],
  },
  {
    field: 'expense_amount',
    labels: ['expense', 'expenses', 'cost', 'ค่าใช้จ่าย', 'ต้นทุน', 'รายจ่าย'],
  },
  { field: 'amount', labels: ['amount', 'total', 'value', 'จำนวนเงิน', 'ยอดเงิน', 'รวม', 'จำนวน'], weight: 0.8 },

  // -------------------------------------------------------------- cashflow
  {
    field: 'opening_balance',
    labels: ['opening', 'opening cash', 'opening balance', 'beginning balance', 'ยอดยกมา', 'เงินสดต้นงวด'],
  },
  {
    field: 'expected_income',
    labels: ['expected income', 'cash in', 'inflow', 'estimated income', 'รายได้คาดการณ์', 'เงินเข้า', 'ประมาณการรายรับ'],
  },
  {
    field: 'expected_expense',
    labels: ['expected expense', 'cash out', 'outflow', 'estimated expense', 'ค่าใช้จ่ายคาดการณ์', 'เงินออก', 'ประมาณการรายจ่าย'],
  },
  {
    field: 'net_cashflow',
    labels: ['net cash flow', 'net cashflow', 'net', 'กระแสเงินสดสุทธิ', 'สุทธิ'],
  },
  {
    field: 'closing_balance',
    labels: ['closing', 'closing cash', 'closing balance', 'ending balance', 'ยอดยกไป', 'เงินสดปลายงวด', 'คงเหลือสิ้นงวด'],
  },

  // -------------------------------------------------------- general ledger
  // The accounting system exports these headers verbatim on every GL report.
  { field: 'debit', labels: ['debit', 'dr', 'เดบิต', 'เดบิท'], weight: 1.3, exact: true },
  { field: 'credit', labels: ['credit', 'cr', 'เครดิต'], weight: 1.3, exact: true },
  {
    field: 'balance',
    labels: ['balance', 'running balance', 'ยอดคงเหลือสะสม', 'ยอดยกไป'],
    weight: 1.1,
    exact: true,
  },
  {
    field: 'voucher_no',
    labels: ['voucher no', 'voucher no.', 'voucher', 'doc no', 'document no', 'เลขที่เอกสาร', 'เลขที่ใบสำคัญ'],
    weight: 1.2,
  },
  {
    field: 'vendor',
    labels: ['vendor/customer', 'vendor', 'supplier name', 'payee', 'คู่ค้า', 'ผู้ขาย/ลูกค้า'],
    weight: 1.2,
  },
  {
    field: 'cost_code',
    labels: ['cost code', 'ref. code (proj./dpt)', 'ref code', 'project code', 'รหัสต้นทุน', 'รหัสโครงการ'],
  },
  { field: 'module', labels: ['module', 'source module', 'โมดูล'], exact: true },
  { field: 'job', labels: ['job', 'job no', 'job code', 'งาน'], exact: true },
];

/**
 * Receivable/income categories (requirement 5 & 7). Matching a row's label to
 * one of these is what turns a spreadsheet line into a typed record.
 */
export type IncomeCategory =
  | 'reservation'
  | 'contract'
  | 'down_payment'
  | 'transfer_fee'
  | 'rental'
  | 'related_company'
  | 'other_income';

export interface CategoryRule {
  category: IncomeCategory;
  labels: string[];
  /** Higher wins when several rules match the same text. */
  priority: number;
}

export const INCOME_CATEGORY_RULES: CategoryRule[] = [
  {
    category: 'down_payment',
    labels: ['down payment', 'downpayment', 'down', 'เงินดาวน์', 'ดาวน์', 'ค่างวดดาวน์'],
    priority: 30,
  },
  {
    category: 'transfer_fee',
    labels: ['transfer fee', 'transfer', 'ค่าโอน', 'ค่าธรรมเนียมโอน', 'วันโอน', 'โอนกรรมสิทธิ์'],
    priority: 30,
  },
  {
    category: 'reservation',
    labels: ['reservation', 'reserve', 'booking', 'เงินจอง', 'จอง', 'ค่าจอง'],
    priority: 30,
  },
  {
    category: 'rental',
    labels: ['rental', 'rent', 'rental income', 'ค่าเช่า', 'รายได้ค่าเช่า'],
    priority: 25,
  },
  {
    category: 'related_company',
    labels: ['related company', 'related party', 'intercompany', 'บริษัทที่เกี่ยวข้อง', 'กิจการที่เกี่ยวข้อง'],
    priority: 25,
  },
  {
    category: 'contract',
    labels: ['contract', 'contract amount', 'agreement', 'สัญญา', 'ค่างวดสัญญา', 'ตามสัญญา'],
    priority: 20,
  },
  {
    category: 'other_income',
    labels: ['other income', 'other', 'misc', 'รายได้อื่น', 'อื่นๆ', 'อื่น ๆ'],
    priority: 5,
  },
];

export type ExpenseCategory =
  | 'construction'
  | 'sales'
  | 'marketing'
  | 'tax'
  | 'administration'
  | 'contractor'
  | 'material'
  | 'pending_expense'
  | 'other_expense';

export const EXPENSE_CATEGORY_RULES: { category: ExpenseCategory; labels: string[]; priority: number }[] = [
  {
    category: 'construction',
    labels: ['construction', 'boq', 'build', 'ก่อสร้าง', 'งานก่อสร้าง', 'ค่าก่อสร้าง'],
    priority: 30,
  },
  { category: 'contractor', labels: ['contractor', 'subcontractor', 'ผู้รับเหมา', 'ค่าจ้างเหมา'], priority: 28 },
  { category: 'material', labels: ['material', 'materials', 'วัสดุ', 'ค่าวัสดุ', 'ซื้อวัสดุ'], priority: 28 },
  { category: 'marketing', labels: ['marketing', 'advertising', 'ad', 'การตลาด', 'ค่าโฆษณา', 'โฆษณา'], priority: 26 },
  { category: 'sales', labels: ['sales', 'commission', 'ค่าคอมมิชชั่น', 'ค่าขาย', 'ค่านายหน้า'], priority: 26 },
  {
    category: 'tax',
    labels: ['tax', 'vat', 'withholding', 'ภาษี', 'ภาษีมูลค่าเพิ่ม', 'ภาษีหัก ณ ที่จ่าย', 'ภาษีธุรกิจเฉพาะ'],
    priority: 26,
  },
  {
    category: 'administration',
    labels: ['administration', 'admin', 'office', 'overhead', 'g&a', 'ค่าบริหาร', 'สำนักงาน', 'ค่าใช้จ่ายสำนักงาน'],
    priority: 24,
  },
  {
    category: 'pending_expense',
    labels: ['pending expense', 'pending', 'ค้างจ่าย', 'รอจ่าย'],
    priority: 22,
  },
  {
    category: 'other_expense',
    labels: ['other expense', 'other', 'misc', 'ค่าใช้จ่ายอื่น', 'อื่นๆ', 'อื่น ๆ'],
    priority: 5,
  },
];

/** Row labels that mark a subtotal/total line — excluded from SUMs to avoid double counting. */
export const TOTAL_ROW_LABELS = [
  'total',
  'grand total',
  'sub total',
  'subtotal',
  'sum',
  'รวม',
  'รวมทั้งสิ้น',
  'ยอดรวม',
  'รวมทั้งหมด',
  'ผลรวม',
];
