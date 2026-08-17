/**
 * Raw workbook shape produced by the parsing worker.
 *
 * This is the "Raw Imported Data" layer (requirement 34): a faithful,
 * loss-tolerant picture of what the file contains, with zero business meaning
 * attached. Nothing downstream may mutate it.
 */

export type RawCellType = 'n' | 's' | 'b' | 'd' | 'e' | 'z';

export interface RawCell {
  /** Raw value. Numbers stay numbers; dates arrive as ISO strings. */
  v: string | number | boolean | null;
  t: RawCellType;
  /** Formula text, when the cell is a formula. */
  f?: string;
  /** Formatted (displayed) text as Excel would render it. */
  w?: string;
  /** Number format code. */
  z?: string;
}

export interface RawSheet {
  name: string;
  index: number;
  ref: string | null;
  /** 0-based worksheet coordinates of rows[0][0], so addresses can be rebuilt. */
  originRow: number;
  originCol: number;
  rowCount: number;
  colCount: number;
  /** rows[r][c]; a blank row is an empty array. */
  rows: (RawCell | null)[][];
  truncated: boolean;
}

export interface RawWorkbookWarning {
  code: string;
  message: string;
  sheet: string | null;
}

export interface RawWorkbook {
  fileName: string;
  sheetCount: number;
  sheets: RawSheet[];
  warnings: RawWorkbookWarning[];
}

/** A precise pointer back into the source file (requirement 18). */
export interface SourceRef {
  file: string;
  sheet: string | null;
  /** 1-based Excel row number, as shown in the Excel UI. */
  row: number | null;
  /** 1-based Excel column number. */
  col: number | null;
  /** Excel-style address, e.g. "D17". */
  cell: string | null;
}
