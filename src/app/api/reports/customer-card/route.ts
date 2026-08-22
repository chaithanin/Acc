import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

import { activeCompany, can, currentUser } from '@/lib/auth';
import { UPLOAD_DIR } from '@/lib/db';
import { saveReport } from '@/lib/db/repositories/customer-card-reports';
import { DEFAULT_OPTIONS, generateCustomerCardReport } from '@/lib/reports/customer-card';

export const runtime = 'nodejs';
// Solving a rate per unit over a five-year grid takes a while on a big file.
export const maxDuration = 300;

const ACCEPTED = new Set(['.xlsx', '.xls', '.xlsm', '.xlsb']);
const MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * Customer card in, Interest / Advance-received workbook out.
 *
 * The workbook and what it said are recorded, so a report can be found again
 * without re-running it against a card Finance may no longer have, and so a
 * figure someone queried months later can still be traced to the file it came
 * from.
 *
 * Nothing reaches the financial tables. Putting this through the import
 * pipeline would make it a source of dashboard figures, which it is not.
 *
 * The uploaded card itself is deleted before the response is sent — it is
 * somebody's list of buyers and what they still owe, and once it has been read
 * there is no reason to keep it. What is kept is the report made from it, and
 * the hash of the card, which is enough to prove which file it was.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (!can(user, 'import:run')) {
    return NextResponse.json({ error: 'Your role cannot run this report.' }, { status: 403 });
  }

  const company = await activeCompany();
  if (!company) {
    return NextResponse.json({ error: 'Choose a company first.' }, { status: 403 });
  }

  // A request that is not a form throws inside formData(), which Next turns
  // into a 500 and a stack trace in the log. It is a bad request, and should
  // read as one.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Send the customer card as a multipart form.' },
      { status: 400 },
    );
  }

  const file = form.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file was uploaded.' }, { status: 400 });
  }

  const extension = path.extname(file.name).toLowerCase();
  if (!ACCEPTED.has(extension)) {
    return NextResponse.json(
      { error: `"${file.name}" is not an Excel file.` },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'The file is larger than the 50 MB limit.' }, { status: 400 });
  }

  const reportDate = String(form.get('reportDate') ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    return NextResponse.json({ error: 'A report date is required.' }, { status: 400 });
  }

  const completionDate = String(form.get('completionDate') ?? '').trim();
  if (completionDate && !/^\d{4}-\d{2}-\d{2}$/.test(completionDate)) {
    return NextResponse.json(
      { error: 'The building completion date is not a valid date.' },
      { status: 400 },
    );
  }

  const upliftInput = String(form.get('maxUplift') ?? '').trim();
  const maxUplift = upliftInput === '' ? DEFAULT_OPTIONS.maxUplift : Number(upliftInput) / 100;
  if (!Number.isFinite(maxUplift) || maxUplift < 0 || maxUplift > 2) {
    return NextResponse.json(
      { error: 'The selling-price uplift must be a percentage between 0 and 200.' },
      { status: 400 },
    );
  }

  const projectLabel = String(form.get('projectLabel') ?? '').trim() || company.companyCode;

  // The stored name is generated, never taken from the upload, so a crafted
  // file name cannot escape the directory.
  const workDir = path.join(UPLOAD_DIR, `report-${randomUUID()}`);
  await fs.mkdir(workDir, { recursive: true });
  const cardPath = path.join(workDir, `card${extension}`);

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(cardPath, bytes);

    const result = await generateCustomerCardReport(cardPath, file.name, {
      projectLabel,
      reportDate,
      completionDate: completionDate || DEFAULT_OPTIONS.completionDate,
      maxUplift,
      tolerance: DEFAULT_OPTIONS.tolerance,
    });

    const model = result.model;
    const sourceHash = createHash('sha256').update(bytes).digest('hex');

    const stored = saveReport({
      companyId: company.id,
      projectLabel,
      reportDate,
      completionDate: completionDate || DEFAULT_OPTIONS.completionDate,
      maxUplift,
      sourceFileName: file.name,
      sourceHash,
      sourceRows: model.summary.sourceRows,
      sheetName: result.sheetName,
      headerRow: result.headerRow,
      workbook: result.workbook,
      contracts: model.summary.contracts,
      units: model.summary.units,
      totalSalePrice: model.summary.totalSalePrice,
      totalExpected: model.summary.totalExpectedSellingPrice,
      totalPlan: model.summary.totalPlan,
      totalPaid: model.summary.totalPaid,
      totalOutstanding: model.summary.totalOutstanding,
      totalInterest: model.summary.totalInterestExpense,
      okCount: model.summary.ok,
      checkCount: model.summary.check,
      errorCount: model.summary.error,
      checks: model.checks,
      issues: model.issues,
      needsConfirmation: model.summary.needsConfirmation,
      userId: user.id,
    });

    const summary = {
      ...model.summary,
      reportId: stored.id,
      sheetName: result.sheetName,
      headerRow: result.headerRow,
      sourceHash: sourceHash.slice(0, 16),
      issues: model.issues.slice(0, 200),
    };

    const name = `Interest-Advance received_${projectLabel}_${reportDate.replaceAll('-', '.')}.xlsx`;

    return new NextResponse(new Uint8Array(result.workbook), {
      status: 200,
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="${encodeURIComponent(name)}"`,
        // The summary rides along on the response so the page can show what
        // was produced without the file having to be opened first.
        'x-report-summary': encodeURIComponent(JSON.stringify(summary)),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  } finally {
    // The customer card is somebody's list of buyers and what they still owe.
    // It is not kept.
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
