import { NextResponse } from 'next/server';

import { activeCompany, can, currentUser } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { getDb, nowIso, parseJson } from '@/lib/db';
import { findDuplicates, persistImport } from '@/lib/db/repositories/imports';
import { listProjects } from '@/lib/db/repositories/projects';
import { listTemplatesForCompany } from '@/lib/db/repositories/templates';
import { ProjectResolver } from '@/lib/detect/project-resolver';
import { processFiles, type FileOverride, type UploadedFile } from '@/lib/import/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface PreviewPayload {
  previewId: string;
  uploadRoot: string;
  companyId?: string;
  reportDate: string;
  files: {
    filePath: string;
    fileName: string;
    size: number;
    hash: string;
    containerFile: string | null;
  }[];
}

/**
 * Confirms an import.
 *
 * The staged files are re-parsed with the user's overrides applied, then the
 * whole result is written in one transaction. Re-parsing rather than reusing
 * the preview's output means a changed mapping genuinely changes the data,
 * and the preview payload stays small.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (!can(user, 'import:run')) {
    return NextResponse.json({ error: 'Your role cannot import data.' }, { status: 403 });
  }

  // Data is imported into the company in session, resolved here rather than
  // taken from the request. A browser cannot name the company its upload lands
  // in, which is the only way this stays true when someone edits a request.
  const company = await activeCompany();
  if (!company) {
    return NextResponse.json(
      { error: 'Select a company before importing.' },
      { status: 409 },
    );
  }

  const body = (await request.json()) as {
    previewId?: string;
    reportDate?: string;
    label?: string;
    mode?: 'new' | 'replace';
    overrides?: FileOverride[];
    /**
     * Set by the preview screen once the person importing has seen the
     * duplicate warning and chosen to go ahead anyway.
     */
    acknowledgeDuplicates?: boolean;
  };

  if (!body.previewId) {
    return NextResponse.json({ error: 'No preview was supplied.' }, { status: 400 });
  }

  const db = getDb();
  const row = db
    .prepare<[string, string], { payload_json: string; expires_at: string; company_id: string | null }>(
      'SELECT payload_json, expires_at, company_id FROM import_previews WHERE id = ? AND user_id = ?',
    )
    .get(body.previewId, user.id);

  if (!row) {
    return NextResponse.json(
      { error: 'That preview has expired or belongs to another user. Upload the files again.' },
      { status: 404 },
    );
  }

  // The expiry was stored but never read, so a preview stayed usable until
  // somebody happened to run the cleanup — a stale set of files could be
  // confirmed days later against data that had moved on since.
  if (row.expires_at <= nowIso()) {
    db.prepare('DELETE FROM import_previews WHERE id = ?').run(body.previewId);
    return NextResponse.json(
      { error: 'That preview has expired. Upload the files again.' },
      { status: 410 },
    );
  }

  const payload = parseJson<PreviewPayload | null>(row.payload_json, null);
  if (!payload) {
    return NextResponse.json({ error: 'The staged preview could not be read.' }, { status: 500 });
  }

  // The files were parsed against one company's projects and the preview
  // screen named that company. Switching company in another tab and confirming
  // would file them somewhere the person importing never saw.
  const previewCompany = row.company_id ?? payload.companyId ?? null;
  if (previewCompany && previewCompany !== company.id) {
    return NextResponse.json(
      {
        error:
          'This preview was prepared for a different company. Switch back to it, or upload the files again under the company you want them in.',
      },
      { status: 409 },
    );
  }

  const uploads: UploadedFile[] = payload.files.map((f) => ({
    filePath: f.filePath,
    fileName: f.fileName,
    size: f.size,
    hash: f.hash,
    containerFile: f.containerFile ?? undefined,
  }));

  const reportDate = (body.reportDate ?? payload.reportDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    return NextResponse.json({ error: 'The report date is not a valid date.' }, { status: 400 });
  }

  // Only this company's projects can be matched. A file naming another
  // company's project therefore resolves to nothing here rather than silently
  // filing rows under a project the importer is not allowed to touch.
  const companyProjects = listProjects().filter((p) => p.companyId === company.id);
  const resolver = new ProjectResolver(companyProjects);

  let results;
  try {
    results = await processFiles(uploads, {
      resolver,
      templates: listTemplatesForCompany(company.id),
      defaultReportDate: reportDate,
      overrides: body.overrides ?? [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: `The files could not be re-read: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  const parsed = results.filter((r) => r.status === 'parsed');
  if (parsed.length === 0) {
    return NextResponse.json(
      { error: 'None of the files could be read, so nothing was imported.' },
      { status: 400 },
    );
  }

  // Duplicates are re-checked here, not only in the preview: minutes can pass
  // between the two, and the same workbook may have been imported in that
  // gap — by this person in another tab or by a colleague.
  const duplicates = findDuplicates(
    company.id,
    parsed.map((r) => ({
      fileName: r.fileName,
      hash: r.hash,
      reportDate: r.reportDate,
      projectId: r.project.projectId,
      reportType: r.reportType,
    })),
  );

  if (duplicates.length > 0 && !body.acknowledgeDuplicates) {
    return NextResponse.json(
      {
        error:
          duplicates.length === 1
            ? `"${duplicates[0].fileName}" has already been imported. Confirm again to import it anyway.`
            : `${duplicates.length} of these files have already been imported. Confirm again to import them anyway.`,
        duplicates,
        needsAcknowledgement: true,
      },
      { status: 409 },
    );
  }

  let outcome;
  try {
    outcome = persistImport({
      companyId: company.id,
      reportDate,
      label: body.label?.trim() || null,
      userId: user.id,
      files: results,
      issues: [],
      mode: body.mode ?? 'new',
    });
  } catch (err) {
    return NextResponse.json(
      { error: `The import could not be saved: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  // The preview is spent; the originals stay on disk as the audit copy.
  db.prepare('DELETE FROM import_previews WHERE id = ?').run(body.previewId);

  // Every figure on every dashboard traces back to one of these.
  await audit({
    action: 'import.confirm',
    entity: 'import',
    entityId: outcome.importId,
    summary: `Imported ${results.length} file${results.length === 1 ? '' : 's'} for ${reportDate}`,
    detail: {
      reportDate,
      label: body.label?.trim() || null,
      mode: body.mode ?? 'new',
      snapshotId: outcome.snapshotId,
      files: results.map((r) => r.fileName),
      failed: results.filter((r) => r.status === 'failed').map((r) => r.fileName),
    },
    companyId: company.id,
  });

  return NextResponse.json({
    ...outcome,
    reportDate,
    fileCount: results.length,
    failedFiles: results.filter((r) => r.status === 'failed').map((r) => r.fileName),
  });
}
