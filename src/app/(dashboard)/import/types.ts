import type { ReportType } from '@/config/detection-rules';
import type { CanonicalField } from '@/config/field-synonyms';
import type { ColumnMapping, ImportIssue, ProjectMatch } from '@/lib/types';
import type { DuplicateMatch } from '@/lib/db/repositories/imports';

/** Shapes exchanged between the import UI and the upload/confirm endpoints. */

export interface PreviewSheet {
  sheetName: string;
  reportType: ReportType;
  reportTypeLabel: string;
  confidence: number;
  headerRow: number | null;
  parsedCount: number;
  rowCount: number;
  templateName: string | null;
  headers: string[];
  columns: ColumnMapping[];
}

export interface PreviewFile {
  fileName: string;
  containerFile: string | null;
  fileType: string;
  size: number;
  status: 'parsed' | 'failed';
  error: string | null;
  reportDate: string;
  reportType: ReportType;
  reportTypeLabel: string;
  project: ProjectMatch;
  sheetCount: number;
  rowCount: number;
  warningCount: number;
  errorCount: number;
  issues: ImportIssue[];
  recordCounts: Record<string, number>;
  sheets: PreviewSheet[];
}

export interface PreviewResponse {
  previewId: string;
  reportDate: string;
  rejected: { fileName: string; reason: string }[];
  archiveIssues: ImportIssue[];
  duplicates: DuplicateMatch[];
  files: PreviewFile[];
  projects: { id: string; name: string; company: string | null }[];
}

/** A user's correction to what the importer detected, applied at confirm time. */
export interface SheetOverridePayload {
  sheetName: string;
  reportType?: ReportType;
  headerRow?: number;
  columns?: { field: CanonicalField; columnIndex: number }[];
  include?: boolean;
}

export interface FileOverridePayload {
  fileName: string;
  projectId?: string | null;
  reportDate?: string;
  sheets?: SheetOverridePayload[];
}

export interface ConfirmPayload {
  label: string;
  mode: 'new' | 'replace';
  overrides: FileOverridePayload[];
}
