import { NextResponse } from 'next/server';
import { activeCompany, can, currentUser } from '@/lib/auth';
import { getImportSummary, rollbackImport } from '@/lib/db/repositories/imports';
import { recalculateSnapshot } from '@/lib/db/repositories/snapshots';

export const runtime = 'nodejs';

/**
 * Import actions (requirement 24): rollback and recalculate.
 *
 * Recalculate re-runs the calculation and reconciliation engines over the
 * stored records — no file is re-read, which is the point of keeping
 * normalized data rather than only summary figures.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (!can(user, 'import:rollback')) {
    return NextResponse.json({ error: 'Your role cannot change imports.' }, { status: 403 });
  }

  // Rollback and recalculate both rewrite what a dashboard shows. Neither may
  // reach an import belonging to a company other than the active one, so the
  // company is resolved before the id in the URL is used for anything.
  const company = await activeCompany();
  if (!company) {
    return NextResponse.json({ error: 'Choose a company first.' }, { status: 403 });
  }

  const { id } = await params;
  const { action, snapshotId } = (await request.json()) as {
    action?: 'rollback' | 'recalculate';
    snapshotId?: string;
  };

  const summary = getImportSummary(company.id, id);
  if (!summary) return NextResponse.json({ error: 'Import not found.' }, { status: 404 });

  try {
    if (action === 'rollback') {
      const done = rollbackImport(company.id, id);
      if (!done) {
        return NextResponse.json(
          { error: 'This import has already been rolled back.' },
          { status: 409 },
        );
      }
      return NextResponse.json({ ok: true, action: 'rollback' });
    }

    if (action === 'recalculate') {
      // A snapshotId in the body is only honoured when it is the one this
      // import actually produced. Anything else — including a valid snapshot
      // id from another company — recalculates nothing.
      const target = snapshotId ?? summary.snapshotId;
      if (!target || (snapshotId && snapshotId !== summary.snapshotId)) {
        return NextResponse.json(
          { error: 'This import has no such snapshot to recalculate.' },
          { status: 409 },
        );
      }
      const result = recalculateSnapshot(company.id, target);
      return NextResponse.json({ ok: true, action: 'recalculate', ...result });
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
