/**
 * The look of the workbook.
 *
 * Every value here was read off `Interest-Advance received_SUN9` rather than
 * chosen: the accountants who use this file know it by its colours, and a
 * report that arrives looking like a different document gets checked from
 * scratch instead of read.
 */

export const FONT = { name: 'Calibri', size: 11 };

export const COLOR = {
  /** Identity columns of every header row. */
  headerIdentity: 'FF002060',
  /** The instalment-plan months. */
  headerPlan: 'FF7030A0',
  /** The months of cash actually received. */
  headerPaid: 'FF006666',
  /** The band naming the table. */
  bandTitle: 'FF00B050',
  /** The expected-selling-price column, which is derived rather than entered. */
  derived: 'FFDDFFFF',
  headerText: 'FFFFFFFF',
} as const;

/**
 * Accounting format, no decimals — what the template uses for every money
 * column. A zero prints as "-", which is how a blank month is meant to read.
 */
export const MONEY = '_(* #,##0_);_(* (#,##0);_(* "-"??_);_(@_)';
export const MONEY_2DP = '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)';
export const DATE = 'd-mmm-yy';
export const PERCENT = '0.00%';
export const PERCENT_FINE = '0.00000%';

export const THIN_BOX = {
  left: { style: 'thin' as const },
  right: { style: 'thin' as const },
  top: { style: 'thin' as const },
  bottom: { style: 'hair' as const },
};

export const DATA_BOX = {
  left: { style: 'thin' as const },
  right: { style: 'thin' as const },
  top: { style: 'hair' as const },
  bottom: { style: 'hair' as const },
};
