import { NextResponse } from 'next/server';

import { activeCompany, can, currentUser } from '@/lib/auth';
import { audit } from '@/lib/audit';
import {
  deleteReport,
  getReport,
  readReportFile,
} from '@/lib/db/repositories/customer-card-reports';

export const runtime = 'nodejs';

/**
 * Downloading a report that was produced earlier.
 *
 * The id arrives in the URL and is therefore a request, not a permission: the
 * company comes from the session and a report belonging to another company
 * answers 404, exactly as one that does not exist would. Saying "forbidden"
 * would confirm that a report for that id exists somewhere.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const company = await activeCompany();
  if (!company) return NextResponse.json({ error: 'Choose a company first.' }, { status: 403 });

  const { id } = await params;
  const report = getReport(company.id, id);
  if (!report) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

  const bytes = readReportFile(company.id, id);
  if (!bytes) {
    return NextResponse.json(
      { error: 'The workbook for this report is no longer on disk. Run it again from the card.' },
      { status: 410 },
    );
  }

  const name = `Interest-Advance received_${report.projectLabel}_${report.reportDate.replaceAll('-', '.')}.xlsx`;

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${encodeURIComponent(name)}"`,
    },
  });
}

/** Removes a report and its workbook. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  // The same permission that produces a report can remove one.
  if (!can(user, 'import:rollback')) {
    return NextResponse.json({ error: 'Your role cannot delete reports.' }, { status: 403 });
  }

  const company = await activeCompany();
  if (!company) return NextResponse.json({ error: 'Choose a company first.' }, { status: 403 });

  const { id } = await params;
  const doomed = getReport(company.id, id);
  if (!deleteReport(company.id, id)) {
    return NextResponse.json({ error: 'Report not found.' }, { status: 404 });
  }

  await audit({
    action: 'report.delete',
    entity: 'customer_card_report',
    entityId: id,
    summary: `Deleted the Customer Card report for ${doomed?.projectLabel ?? 'a project'} dated ${doomed?.reportDate ?? 'unknown'}`,
    detail: { sourceFileName: doomed?.sourceFileName ?? null },
    companyId: company.id,
  });

  return NextResponse.json({ ok: true });
}
