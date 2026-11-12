import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { parseDateCell, parseDateText } from '@/lib/excel/cells';
import { detectReportDate } from '@/lib/import/pipeline';
import { reportDateProblem } from '@/lib/import/report-date';

/**
 * A live database held snapshots dated 4710-05-31 and 3389-07-31.
 *
 * The dashboard orders snapshots by report date, newest first, so the one dated
 * 4710 is the newest there will ever be: it is the current snapshot, and every
 * real period sits behind it. Every check on the way in looked at the SHAPE of
 * a date; none looked at what it said.
 */

const NOW = new Date('2026-11-12T00:00:00Z');

describe('which report dates are acceptable', () => {
  it('accepts the date of an ordinary month-end report', () => {
    assert.equal(reportDateProblem('2026-08-31', NOW), null);
    assert.equal(reportDateProblem('2025-12-31', NOW), null);
  });

  it('accepts next year, because a forecast filed against it is a real thing', () => {
    assert.equal(reportDateProblem('2027-06-30', NOW), null);
  });

  it('refuses the two dates that were found in a live database', () => {
    for (const bad of ['4710-05-31', '3389-07-31']) {
      const why = reportDateProblem(bad, NOW);
      assert.ok(why, `${bad} was accepted`);
      assert.match(why!, /cannot be the date of a report/);
    }
  });

  it('says what it usually is, so the person can fix the file rather than guess', () => {
    assert.match(reportDateProblem('2569-05-31', NOW)!, /Buddhist-era year \(2569, which is 2026\)/);
  });

  it('refuses a year too far in either direction', () => {
    assert.ok(reportDateProblem('1999-12-31', NOW), 'a date before 2000 was accepted');
    assert.ok(reportDateProblem('2028-01-01', NOW), 'a date two years ahead was accepted');
  });

  it('refuses what is not a date at all', () => {
    assert.ok(reportDateProblem('2026-02-30', NOW), 'the 30th of February was accepted');
    assert.ok(reportDateProblem('31/08/2026', NOW), 'a day-first date was accepted');
    assert.ok(reportDateProblem('', NOW));
  });
});

describe('reading a date out of a workbook', () => {
  /**
   * Buddhist-era years arrive three ways: as text with slashes (always handled),
   * as an ISO string, and as a date cell the workbook stored as if 2569 were a
   * Gregorian year. The last two were not normalised, so 2569-05-31 was filed in
   * the year 2569.
   */
  it('reads a Buddhist-era year as the Gregorian one it means, in every format', () => {
    assert.equal(parseDateText('31/05/2569'), '2026-05-31');
    assert.equal(parseDateText('2569-05-31'), '2026-05-31');
    assert.equal(parseDateCell({ t: 'd', v: '2569-05-31T00:00:00.000Z' } as never), '2026-05-31');
  });

  it('leaves an ordinary Gregorian date alone', () => {
    assert.equal(parseDateText('2026-05-31'), '2026-05-31');
    assert.equal(parseDateText('31/05/2026'), '2026-05-31');
    assert.equal(parseDateCell({ t: 'd', v: '2026-05-31T00:00:00.000Z' } as never), '2026-05-31');
  });

  it('does not make a date of a year no report can have', () => {
    assert.equal(parseDateText('4710-05-31'), null);
    assert.equal(parseDateText('31/05/4710'), null);
    assert.equal(parseDateText('May 4710'), null);
    assert.equal(parseDateCell({ t: 'd', v: '3389-07-31T00:00:00.000Z' } as never), null);
  });
});

describe('the writer, which every route in passes through', () => {
  /**
   * The check is in persistImport itself rather than in each caller, because
   * the callers are the upload, the pulls from Mango and a command-line import,
   * and one of them forgetting is how this got in. It throws before anything
   * is written, so no database is needed to see it refuse.
   */
  it('refuses to file a report under an impossible date', async () => {
    process.env.GTG_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gtg-report-date-'));
    const imports = await import('@/lib/db/repositories/imports');

    for (const reportDate of ['4710-05-31', '3389-07-31', '1999-01-31', '2026-13-01']) {
      assert.throws(
        () =>
          imports.persistImport({
            companyId: 'any', reportDate, label: null, userId: null, files: [], issues: [], mode: 'new',
          }),
        /report|date/i,
        `${reportDate} was filed`,
      );
    }
  });
});

describe('a date in a file name', () => {
  /**
   * The cause of the two dates found in the live database, reproduced with the
   * file names the audit printed. Mango names its exports with a fourteen-digit
   * timestamp and a hash. The last four digits of the timestamp and the first
   * of the hash looked like "year 5253, month 5"; Buddhist-era normalisation
   * made that 4710, and the report was filed as 4710-05-31.
   */
  const noContent = { sheets: [] } as never;

  it('does not read a year out of the middle of a longer run of digits', () => {
    assert.equal(detectReportDate(noContent, '20260826105253_5d3c120433.xlsx'), null);
    assert.equal(detectReportDate(noContent, '20260826113932_7f86357f7b.xlsx'), null);
  });

  /**
   * The year ceiling alone would also turn the two real names into null, so
   * they do not show that the pattern itself is fixed. This is one that would
   * pass the ceiling: a reference number whose last four digits happen to be a
   * plausible year, followed by what looks like a month.
   */
  it('does not take a plausible year off the end of a reference number either', () => {
    assert.equal(detectReportDate(noContent, 'ref12026_8.xlsx'), null);
    assert.equal(detectReportDate(noContent, 'INV9202608-14.xlsx'), null);
  });

  it('still reads a date that stands alone', () => {
    assert.equal(detectReportDate(noContent, 'Financial Report 2026-08-31.xlsx'), '2026-08-31');
    assert.equal(detectReportDate(noContent, 'Hamonia_Report_2026-08.xlsx'), '2026-08-31');
    assert.equal(detectReportDate(noContent, 'GL.2026.08.31.xlsx'), '2026-08-31');
  });
});
