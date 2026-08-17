import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { drilldown } from '@/lib/db/repositories/drilldown';

export const runtime = 'nodejs';

/** Record-level detail behind a KPI (requirement 16). */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

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

  try {
    return NextResponse.json(drilldown(snapshotId, metricKey, projectId));
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
