import {
  CLASSIFICATION_THRESHOLD,
  DATA_SHEET_PREFIXES,
  SHEET_RULES,
  type ReportType,
} from '@/config/detection-rules';
import { cellText, getCell } from '@/lib/excel/cells';
import type { RawSheet } from '@/lib/excel/types';
import type { SheetDetection } from '@/lib/types';
import { detectHeaders } from './header-detector';
import { containsPhrase, normalizeText } from './normalize-text';

/**
 * Classifies a sheet by combining three independent signals:
 *
 *   1. the sheet NAME (weak on its own — sheets get renamed),
 *   2. the HEADER TEXTS actually present in the sheet,
 *   3. which CANONICAL FIELDS the header mapper managed to resolve.
 *
 * Sheet position is deliberately not an input (requirement 4).
 */

/** Rows scanned for stray header keywords that sit outside the header row. */
const KEYWORD_SCAN_ROWS = 40;

export function classifySheet(sheet: RawSheet): SheetDetection {
  const header = detectHeaders(sheet);
  const sheetName = sheet.name;
  const surfaceText = collectSurfaceText(sheet);

  const scores = SHEET_RULES.map((rule) => {
    let score = 0;

    // (1) Sheet name signal.
    for (const pattern of rule.namePatterns) {
      if (containsPhrase(sheetName, pattern)) {
        // Longer patterns are more specific and worth more.
        score += 0.6 + Math.min(0.4, pattern.length / 40);
      }
    }

    // (2) Header keyword signal, from the detected header row and nearby text.
    let keywordHits = 0;
    for (const keyword of rule.headerKeywords) {
      const inHeaders = header.headers.some((h) => containsPhrase(h, keyword));
      const inSurface = surfaceText.some((t) => containsPhrase(t, keyword));
      if (inHeaders) keywordHits += 1;
      else if (inSurface) keywordHits += 0.4;
    }
    score += Math.min(2.5, keywordHits * 0.45);

    // (3) Signature fields — the strongest evidence, because these were
    // resolved by the mapper rather than merely spotted as text.
    if (rule.signatureFields.length > 0) {
      const present = rule.signatureFields.filter((f) =>
        header.columns.some((c) => c.field === f),
      ).length;
      const ratio = present / rule.signatureFields.length;
      score += ratio * 2.2;
      // Every signature field present is close to proof.
      if (ratio === 1) score += 0.6;
    }

    return { type: rule.type, score: Number((score * rule.weight).toFixed(3)) };
  }).sort((a, b) => b.score - a.score);

  const winner = scores[0];
  const reportType: ReportType =
    winner && winner.score >= CLASSIFICATION_THRESHOLD ? winner.type : 'unknown';

  // Confidence is the margin over the runner-up, so a close call reads as low
  // confidence and gets surfaced for manual mapping.
  const runnerUp = scores[1]?.score ?? 0;
  const confidence =
    reportType === 'unknown'
      ? 0
      : Number(Math.min(1, (winner.score / (winner.score + runnerUp + 0.8))).toFixed(3));

  return {
    sheetName,
    sheetIndex: sheet.index,
    reportType,
    confidence,
    headerRow: header.headerRow,
    headers: header.headers,
    columns: header.columns,
    scores: scores.slice(0, 5),
    templateId: null,
    templateName: null,
    rowCount: sheet.rowCount,
    parsedCount: 0,
  };
}

/** Text from the top-left block of the sheet, where titles and labels live. */
function collectSurfaceText(sheet: RawSheet): string[] {
  const out: string[] = [];
  const rows = Math.min(sheet.rowCount, KEYWORD_SCAN_ROWS);
  const cols = Math.min(sheet.colCount, 30);
  for (let r = 0; r < rows; r += 1) {
    if (!sheet.rows[r] || sheet.rows[r].length === 0) continue;
    for (let c = 0; c < cols; c += 1) {
      const text = cellText(getCell(sheet, r, c));
      if (text && text.length <= 120) out.push(text);
    }
  }
  return out;
}

/** Sheets named DATA_* / RAW_* feed other sheets rather than standing alone. */
export function isDataFeedSheet(sheetName: string): boolean {
  const name = normalizeText(sheetName);
  return DATA_SHEET_PREFIXES.some((p) => name.startsWith(p));
}
