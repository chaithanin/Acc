/**
 * Whether a report date is one a financial report could carry.
 *
 * A live database was found holding snapshots dated 4710-05-31 and
 * 3389-07-31. The dashboard orders snapshots by report date, newest first, so
 * a snapshot dated in the year 4710 is the newest there will ever be: it is
 * chosen as the current one, and every real period sits behind it. Nothing
 * refused it, because every check on the way in looked at the shape of the date
 * and none at what it said — this is the one place that does, so every writer
 * (the upload, the pulls from Mango, a command-line import) passes through it.
 *
 * The window is deliberately generous at the top: a forecast filed against next
 * year is a real thing. It is not generous enough to admit a year that cannot
 * be a typo of this one.
 */

/** Before this a report is not from this business. */
export const EARLIEST_REPORT_YEAR = 2000;

/** Why a date is not acceptable, in words for the person who supplied it; null when it is. */
export function reportDateProblem(iso: string, now: Date = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return `"${iso}" is not a date in the form YYYY-MM-DD.`;
  }

  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const real = new Date(Date.UTC(y, m - 1, d));
  if (real.getUTCFullYear() !== y || real.getUTCMonth() !== m - 1 || real.getUTCDate() !== d) {
    return `${iso} is not a real calendar date.`;
  }

  const latest = now.getUTCFullYear() + 1;
  if (y < EARLIEST_REPORT_YEAR || y > latest) {
    return (
      `${iso} cannot be the date of a report: the year is ${y}, and a report here is dated ` +
      `between ${EARLIEST_REPORT_YEAR} and ${latest}. A year like this is usually a Buddhist-era ` +
      'year (2569, which is 2026) read as if it were a Gregorian one, or a cell that is not a date.'
    );
  }
  return null;
}
