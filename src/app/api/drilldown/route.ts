import { NextResponse } from 'next/server';
import { activeCompany, currentUser } from '@/lib/auth';
import { drilldown } from '@/lib/db/repositories/drilldown';
import { getSnapshot } from '@/lib/db/repositories/snapshots';

export const runtime = 'nodejs';

/**
 * Record-level detail behind a KPI (requirement 16).
 *
 * Every identifier in the query string is a request. The company comes from
 * the session and is checked first: the snapshot must be one this company
 * holds, and the rows returned are filtered on the company again inside the
 * query. A snapshot id copied from another company's URL answers 404, not
 * that company's records.
 */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const company = await activeCompany();
  if (!company) {
    return NextResponse.json({ error: 'Choose a company first.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const snapshotId = url.searchParams.get('snapshotId');
  const metricKey = url.searchParams.get('metricKey');
  const projectId = url.searchParams.get('projectId');

  if (!snapshotId || !metricKey) {
    return NextResponse.json(
      { supported: false, label: '', rows: [], total: 0, error: 'A snapshot and metric are required.' },
      { status: 400 },
    );
  }

  // Not "forbidden": telling the caller that the snapshot exists but is
  // someone else's is itself a disclosure. It is not theirs, so it is not
  // there.
  if (!getSnapshot(company.id, snapshotId)) {
    return NextResponse.json(
      { supported: false, label: '', rows: [], total: 0, error: 'Snapshot not found.' },
      { status: 404 },
    );
  }

  try {
    const scope = { companyId: company.id, snapshotId, projectId: projectId || null };
    return NextResponse.json(drilldown(scope, metricKey));
  } catch (err) {
    return NextResponse.json(
      {
        supported: false,
        label: '',
        rows: [],
        total: 0,
        error: `The details could not be loaded: ${(err as Error).message}`,
      },
      { status: 500 },
    );
  }
}
