import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

import { activeCompany, can, currentUser } from '@/lib/auth';
import { UPLOAD_DIR, getDb, nowIso } from '@/lib/db';
import { findDuplicates } from '@/lib/db/repositories/imports';
import { listProjects } from '@/lib/db/repositories/projects';
import { listTemplates } from '@/lib/db/repositories/templates';
import { ProjectResolver } from '@/lib/detect/project-resolver';
import { expandUploads, processFiles, type UploadedFile } from '@/lib/import/pipeline';
import { REPORT_TYPE_LABELS } from '@/config/detection-rules';

export const runtime = 'nodejs';
// Parsing several large workbooks is genuinely slow; the default would cut it off.
export const maxDuration = 300;

/** Rejects anything that is not an accepted extension before touching disk. */
const ACCEPTED = new Set(['.xlsx', '.xls', '.xlsm', '.xlsb', '.csv', '.zip']);
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const PREVIEW_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Upload and parse, producing a PREVIEW rather than an import.
 *
 * Nothing is written to the financial tables here — the user confirms first
 * (requirement 14). Original files are stored untouched and re-read at confirm
 * time so any mapping override the user makes is applied consistently.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (!can(user, 'import:run')) {
    return NextResponse.json({ error: 'Your role cannot import data.' }, { status: 403 });
  }

  const form = await request.formData();
  const files = form.getAll('files').filter((f): f is File => f instanceof File);
  const reportDateOverride = String(form.get('reportDate') ?? '').trim();

  if (files.length === 0) {
    return NextResponse.json({ error: 'No files were uploaded.' }, { status: 400 });
  }

  const previewId = randomUUID();
  const uploadRoot = path.join(UPLOAD_DIR, previewId);
  await fs.mkdir(uploadRoot, { recursive: true });

  const uploads: UploadedFile[] = [];
  const rejected: { fileName: string; reason: string }[] = [];

  for (const file of files) {
    const extension = path.extname(file.name).toLowerCase();

    if (!ACCEPTED.has(extension)) {
      rejected.push({ fileName: file.name, reason: 'Not an Excel or ZIP file.' });
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      rejected.push({ fileName: file.name, reason: 'Larger than the 100 MB limit.' });
      continue;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // The stored name is generated, never taken from the upload, so a crafted
    // file name cannot escape the upload directory.
    const storedPath = path.join(uploadRoot, `${uploads.length}${extension}`);
    await fs.writeFile(storedPath, buffer);

    uploads.push({
      filePath: storedPath,
      fileName: file.name,
      size: file.size,
      hash: createHash('sha256').update(buffer).digest('hex'),
    });
  }

  if (uploads.length === 0) {
    return NextResponse.json(
      { error: 'None of the uploaded files could be accepted.', rejected },
      { status: 400 },
    );
  }

  const company = await activeCompany();
  if (!company) {
    return NextResponse.json({ error: 'Select a company before importing.' }, { status: 409 });
  }

  const allProjects = listProjects();
  const companyProjects = allProjects.filter((p) => p.companyId === company.id);

  // Matching runs against this company's projects only, so nothing from
  // another company can be filed here by accident.
  const resolver = new ProjectResolver(companyProjects);

  // A second resolver over every project exists purely to recognise a file
  // that belongs somewhere else. Without it such a file simply looks
  // unrecognised, and "no project matched" reads as a mapping problem rather
  // than as what it is: the wrong company.
  const groupResolver = new ProjectResolver(allProjects);

  const templates = listTemplates();

  const expanded = await expandUploads(uploads, uploadRoot);
  const defaultReportDate = reportDateOverride || new Date().toISOString().slice(0, 10);

  const results = await processFiles(expanded.files, {
    resolver,
    templates,
    defaultReportDate,
  });

  /**
   * Files that name a project belonging to a different company.
   *
   * Reported rather than acted on: the importer does not quietly redirect the
   * upload, and does not quietly accept it either. Whoever is importing
   * decides — cancel, or switch company and upload again.
   */
  const mismatches = results
    .filter((r) => !r.project.projectId)
    .map((r) => {
      const elsewhere = groupResolver.resolveFile(
        r.fileName,
        r.sheets.map((sheet) => sheet.sheetName),
        [],
      );
      if (!elsewhere.projectId) return null;

      const owner = allProjects.find((p) => p.id === elsewhere.projectId);
      if (!owner || owner.companyId === company.id) return null;

      return {
        fileName: r.fileName,
        matchedAlias: elsewhere.matchedAlias,
        projectName: owner.name,
        companyId: owner.companyId,
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  const duplicates = findDuplicates(
    results.map((r) => ({
      fileName: r.fileName,
      hash: r.hash,
      reportDate: r.reportDate,
      projectId: r.project.projectId,
      reportType: r.reportType,
    })),
  );

  // The report date for the whole import is the latest any file declared —
  // a bundle covering several periods is reported as of its newest.
  const reportDate = results.reduce(
    (latest, r) => (r.reportDate > latest ? r.reportDate : latest),
    reportDateOverride || results[0]?.reportDate || defaultReportDate,
  );

  const payload = {
    previewId,
    uploadRoot,
    companyId: company.id,
    reportDate,
    files: expanded.files.map((f) => ({
      filePath: f.filePath,
      fileName: f.fileName,
      size: f.size,
      hash: f.hash,
      containerFile: f.containerFile ?? null,
    })),
  };

  getDb()
    .prepare(
      'INSERT INTO import_previews (id, user_id, payload_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      previewId,
      user.id,
      JSON.stringify(payload),
      nowIso(),
      new Date(Date.now() + PREVIEW_TTL_MS).toISOString(),
    );

  // Only lightweight metadata crosses the wire — the parsed rows stay on the
  // server and are regenerated at confirm time.
  return NextResponse.json({
    previewId,
    reportDate,
    rejected,
    archiveIssues: expanded.issues,
    duplicates,
    company: { id: company.id, displayName: company.displayName, companyCode: company.companyCode },
    mismatches,
    files: results.map((r) => ({
      fileName: r.fileName,
      containerFile: r.containerFile,
      fileType: r.fileType,
      size: r.size,
      status: r.status,
      error: r.error,
      reportDate: r.reportDate,
      reportType: r.reportType,
      reportTypeLabel: REPORT_TYPE_LABELS[r.reportType],
      project: r.project,
      sheetCount: r.sheetCount,
      rowCount: r.rowCount,
      warningCount: r.issues.filter((i) => i.severity === 'warning').length,
      errorCount: r.issues.filter((i) => i.severity === 'error').length,
      issues: r.issues.slice(0, 50),
      recordCounts: {
        bank: r.data.bank.length,
        receivable: r.data.receivable.length,
        income: r.data.income.length,
        expense: r.data.expense.length,
        boq: r.data.boq.length,
        wip: r.data.wip.length,
        cashflow: r.data.cashflow.length,
        gl: r.data.gl.length,
      },
      sheets: r.sheets.map((s) => ({
        sheetName: s.sheetName,
        reportType: s.reportType,
        reportTypeLabel: REPORT_TYPE_LABELS[s.reportType],
        confidence: s.confidence,
        headerRow: s.headerRow,
        parsedCount: s.parsedCount,
        rowCount: s.rowCount,
        templateName: s.templateName,
        headers: s.headers.slice(0, 40),
        columns: s.columns,
      })),
    })),
    projects: listProjects().map((p) => ({ id: p.id, name: p.name, company: p.company })),
  });
}

/** Removes preview rows and their upload directories once they have expired. */
export async function DELETE() {
  const user = await currentUser();
  if (!user || !can(user, 'import:run')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 });
  }

  const db = getDb();
  const expired = db
    .prepare<[string], { id: string; payload_json: string }>(
      'SELECT id, payload_json FROM import_previews WHERE expires_at < ?',
    )
    .all(nowIso());

  for (const row of expired) {
    try {
      const payload = JSON.parse(row.payload_json) as { uploadRoot?: string };
      if (payload.uploadRoot?.startsWith(UPLOAD_DIR)) {
        await fs.rm(payload.uploadRoot, { recursive: true, force: true });
      }
    } catch {
      // A preview we cannot parse is still worth deleting from the table.
    }
    db.prepare('DELETE FROM import_previews WHERE id = ?').run(row.id);
  }

  return NextResponse.json({ removed: expired.length });
}
