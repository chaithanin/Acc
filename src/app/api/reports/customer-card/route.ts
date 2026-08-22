import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

import { activeCompany, can, currentUser } from '@/lib/auth';
import { UPLOAD_DIR } from '@/lib/db';
import { DEFAULT_OPTIONS, generateCustomerCardReport } from '@/lib/reports/customer-card';

export const runtime = 'nodejs';
// Solving a rate per unit over a five-year grid takes a while on a big file.
export const maxDuration = 300;

const ACCEPTED = new Set(['.xlsx', '.xls', '.xlsm', '.xlsb']);
const MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * Customer card in, Interest / Advance-received workbook out.
 *
 * Deliberately stateless: nothing is written to the financial tables. This
 * report reads a file Finance already has and hands back a file — putting it
 * through the import pipeline would make it a source of dashboard figures,
 * which it is not, and would give it a second way into company-scoped data
 * that would then have to be defended.
 *
 * The uploaded file is deleted before the response is sent. It is somebody's
 * customer list.
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

  const form = await request.formData();
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
  const stored = path.join(workDir, `card${extension}`);

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(stored, bytes);

    const result = await generateCustomerCardReport(stored, file.name, {
      projectLabel,
      reportDate,
      completionDate: completionDate || DEFAULT_OPTIONS.completionDate,
      maxUplift,
      tolerance: DEFAULT_OPTIONS.tolerance,
    });

    const summary = {
      ...result.model.summary,
      sheetName: result.sheetName,
      headerRow: result.headerRow,
      sourceHash: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
      issues: result.model.issues.slice(0, 200),
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
