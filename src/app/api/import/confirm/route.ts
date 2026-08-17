import { NextResponse } from 'next/server';

import { can, currentUser } from '@/lib/auth';
import { getDb, parseJson } from '@/lib/db';
import { persistImport } from '@/lib/db/repositories/imports';
import { listProjects } from '@/lib/db/repositories/projects';
import { listTemplates } from '@/lib/db/repositories/templates';
import { ProjectResolver } from '@/lib/detect/project-resolver';
import { processFiles, type FileOverride, type UploadedFile } from '@/lib/import/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface PreviewPayload {
  previewId: string;
  uploadRoot: string;
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

  const body = (await request.json()) as {
    previewId?: string;
    reportDate?: string;
    label?: string;
    mode?: 'new' | 'replace';
    overrides?: FileOverride[];
  };

  if (!body.previewId) {
    return NextResponse.json({ error: 'No preview was supplied.' }, { status: 400 });
  }

  const db = getDb();
  const row = db
    .prepare<[string, string], { payload_json: string; expires_at: string }>(
      'SELECT payload_json, expires_at FROM import_previews WHERE id = ? AND user_id = ?',
    )
    .get(body.previewId, user.id);

  if (!row) {
    return NextResponse.json(
      { error: 'That preview has expired or belongs to another user. Upload the files again.' },
      { status: 404 },
    );
  }

  const payload = parseJson<PreviewPayload | null>(row.payload_json, null);
  if (!payload) {
    return NextResponse.json({ error: 'The staged preview could not be read.' }, { status: 500 });
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

  const resolver = new ProjectResolver(listProjects());

  let results;
  try {
    results = await processFiles(uploads, {
      resolver,
      templates: listTemplates(),
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

  let outcome;
  try {
    outcome = persistImport({
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

  return NextResponse.json({
    ...outcome,
    reportDate,
    fileCount: results.length,
    failedFiles: results.filter((r) => r.status === 'failed').map((r) => r.fileName),
  });
}
