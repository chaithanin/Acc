import { makeSourceRef } from '@/lib/excel/cells';
import type { PayableRecord } from '@/lib/types';
import { dataRows, detectExpenseCategory, rowFingerprint, type NormalizeContext } from './context';

/**
 * Vendor payables.
 *
 * The mirror of the receivable sheet: an invoice, who it is from, when it
 * falls due, and how much of it has been paid. Until this existed the
 * liquidity ratios divided by certified-but-unpaid construction and called the
 * result Accounts Payable, which said nothing about a vendor invoice sitting
 * unpaid on someone's desk.
 *
 * What is left on an invoice is recomputed from the invoice and payment
 * columns rather than read from the file's own outstanding column. The stated
 * figure is kept beside it so the two can be compared, which is a check the
 * file cannot pass by restating itself.
 */
export function normalizePayable(ctx: NormalizeContext): PayableRecord[] {
  const records: PayableRecord[] = [];
  const seen = new Map<string, number>();

  for (const row of dataRows(ctx)) {
    const invoice = row.num('invoice_amount') ?? row.num('amount') ?? row.num('expense_amount');
    const paid = row.num('paid_amount');
    const stated = row.num('outstanding_amount') ?? row.num('remaining_amount');

    // A row with no money on it is a spacer, a note or a section heading.
    if (invoice === null && paid === null && stated === null) continue;

    const vendor = row.text('vendor') ?? row.text('contractor') ?? row.text('customer');
    const project = row.project();

    // An invoice column is the usual case. Where a sheet gives only what is
    // left, that figure is the invoice and nothing has been paid against it —
    // reading it as a zero invoice would report the company owing nothing.
    const invoiceAmount = invoice ?? stated ?? 0;
    const paidAmount = paid ?? (invoice === null && stated !== null ? 0 : (paid ?? 0));

    const record: PayableRecord = {
      kind: 'payable',
      sourceRef: row.ref('invoice_amount'),
      projectId: project.id,
      projectLabel: project.label,
      vendor,
      invoiceNo: row.text('invoice_no'),
      description: row.text('description'),
      category: detectExpenseCategory(row.labelTexts()) ?? null,
      invoiceDate: row.date('invoice_date') ?? row.date('date'),
      dueDate: row.date('due_date'),
      invoiceAmount,
      paidAmount,
      statedOutstanding: stated,
    };

    flagDuplicate(ctx, seen, row.rowIndex, [
      record.vendor,
      record.invoiceNo,
      record.invoiceAmount,
      record.invoiceDate,
    ]);

    records.push(record);
  }

  return records;
}

/**
 * An invoice number appearing twice is the one duplicate that matters here:
 * paying the same bill twice is how money leaves a company by accident.
 */
function flagDuplicate(
  ctx: NormalizeContext,
  seen: Map<string, number>,
  rowIndex: number,
  parts: (string | number | null)[],
) {
  const key = rowFingerprint(parts);
  if (key.replace(/\|/g, '') === '') return;

  const first = seen.get(key);
  if (first !== undefined) {
    ctx.addIssue({
      severity: 'warning',
      code: 'DUPLICATE_PAYABLE',
      message:
        `This invoice is identical to row ${first + 1 + ctx.sheet.originRow} — same vendor, `
        + 'number, amount and date. Both were imported and the company may be shown owing it twice.',
      source: makeSourceRef(ctx.fileName, ctx.sheet, rowIndex, null),
    });
    return;
  }
  seen.set(key, rowIndex);
}
