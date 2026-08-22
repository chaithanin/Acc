import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { REPORT_TYPE_LABELS } from '@/config/detection-rules';
import type { CanonicalField } from '@/config/field-synonyms';
import { classifySheet, isDataFeedSheet } from '@/lib/detect/sheet-classifier';
import { ProjectResolver, unresolved } from '@/lib/detect/project-resolver';
import { cellText, endOfMonth, getCell, parseDateText } from '@/lib/excel/cells';
import { ExcelParseError, fileExtension, isExcelFile, isZipFile, readWorkbook } from '@/lib/excel/read';
import type { RawSheet, RawWorkbook } from '@/lib/excel/types';
import { cleanupDir, extractExcelFromZip, ZipExtractionError } from '@/lib/excel/zip';
import {
  applyManualColumns,
  applyTemplate,
  matchTemplate,
  type TemplateMapping,
} from '@/lib/mapping/template-matcher';
import { normalizeSheet } from '@/lib/normalize';
import type { NormalizeContext } from '@/lib/normalize/context';
import { detectGlReportDate } from '@/lib/normalize/general-ledger';
import {
  datasetCount,
  emptyDataset,
  mergeDatasets,
  type ImportIssue,
  type NormalizedDataset,
  type ProjectMatch,
  type SheetDetection,
} from '@/lib/types';

/**
 * The import pipeline (requirement 3).
 *
 * Runs: validate type → expand ZIP → read workbook → detect sheets → map →
 * normalize. Calculation, snapshotting and comparison happen afterwards, in
 * the persistence layer, so this stage stays pure and re-runnable.
 *
 * A failure is always scoped as tightly as possible: a bad cell degrades to a
 * warning, a bad sheet degrades to a skipped sheet, and only an unreadable
 * file fails that file. One broken file never fails the whole import.
 */

export type ImportStage =
  | 'uploading'
  | 'reading_workbook'
  | 'detecting_sheets'
  | 'mapping_data'
  | 'calculating'
  | 'validating'
  | 'completed'
  | 'failed';

export const STAGE_LABELS: Record<ImportStage, string> = {
  uploading: 'Uploading',
  reading_workbook: 'Reading workbook',
  detecting_sheets: 'Detecting sheets',
  mapping_data: 'Mapping data',
  calculating: 'Calculating',
  validating: 'Validating',
  completed: 'Completed',
  failed: 'Failed',
};

export interface SheetOverride {
  sheetName: string;
  reportType?: SheetDetection['reportType'];
  headerRow?: number;
  columns?: { field: CanonicalField; columnIndex: number }[];
  /** Set false to leave a sheet out of the import entirely. */
  include?: boolean;
  /**
   * Company this sheet belongs to, when it differs from the file's.
   *
   * A cash-flow workbook often carries one sheet per company under names that
   * say nothing about which — "Cashflow 2026", "Sheet1". Without this the whole
   * file has to take a single company, and a multi-company workbook can only be
   * imported by splitting it by hand first. Explicit null means "no company",
   * which is different from leaving it undefined (inherit the file's).
   */
  projectId?: string | null;
}

export interface FileOverride {
  fileName: string;
  projectId?: string | null;
  reportDate?: string;
  sheets?: SheetOverride[];
}

export interface UploadedFile {
  /** Path of the stored original. Never written to after upload. */
  filePath: string;
  fileName: string;
  size: number;
  hash: string;
  /** Set when this file came out of a ZIP. */
  containerFile?: string;
}

export interface ParsedFileResult {
  fileName: string;
  originalName: string;
  containerFile: string | null;
  filePath: string;
  hash: string;
  size: number;
  fileType: string;
  project: ProjectMatch;
  reportDate: string;
  reportType: SheetDetection['reportType'];
  reportTypeLabel: string;
  sheetCount: number;
  sheets: SheetDetection[];
  data: NormalizedDataset;
  rowCount: number;
  issues: ImportIssue[];
  status: 'parsed' | 'failed';
  error: string | null;
  /**
   * In-memory only. Held so the persistence step can store a sample of raw
   * rows for the Data Inspector; deliberately never written into the preview
   * payload, which would balloon it.
   */
  rawSheets?: RawSheet[];
}

export interface PipelineOptions {
  resolver: ProjectResolver;
  templates: TemplateMapping[];
  /** Fallback report date when a file does not declare one. */
  defaultReportDate: string;
  overrides?: FileOverride[];
  onProgress?: (stage: ImportStage, detail: string) => void;
}

/** SHA-256 of the file bytes, used for duplicate detection (requirement 29). */
export function hashBuffer(buffer: Buffer | Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Expands any ZIPs in the upload set into the flat list of workbooks to parse.
 *
 * `destRoot` must outlive the preview step, because confirming an import
 * re-parses the same extracted files with the user's overrides applied.
 */
export async function expandUploads(
  uploads: UploadedFile[],
  destRoot?: string,
): Promise<{ files: UploadedFile[]; tempDirs: string[]; issues: ImportIssue[] }> {
  const files: UploadedFile[] = [];
  const tempDirs: string[] = [];
  const issues: ImportIssue[] = [];

  /**
   * File names must be unique across one import.
   *
   * They are the key that ties a record's source reference back to the file
   * row it came from, and two archives — or two folders inside one archive —
   * routinely hold a "Report.xlsx" each. Colliding names attributed one file's
   * cells to the other file's row, so a second occurrence is qualified by
   * where it came from and stays distinguishable on screen too.
   */
  const taken = new Set<string>();
  const uniqueName = (name: string, within?: string) => {
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
    const qualified = within ? `${within} › ${name}` : name;
    let candidate = qualified;
    let n = 2;
    while (taken.has(candidate)) {
      candidate = `${qualified} (${n})`;
      n += 1;
    }
    taken.add(candidate);
    return candidate;
  };

  for (const upload of uploads) {
    if (!isZipFile(upload.fileName)) {
      if (isExcelFile(upload.fileName)) {
        files.push({ ...upload, fileName: uniqueName(upload.fileName) });
      } else {
        issues.push({
          severity: 'error',
          code: 'UNSUPPORTED_FILE_TYPE',
          message: `"${upload.fileName}" is not an Excel or ZIP file and was skipped.`,
          source: { file: upload.fileName },
        });
      }
      continue;
    }

    const parent = destRoot ?? os.tmpdir();
    await fs.mkdir(parent, { recursive: true });
    const tempDir = await fs.mkdtemp(path.join(parent, 'zip-'));
    tempDirs.push(tempDir);

    try {
      const { files: extracted, skipped } = await extractExcelFromZip(upload.filePath, tempDir);

      if (extracted.length === 0) {
        issues.push({
          severity: 'error',
          code: 'EMPTY_ARCHIVE',
          message: `"${upload.fileName}" contains no Excel files.`,
          source: { file: upload.fileName },
        });
      }

      for (const skippedName of skipped) {
        issues.push({
          severity: 'info',
          code: 'ARCHIVE_ENTRY_SKIPPED',
          message: `"${skippedName}" inside ${upload.fileName} is not an Excel file and was skipped.`,
          source: { file: upload.fileName },
        });
      }

      for (const entry of extracted) {
        const buffer = await fs.readFile(entry.filePath);
        files.push({
          filePath: entry.filePath,
          // Qualified by the archive path when the plain name is already used.
          fileName: uniqueName(entry.fileName, path.dirname(entry.entryName).replace(/^\.$/, '')),
          size: entry.size,
          hash: hashBuffer(buffer),
          containerFile: upload.fileName,
        });
      }
    } catch (err) {
      issues.push({
        severity: 'error',
        code: err instanceof ZipExtractionError ? 'ARCHIVE_REJECTED' : 'ARCHIVE_UNREADABLE',
        message: `"${upload.fileName}" could not be expanded: ${(err as Error).message}`,
        source: { file: upload.fileName },
      });
    }
  }

  return { files, tempDirs, issues };
}

/** Parses and normalizes one workbook. Never throws — failures land in the result. */
export async function processFile(
  file: UploadedFile,
  options: PipelineOptions,
): Promise<ParsedFileResult> {
  const base: Omit<ParsedFileResult, 'status' | 'error'> = {
    fileName: file.fileName,
    originalName: file.fileName,
    containerFile: file.containerFile ?? null,
    filePath: file.filePath,
    hash: file.hash,
    size: file.size,
    fileType: fileExtension(file.fileName),
    project: unresolved(),
    reportDate: options.defaultReportDate,
    reportType: 'unknown',
    reportTypeLabel: REPORT_TYPE_LABELS.unknown,
    sheetCount: 0,
    sheets: [],
    data: emptyDataset(),
    rowCount: 0,
    issues: [],
  };

  let workbook: RawWorkbook;
  options.onProgress?.('reading_workbook', file.fileName);

  try {
    workbook = await readWorkbook(file.filePath, file.fileName);
  } catch (err) {
    const message =
      err instanceof ExcelParseError
        ? err.message
        : `Unexpected error reading the workbook: ${(err as Error).message}`;
    return {
      ...base,
      status: 'failed',
      error: message,
      issues: [
        {
          severity: 'error',
          code: 'WORKBOOK_UNREADABLE',
          message,
          source: { file: file.fileName },
        },
      ],
    };
  }

  const issues: ImportIssue[] = workbook.warnings.map((w) => ({
    severity: 'warning' as const,
    code: w.code,
    message: w.message,
    source: { file: file.fileName, sheet: w.sheet },
  }));

  const override = options.overrides?.find((o) => o.fileName === file.fileName);

  // ------------------------------------------------------ detect the project
  options.onProgress?.('detecting_sheets', file.fileName);

  const sheetNames = workbook.sheets.map((s) => s.name);
  const sampleText = workbook.sheets.flatMap((s) => topLeftText(s));

  let project: ProjectMatch;
  if (override?.projectId !== undefined) {
    const chosen = override.projectId ? options.resolver.byId(override.projectId) : null;
    project = chosen
      ? {
          projectId: chosen.id,
          projectCode: chosen.code,
          projectName: chosen.name,
          matchedAlias: null,
          matchedIn: 'manual',
          confidence: 1,
        }
      : unresolved();
  } else {
    project = options.resolver.resolveFile(
      file.containerFile ? `${file.containerFile} ${file.fileName}` : file.fileName,
      sheetNames,
      sampleText,
    );
  }

  if (!project.projectId) {
    issues.push({
      severity: 'warning',
      code: 'UNKNOWN_PROJECT',
      message:
        `No project alias matched "${file.fileName}". Its data was imported without a project — ` +
        'assign one in the preview, or add the spelling under Settings → Projects.',
      source: { file: file.fileName },
    });
  }

  // -------------------------------------------------------- detect the date
  const reportDate =
    override?.reportDate ?? detectReportDate(workbook, file.fileName) ?? options.defaultReportDate;

  // ----------------------------------------------- classify and map sheets
  options.onProgress?.('mapping_data', file.fileName);

  const detections: SheetDetection[] = [];
  let data = emptyDataset();

  // Only the sheets that reached normalization count towards completeness; a
  // sheet skipped on purpose is not a sheet that failed.
  const emptySheetNames: string[] = [];
  let normalizedSheetCount = 0;

  for (const sheet of workbook.sheets) {
    const sheetOverride = override?.sheets?.find((s) => s.sheetName === sheet.name);
    if (sheetOverride?.include === false) continue;

    let detection: SheetDetection;
    try {
      detection = classifySheet(sheet);
    } catch (err) {
      issues.push({
        severity: 'warning',
        code: 'SHEET_CLASSIFY_FAILED',
        message: `Sheet "${sheet.name}" could not be analysed: ${(err as Error).message}`,
        source: { file: file.fileName, sheet: sheet.name },
      });
      continue;
    }

    // Templates fill gaps that header detection left open.
    const template = matchTemplate(options.templates, file.fileName, sheet, detection);
    if (template) detection = applyTemplate(detection, template, sheet);

    // Manual choices from the preview screen win over everything.
    if (sheetOverride?.headerRow !== undefined) {
      detection = { ...detection, headerRow: sheetOverride.headerRow };
    }
    if (sheetOverride?.reportType) {
      detection = { ...detection, reportType: sheetOverride.reportType, confidence: 1 };
    }
    if (sheetOverride?.columns?.length) {
      detection = applyManualColumns(detection, sheetOverride.columns, sheet);
    }

    detections.push(detection);

    // A DATA_* feed sheet duplicates figures presented elsewhere; classifying
    // it is useful for the inspector, importing it would double-count.
    if (isDataFeedSheet(sheet.name) && !sheetOverride?.reportType) {
      issues.push({
        severity: 'info',
        code: 'DATA_FEED_SHEET',
        message: `Sheet "${sheet.name}" looks like a data feed for another sheet and was not imported. Override it in the preview to include it.`,
        source: { file: file.fileName, sheet: sheet.name },
      });
      continue;
    }

    if (detection.headerRow === null && detection.reportType === 'unknown') {
      issues.push({
        severity: 'info',
        code: 'SHEET_NOT_RECOGNISED',
        message: `Sheet "${sheet.name}" has no recognisable header row and was not imported.`,
        source: { file: file.fileName, sheet: sheet.name },
      });
      continue;
    }

    // A sheet may name its own company, which then wins over the file's. Rows
    // that carry a company of their own still win over both — this only sets
    // what a row falls back to.
    const sheetProject =
      sheetOverride?.projectId === undefined
        ? null
        : sheetOverride.projectId
          ? options.resolver.byId(sheetOverride.projectId) ?? null
          : null;
    const sheetProjectChosen = sheetOverride?.projectId !== undefined;

    const ctx: NormalizeContext = {
      fileName: file.fileName,
      sheet,
      detection,
      resolver: options.resolver,
      defaultProjectId: sheetProjectChosen ? (sheetProject?.id ?? null) : project.projectId,
      defaultProjectLabel: sheetProjectChosen
        ? (sheetProject?.name ?? null)
        : (project.projectName ?? project.matchedAlias),
      reportDate,
      addIssue: (issue) => issues.push(issue),
    };

    normalizedSheetCount += 1;

    try {
      const sheetData = normalizeSheet(ctx);
      detection.parsedCount = datasetCount(sheetData);
      data = mergeDatasets(data, sheetData);

      // A sheet the importer recognised, with rows in it, that yielded nothing
      // is the failure most likely to go unnoticed: the import succeeds, the
      // dashboard moves, and figures are quietly missing. The sheets it was
      // never going to import — a data feed, an unrecognised layout — say so
      // above and are not repeated here.
      if (detection.parsedCount === 0 && detection.rowCount > 0) {
        emptySheetNames.push(sheet.name);
        issues.push({
          severity: 'warning',
          code: 'SHEET_NO_RECORDS',
          message:
            `Sheet "${sheet.name}" was read as ${REPORT_TYPE_LABELS[detection.reportType]} and has ` +
            `${detection.rowCount} rows, but produced no records — nothing from it reached the ` +
            'dashboard. Check the report type and the mapped columns in the preview.',
          source: { file: file.fileName, sheet: sheet.name },
        });
      }
    } catch (err) {
      issues.push({
        severity: 'error',
        code: 'SHEET_IMPORT_FAILED',
        message: `Sheet "${sheet.name}" could not be imported: ${(err as Error).message}`,
        source: { file: file.fileName, sheet: sheet.name },
      });
    }
  }

  // Counted across the file rather than left as one line per sheet, so "11 of
  // 30 sheets brought nothing" is visible at a glance instead of having to be
  // assembled from eleven separate warnings. Built from the sheets that were
  // actually normalized, so the ones deliberately skipped above are not
  // reported as losses.
  if (emptySheetNames.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'FILE_INCOMPLETE',
      message:
        `${emptySheetNames.length} of ${normalizedSheetCount} imported sheets produced no records: ` +
        `${emptySheetNames.map((name) => `"${name}"`).join(', ')}. Everything else in the file ` +
        'imported normally.',
      source: { file: file.fileName },
    });
  }

  const dominant = dominantReportType(detections);

  return {
    ...base,
    project,
    reportDate,
    reportType: dominant,
    reportTypeLabel: REPORT_TYPE_LABELS[dominant],
    sheetCount: workbook.sheets.length,
    sheets: detections,
    data,
    rowCount: datasetCount(data),
    issues,
    status: 'parsed',
    error: null,
    rawSheets: workbook.sheets,
  };
}

/** Runs the whole set, sequentially so one huge file cannot starve the others. */
export async function processFiles(
  files: UploadedFile[],
  options: PipelineOptions,
): Promise<ParsedFileResult[]> {
  const results: ParsedFileResult[] = [];
  for (const file of files) {
    results.push(await processFile(file, options));
  }
  return results;
}

/** The report type that produced the most records — what the file "is". */
function dominantReportType(detections: SheetDetection[]): SheetDetection['reportType'] {
  const byType = new Map<SheetDetection['reportType'], number>();
  for (const detection of detections) {
    if (detection.reportType === 'unknown') continue;
    byType.set(detection.reportType, (byType.get(detection.reportType) ?? 0) + detection.parsedCount);
  }

  let winner: SheetDetection['reportType'] = 'unknown';
  let best = -1;
  for (const [type, count] of byType) {
    if (count > best) {
      best = count;
      winner = type;
    }
  }

  // Nothing parsed: fall back to the most confident classification.
  if (best <= 0 && detections.length > 0) {
    const top = [...detections].sort((a, b) => b.confidence - a.confidence)[0];
    return top.reportType;
  }
  return winner;
}

/**
 * Finds the report date, preferring an explicit "as of" label inside the
 * workbook over a date embedded in the file name.
 */
export function detectReportDate(workbook: RawWorkbook, fileName: string): string | null {
  // A reporting PERIOD beats everything: "Date : 01/01/2026 - 31/08/2026"
  // means the data runs to 31 August, whatever the print timestamp says.
  const preamble = workbook.sheets.slice(0, 5).flatMap((sheet) => topLeftText(sheet));
  const periodEnd = detectGlReportDate(preamble);
  if (periodEnd) return periodEnd;

  for (const sheet of workbook.sheets.slice(0, 5)) {
    const rows = Math.min(sheet.rowCount, 15);
    const cols = Math.min(sheet.colCount, 15);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const text = cellText(getCell(sheet, r, c));
        if (!text || text.length > 60) continue;
        // "Report Date : 12/08/2026 09:37:15" on a GL export is the moment the
        // report was printed, not the period it covers, so it is skipped.
        if (/\d{1,2}:\d{2}(:\d{2})?/.test(text)) continue;
        if (!/as of|ณ วันที่|ข้อมูล ณ|report date|as at/i.test(text)) continue;

        // The date may be inside the same cell or in the next one along.
        const inline = parseDateText(text.replace(/^.*?(as of|as at|ณ วันที่|ข้อมูล ณ|report date)/i, '').trim());
        if (inline) return endOfMonthIfMonthOnly(inline, text);

        const neighbour = cellText(getCell(sheet, r, c + 1));
        const parsed = neighbour ? parseDateText(neighbour) : null;
        if (parsed) return endOfMonthIfMonthOnly(parsed, neighbour);
      }
    }
  }

  // Fall back to a date in the file name: "Financial Report 2026-08-31.xlsx".
  const fromName = /(\d{4}[-_.]\d{1,2}(?:[-_.]\d{1,2})?)/.exec(fileName);
  if (fromName) {
    const parsed = parseDateText(fromName[1].replace(/[_.]/g, '-'));
    if (parsed) return endOfMonthIfMonthOnly(parsed, fromName[1]);
  }

  return null;
}

/** A month with no day means the month end — the usual finance convention. */
function endOfMonthIfMonthOnly(iso: string, source: string): string {
  const hasDay = /\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}-\d{2}-\d{2}/.test(source);
  return hasDay ? iso : endOfMonth(iso);
}

/** Text from the top-left corner of a sheet, where titles live. */
function topLeftText(sheet: RawSheet): string[] {
  const out: string[] = [];
  const rows = Math.min(sheet.rowCount, 8);
  const cols = Math.min(sheet.colCount, 8);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const text = cellText(getCell(sheet, r, c));
      if (text && text.length <= 80) out.push(text);
    }
  }
  return out;
}

export { cleanupDir };
