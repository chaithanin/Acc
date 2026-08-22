import * as XLSX from 'xlsx';

/**
 * The golden workbook.
 *
 * Built in code rather than committed as a binary, so a reviewer can see
 * exactly what the figures are and change one on purpose. Every sheet uses the
 * header wording the real reports use, because the detector reads the headers
 * — a fixture with tidied-up headers would test a pipeline nobody runs.
 */

export const GOLDEN_REPORT_DATE = '2026-08-31';

const bank = [
  ['Bank Statement — as at 31/08/2026'],
  ['Bank Name', 'Account No', 'Bank Current Amount', 'Pending Expense'],
  ['Kasikorn', '111-2-33333-4', 24_000_000, 1_500_000],
  ['Bangkok Bank', '222-3-44444-5', 6_000_000, 500_000],
];

const receivable = [
  ['Customer Receivable — Hamonia'],
  ['Customer', 'Unit', 'Category', 'Contractual Amount', 'Receive Amount', 'Accrue Amount'],
  ['Somchai', 'A-101', 'Reservation', 1_000_000, 400_000, 600_000],
  ['Malee', 'A-102', 'Contract', 5_000_000, 1_000_000, 4_000_000],
  ['Anan', 'A-103', 'Down Payment', 2_000_000, 2_000_000, 0],
  ['Nid', 'A-104', 'Transfer Fee', 500_000, 0, 500_000],
];

const boq = [
  ['BOQ / Construction — Hamonia'],
  ['Account Code', 'Description', 'Contractor', 'BOQ Amount', 'BOQ To Date', 'Paid Amount', 'Pending Amount'],
  ['5100', 'Structure', 'Somsak Co.', 40_000_000, 30_000_000, 25_000_000, 5_000_000],
  ['5200', 'Architecture', 'Pana Co.', 20_000_000, 8_000_000, 6_000_000, 2_000_000],
];

const wip = [
  ['Work In Progress'],
  ['Account Code', 'Account Name', 'Current Period', 'YTD', 'Advance Payment'],
  ['1400', 'Work in progress', 3_000_000, 12_000_000, 0],
  ['1310', 'Advance to contractor', 0, 0, 2_500_000],
];

const expense = [
  ['Expense — Hamonia'],
  ['Description', 'Category', 'Month', 'Expense Amount', 'Paid Amount', 'Pending Amount'],
  ['Main contractor', 'Construction', '2026-07', 25_000_000, 25_000_000, 0],
  ['Sales & marketing', 'Marketing', '2026-07', 1_200_000, 1_000_000, 200_000],
  ['Head office salaries', 'Salary', '2026-08', 2_400_000, 2_400_000, 0],
  ['Corporate income tax', 'Tax', '2026-08', 600_000, 600_000, 0],
];

/** Writes the golden workbook to `filePath` and returns it. */
export function writeGoldenWorkbook(filePath: string): string {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(bank), 'Bank Statement');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(receivable), 'Receivable');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(boq), 'BOQ Construction');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(wip), 'WIP');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(expense), 'Expense');
  XLSX.writeFile(book, filePath);
  return filePath;
}
