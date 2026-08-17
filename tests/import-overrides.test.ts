import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import * as XLSX from 'xlsx';

import { ProjectResolver } from '@/lib/detect/project-resolver';
import { processFile } from '@/lib/import/pipeline';
import { TEST_PROJECTS } from './helpers';

/**
 * Per-sheet company assignment.
 *
 * A cash-flow workbook routinely holds one sheet per company under names that
 * say nothing about which — "Cashflow 2026", "Sheet1". Without a per-sheet
 * choice such a file can only be imported by splitting it by hand first, and
 * every figure in it lands under one company.
 */

const resolver = new ProjectResolver(TEST_PROJECTS);

/** A month-per-column cash-flow statement, the shape the real reports use. */
function cashflowGrid(): (string | number)[][] {
  const months = ['', 'Jan', 'Feb', 'Mar', 'Apr'];
  return [
    ['INFLOW (Month / 2026)'],
    months,
    ['1.2 Operating Income', 500_000, 600_000, 400_000, 550_000],
    ['4. Total Cash Inflow (1+2+3)', 500_000, 600_000, 400_000, 550_000],
    ['OUTFLOW (Month / 2026)'],
    months,
    ['5.1 Operating Expense', 300_000, 300_000, 450_000, 350_000],
    ['8. Total Cash Outflow (5+6+7)', 300_000, 300_000, 450_000, 350_000],
    ['CASH BALANCE (Month / 2026)'],
    months,
    ['9. Cash at Bank Bal b/f', 1_000_000, 1_200_000, 1_500_000, 1_450_000],
    ['10. Net Cash In-Out', 200_000, 300_000, -50_000, 200_000],
    ['11. Total Cash at Bank Bal c/f', 1_200_000, 1_500_000, 1_450_000, 1_650_000],
  ];
}

let dir: string;
let file: string;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtg-overrides-'));
  file = path.join(dir, 'Cashflow_Report_2026.xlsx');

  // Two sheets, neither naming a company — exactly the case the feature is for.
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(cashflowGrid()), 'Cashflow 2026');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(cashflowGrid()), 'Cashflow 2026 (2)');
  XLSX.writeFile(book, file);
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function upload() {
  const bytes = fs.readFileSync(file);
  return {
    filePath: file,
    fileName: path.basename(file),
    size: bytes.length,
    hash: createHash('sha256').update(bytes).digest('hex'),
  };
}

const options = { resolver, templates: [], defaultReportDate: '2026-08-31' };

/**
 * The report type is stated rather than left to detection. A month-per-column
 * statement puts month names in its header row, so the words that identify a
 * cash-flow sheet sit in the row labels instead — which is exactly why the
 * preview lets the type be corrected. These tests are about the company
 * assignment, so the type is pinned to keep one from masking the other.
 */
const sheetOverride = (sheetName: string, projectId?: string) => ({
  sheetName,
  reportType: 'cashflow' as const,
  ...(projectId ? { projectId } : {}),
});

describe('per-sheet company assignment', () => {
  it('splits one workbook across two companies', async () => {
    const result = await processFile(upload(), {
      ...options,
      overrides: [
        {
          fileName: 'Cashflow_Report_2026.xlsx',
          sheets: [
            sheetOverride('Cashflow 2026', 'p-hamonia'),
            sheetOverride('Cashflow 2026 (2)', 'p-marina'),
          ],
        },
      ],
    });

    const bySheet = new Map<string, Set<string | null>>();
    for (const row of result.data.cashflow) {
      const sheet = row.sourceRef.sheet ?? '(no sheet)';
      if (!bySheet.has(sheet)) bySheet.set(sheet, new Set());
      bySheet.get(sheet)!.add(row.projectId);
    }

    assert.deepEqual([...(bySheet.get('Cashflow 2026') ?? [])], ['p-hamonia']);
    assert.deepEqual([...(bySheet.get('Cashflow 2026 (2)') ?? [])], ['p-marina']);
  });

  it('leaves sheets without a choice on the file’s company', async () => {
    const result = await processFile(upload(), {
      ...options,
      overrides: [
        {
          fileName: 'Cashflow_Report_2026.xlsx',
          projectId: 'p-hamonia',
          sheets: [
            sheetOverride('Cashflow 2026'),
            sheetOverride('Cashflow 2026 (2)', 'p-marina'),
          ],
        },
      ],
    });

    const projects = new Set(
      result.data.cashflow
        .filter((row) => row.sourceRef.sheet === 'Cashflow 2026')
        .map((row) => row.projectId),
    );

    assert.deepEqual([...projects], ['p-hamonia']);
  });

  it('reads every month of both sheets', async () => {
    const result = await processFile(upload(), {
      ...options,
      overrides: [
        {
          fileName: 'Cashflow_Report_2026.xlsx',
          sheets: [sheetOverride('Cashflow 2026'), sheetOverride('Cashflow 2026 (2)')],
        },
      ],
    });

    // Four months per sheet, so a reader that silently dropped one would show
    // up here rather than as a quietly smaller total.
    assert.equal(result.data.cashflow.length, 8);
    assert.deepEqual(
      [...new Set(result.data.cashflow.map((r) => r.month))].sort(),
      ['2026-01', '2026-02', '2026-03', '2026-04'],
    );
  });
});
