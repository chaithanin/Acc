import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import type { NormalizedDataset, SourceRef } from '@/lib/types';
import type { ParsedFileResult } from '@/lib/import/pipeline';

/**
 * The adversarial two-company test.
 *
 * Two companies are given data on the same report date — month-end is
 * month-end for both — and then every read is fired with the *other*
 * company's snapshot id, import id and project id. Nothing may come back.
 *
 * These are written against the repositories rather than the pages, because
 * that is where the boundary is. A page test would pass just as happily with
 * every company's records loaded and most of them filtered out in a component,
 * and the API routes hand these functions ids that arrived from a query string.
 *
 * The database module reads its directory at import time, so the environment is
 * set before anything is imported.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtg-isolation-'));
process.env.GTG_DATA_DIR = dir;

let companies: typeof import('@/lib/db/repositories/companies');
let projects: typeof import('@/lib/db/repositories/projects');
let imports: typeof import('@/lib/db/repositories/imports');
let snapshots: typeof import('@/lib/db/repositories/snapshots');
let drilldownRepo: typeof import('@/lib/db/repositories/drilldown');
let queries: typeof import('@/lib/dashboard/queries');
let db: typeof import('@/lib/db');

interface Party {
  companyId: string;
  projectId: string;
  importId: string;
  snapshotId: string;
}

let marina: Party;
let hamonia: Party;

/** Both companies file for the same date on purpose: it is the real case. */
const REPORT_DATE = '2026-08-31';

function ref(file: string, cell: string): SourceRef {
  return { file, sheet: 'Sheet1', row: 1, col: 1, cell };
}

/**
 * A dataset with a record in each table the dashboards read, so a leak in any
 * one of them shows up as a row rather than as a passing test.
 */
function dataset(projectId: string, file: string, amount: number): NormalizedDataset {
  const base = { projectId, projectLabel: null, sourceRef: ref(file, 'B2') };
  return {
    bank: [{ kind: 'bank', ...base, bankName: 'Test Bank', accountNo: '1', currentAmount: amount, pendingExpense: 0 }],
    // Two, so a limited drill-down genuinely has something left over.
    payable: [],
    receivable: [
      {
        kind: 'receivable', ...base, category: 'contract', customer: 'Buyer', unit: 'A-1',
        contractualAmount: amount, receiveAmount: 0, accrueAmount: amount, dueDate: null,
      },
      {
        kind: 'receivable', ...base, sourceRef: ref(file, 'B3'),
        category: 'contract', customer: 'Second Buyer', unit: 'A-2',
        contractualAmount: amount / 2, receiveAmount: 0, accrueAmount: amount / 2, dueDate: null,
      },
    ],
    income: [{
      kind: 'income', ...base, category: 'contract', description: 'Sale', month: '2026-08',
      contractualAmount: amount, receivedAmount: 0, accruedAmount: amount, isForecast: false,
    }],
    expense: [{
      kind: 'expense', ...base, category: 'construction', description: 'Build', month: '2026-08',
      amount, paidAmount: 0, pendingAmount: amount, isForecast: false,
    }],
    boq: [{
      kind: 'boq', ...base, accountCode: '5100', description: 'Structure', contractor: 'Contractor',
      costCategory: 'construction', month: '2026-08', boqAmount: amount, boqToDate: amount,
      paidAmount: 0, pendingAmount: amount,
    }],
    wip: [{
      kind: 'wip', ...base, accountCode: '1400', accountName: 'Work in progress',
      currentPeriod: amount, ytd: amount, advancePayment: amount, statedClosing: null,
    }],
    cashflow: [{
      kind: 'cashflow', ...base, month: '2026-08', openingBalance: amount,
      expectedIncome: amount, expectedExpense: 0, netCashflow: amount,
      closingBalance: amount * 2, isComputed: false,
    }],
    gl: [{
      kind: 'gl', ...base, accountCode: '1000', accountName: 'Cash', entryDate: '2026-08-01',
      voucherNo: 'JV-1', vendor: null, description: 'Opening', costCode: null, module: null,
      job: null, debit: amount, credit: 0, balance: amount, isOpeningBalance: true,
    }],
  };
}

function parsedFile(projectId: string, fileName: string, amount: number): ParsedFileResult {
  return {
    fileName,
    originalName: fileName,
    containerFile: null,
    filePath: `/tmp/${fileName}`,
    hash: `hash-${fileName}`,
    size: 1024,
    fileType: 'xlsx',
    project: {
      projectId,
      projectCode: 'P1',
      projectName: 'Project',
      matchedAlias: 'Project',
      matchedIn: 'manual',
      confidence: 1,
    },
    reportDate: REPORT_DATE,
    reportType: 'receivable',
    reportTypeLabel: 'Receivable',
    sheetCount: 1,
    sheets: [],
    data: dataset(projectId, fileName, amount),
    rowCount: 9,
    issues: [{
      severity: 'warning',
      code: 'test_issue',
      message: `Issue for ${fileName}`,
      source: { file: fileName, sheet: 'Sheet1', row: 1, cell: 'B2' },
    }],
    status: 'parsed',
    error: null,
  };
}

function seed(code: string, amount: number): Party {
  const companyId = companies.createCompany({ companyCode: code, legalName: `${code} Company` }).id;
  const project = projects.createProject({ code: `${code}-P1`, name: `${code} Project` });

  // `createProject` does not take a company yet, so the link is written here.
  db.getDb().prepare('UPDATE projects SET company_id = ? WHERE id = ?').run(companyId, project.id);

  const result = imports.persistImport({
    companyId,
    reportDate: REPORT_DATE,
    label: `${code} August`,
    userId: null,
    files: [parsedFile(project.id, `${code}.xlsx`, amount)],
    issues: [],
    mode: 'new',
  });

  return { companyId, projectId: project.id, importId: result.importId, snapshotId: result.snapshotId };
}

before(async () => {
  db = await import('@/lib/db');
  companies = await import('@/lib/db/repositories/companies');
  projects = await import('@/lib/db/repositories/projects');
  imports = await import('@/lib/db/repositories/imports');
  snapshots = await import('@/lib/db/repositories/snapshots');
  drilldownRepo = await import('@/lib/db/repositories/drilldown');
  queries = await import('@/lib/dashboard/queries');

  marina = seed('MARINA', 1_000_000);
  hamonia = seed('HAMONIA', 7_777_777);
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Marina's session asking for Hamonia's snapshot. */
const stolenScope = () => ({
  companyId: marina.companyId,
  snapshotId: hamonia.snapshotId,
  projectId: null,
});

describe('two companies on the same report date', () => {
  it('leaves both snapshots live', () => {
    // Before the company was part of the "one current per report date" rule,
    // the second import retired the first company's snapshot and its dashboard
    // went blank.
    const a = snapshots.getCurrentSnapshot(marina.companyId);
    const b = snapshots.getCurrentSnapshot(hamonia.companyId);

    assert.equal(a?.id, marina.snapshotId);
    assert.equal(b?.id, hamonia.snapshotId);
  });

  it('lists only its own snapshots', () => {
    assert.deepEqual(
      snapshots.listSnapshots(marina.companyId).map((s) => s.id),
      [marina.snapshotId],
    );
    assert.deepEqual(
      snapshots.listSnapshots(hamonia.companyId).map((s) => s.id),
      [hamonia.snapshotId],
    );
  });

  it('lists only its own imports', () => {
    assert.deepEqual(
      imports.listImports(marina.companyId).map((i) => i.id),
      [marina.importId],
    );
  });
});

describe('a snapshot id from another company', () => {
  it('does not resolve', () => {
    assert.equal(snapshots.getSnapshot(marina.companyId, hamonia.snapshotId), null);
    assert.equal(snapshots.getSnapshot(hamonia.companyId, marina.snapshotId), null);
  });

  it('yields no metrics', () => {
    assert.deepEqual(snapshots.getMetrics(hamonia.snapshotId, null, marina.companyId), []);
    // The company's own snapshot does produce them, so the assertion above is
    // about isolation and not about an empty database.
    assert.ok(snapshots.getMetrics(marina.snapshotId, null, marina.companyId).length > 0);
  });

  it('yields no records through the drill-down', () => {
    for (const key of [
      'bank_current_amount',
      'total_receivable_outstanding',
      'boq_outstanding',
      'wip_ytd',
      'advance_outstanding',
      'contract_outstanding',
    ]) {
      const stolen = drilldownRepo.drilldown(stolenScope(), key);
      assert.deepEqual(stolen.rows, [], `${key} leaked rows`);
      assert.equal(stolen.total, 0, `${key} leaked a total`);

      const own = drilldownRepo.drilldown(
        { companyId: marina.companyId, snapshotId: marina.snapshotId, projectId: null },
        key,
      );
      assert.ok(own.rows.length > 0, `${key} returned nothing for its own company`);
    }
  });

  it('yields no dataset', () => {
    const { data, refs } = snapshots.loadDataset(marina.companyId, hamonia.snapshotId);
    assert.deepEqual(refs, []);
    for (const [table, rows] of Object.entries(data)) {
      assert.deepEqual(rows, [], `${table} leaked`);
    }
  });

  it('yields no validations, projects or source references', () => {
    assert.deepEqual(snapshots.getAllValidations(marina.companyId, hamonia.snapshotId), []);
    assert.deepEqual(snapshots.getSnapshotProjectIds(marina.companyId, hamonia.snapshotId), []);

    const theirRefs = snapshots.loadDataset(hamonia.companyId, hamonia.snapshotId).refIds;
    assert.ok(theirRefs.length > 0);
    assert.deepEqual(snapshots.getSourceReferences(marina.companyId, theirRefs), []);
  });

  it('cannot be recalculated', () => {
    assert.throws(
      () => snapshots.recalculateSnapshot(marina.companyId, hamonia.snapshotId),
      /Snapshot not found/,
    );
  });

  it('yields nothing through any dashboard query', () => {
    const scope = stolenScope();

    assert.deepEqual(queries.getReceivableRows(scope), []);
    assert.deepEqual(queries.getBoqRows(scope), []);
    assert.deepEqual(queries.getLedgerRows(scope).rows, []);
    assert.equal(queries.getLedgerRows(scope).totalCount, 0);
    assert.deepEqual(queries.getAccountSummary(scope), []);
    assert.deepEqual(queries.getProjectMetrics(scope, []), []);

    const summary = queries.loadDatasetSummary(scope);
    assert.deepEqual(summary.incomeByMonth, []);
    assert.deepEqual(summary.receivableByCategory, []);
    assert.equal(summary.outstandingTotal, 0);
    for (const [kind, n] of Object.entries(summary.recordCounts)) {
      assert.equal(n, 0, `${kind} leaked ${n} rows`);
    }

    const series = queries.getMonthlySeries(scope, REPORT_DATE, 0);
    assert.ok(series.every((m) => m.income === 0 && m.expense === 0));

    // And the same queries do return this company's own figures.
    const own = { companyId: marina.companyId, snapshotId: marina.snapshotId, projectId: null };
    assert.ok(queries.getReceivableRows(own).length > 0);
    assert.ok(queries.loadDatasetSummary(own).recordCounts.receivable > 0);
  });
});

describe('a drill-down that does not fit', () => {
  it('reports the total of every record, not of the rows it shows', () => {
    // The rows are the largest few; the total is all of them. Footing the
    // returned rows made a KPI of ฿1.2bn open a drill-down footed at ฿400m,
    // with nothing on screen to say why.
    const scope = { companyId: marina.companyId, snapshotId: marina.snapshotId, projectId: null };

    const full = drilldownRepo.drilldown(scope, 'total_receivable_outstanding');
    const limited = drilldownRepo.drilldown(scope, 'total_receivable_outstanding', 1);

    assert.equal(limited.rows.length, 1);
    assert.equal(limited.total, full.total);
    assert.equal(limited.recordCount, full.recordCount);
    assert.equal(full.recordCount, 2);
    assert.equal(limited.truncated, true);
    assert.equal(full.truncated, false);

    // The full total is both records', which is the KPI's own figure.
    assert.equal(full.total, 1_500_000);
    assert.notEqual(limited.rows[0].amount, limited.total);
  });
});

describe('a project id from another company', () => {
  it('does not widen a read of the caller’s own snapshot', () => {
    const scope = {
      companyId: marina.companyId,
      snapshotId: marina.snapshotId,
      projectId: hamonia.projectId,
    };

    assert.deepEqual(queries.getReceivableRows(scope), []);
    assert.deepEqual(queries.getLedgerRows(scope).rows, []);
    assert.equal(queries.getLedgerRows(scope).totalCount, 0);
    assert.deepEqual(drilldownRepo.drilldown(scope, 'bank_current_amount').rows, []);
  });
});

describe('an import id from another company', () => {
  it('is not found', () => {
    assert.equal(imports.getImportSummary(marina.companyId, hamonia.importId), null);
  });

  it('exposes no files and no issues', () => {
    assert.deepEqual(imports.getImportFiles(marina.companyId, hamonia.importId), []);
    assert.deepEqual(imports.getImportIssues(marina.companyId, hamonia.importId), []);

    // Its own import does have both, so these are not empty for want of data.
    assert.ok(imports.getImportFiles(hamonia.companyId, hamonia.importId).length > 0);
    assert.ok(imports.getImportIssues(hamonia.companyId, hamonia.importId).length > 0);
  });

  it('cannot be rolled back, and leaves the other company untouched', () => {
    assert.equal(imports.rollbackImport(marina.companyId, hamonia.importId), false);

    const still = snapshots.getCurrentSnapshot(hamonia.companyId);
    assert.equal(still?.id, hamonia.snapshotId);
    assert.equal(imports.getImportSummary(hamonia.companyId, hamonia.importId)?.status, 'completed');
  });

  it('is not reported as a duplicate upload', () => {
    // Byte-identical files across companies are normal — the same template
    // filled in twice — and reporting one would disclose the other company's
    // filing as well as blocking a legitimate import.
    const duplicates = imports.findDuplicates(marina.companyId, [
      {
        fileName: 'HAMONIA.xlsx',
        hash: 'hash-HAMONIA.xlsx',
        reportDate: REPORT_DATE,
        projectId: hamonia.projectId,
        reportType: 'receivable',
      },
    ]);

    assert.deepEqual(duplicates, []);

    // Its owner is still warned about it.
    assert.equal(
      imports.findDuplicates(hamonia.companyId, [
        {
          fileName: 'HAMONIA.xlsx',
          hash: 'hash-HAMONIA.xlsx',
          reportDate: REPORT_DATE,
          projectId: hamonia.projectId,
          reportType: 'receivable',
        },
      ]).length,
      1,
    );
  });
});

describe('a stored Customer Card report', () => {
  let reports: typeof import('@/lib/db/repositories/customer-card-reports');
  let marinaReport: string;
  let hamoniaReport: string;

  const save = async (party: Party, label: string, amount: number) => {
    const saved = reports.saveReport({
      companyId: party.companyId,
      projectLabel: label,
      reportDate: REPORT_DATE,
      completionDate: '2028-09-30',
      maxUplift: 0.2,
      sourceFileName: `${label}.xlsx`,
      sourceHash: `hash-${label}`,
      sourceRows: 10,
      sheetName: 'Sheet1',
      headerRow: 6,
      workbook: Buffer.from(`workbook for ${label}`),
      contracts: 1,
      units: 1,
      totalSalePrice: amount,
      totalExpected: amount * 1.2,
      totalPlan: amount,
      totalPaid: amount / 2,
      totalOutstanding: amount / 2,
      totalInterest: amount * 0.2,
      okCount: 1,
      checkCount: 0,
      errorCount: 0,
      checks: [],
      issues: [],
      needsConfirmation: [],
      userId: null,
    });
    return saved.id;
  };

  before(async () => {
    reports = await import('@/lib/db/repositories/customer-card-reports');
    marinaReport = await save(marina, 'ADVTEST_A', 1_000_000);
    hamoniaReport = await save(hamonia, 'ADVTEST_B', 7_777_777);
  });

  it('is listed only for the company that ran it', () => {
    assert.deepEqual(
      reports.listReports(marina.companyId).map((r) => r.id),
      [marinaReport],
    );
    assert.deepEqual(
      reports.listReports(hamonia.companyId).map((r) => r.id),
      [hamoniaReport],
    );
  });

  it('is not found by another company, by id', () => {
    assert.equal(reports.getReport(marina.companyId, hamoniaReport), null);
    assert.equal(reports.getReportDetail(marina.companyId, hamoniaReport), null);

    // And its own company does find it, so the checks above are about
    // isolation rather than about an empty table.
    assert.ok(reports.getReport(hamonia.companyId, hamoniaReport));
  });

  it('does not hand its workbook to another company', () => {
    assert.equal(reports.readReportFile(marina.companyId, hamoniaReport), null);

    const own = reports.readReportFile(hamonia.companyId, hamoniaReport);
    assert.ok(own);
    assert.match(own.toString(), /ADVTEST_B/);
  });

  it('cannot be deleted by another company', () => {
    assert.equal(reports.deleteReport(marina.companyId, hamoniaReport), false);
    assert.ok(reports.getReport(hamonia.companyId, hamoniaReport), 'it was deleted anyway');

    // Its owner can.
    assert.equal(reports.deleteReport(hamonia.companyId, hamoniaReport), true);
    assert.equal(reports.getReport(hamonia.companyId, hamoniaReport), null);
    assert.equal(reports.readReportFile(hamonia.companyId, hamoniaReport), null);
  });
});
