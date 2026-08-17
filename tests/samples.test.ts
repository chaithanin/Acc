import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, before } from 'node:test';

import { DEFAULT_PROJECTS } from '@/config/projects.default';
import { calculateMetrics } from '@/lib/calc/kpi';
import { indexSourceRefs } from '@/lib/calc/aggregate';
import { ProjectResolver } from '@/lib/detect/project-resolver';
import { processFile, type ParsedFileResult } from '@/lib/import/pipeline';
import { runValidations } from '@/lib/validate/rules';

/**
 * End-to-end coverage against the real exports from the accounting system.
 *
 * The workbooks contain live company financial data, so they are NOT committed
 * (see .gitignore). When `samples/` is absent — CI, a fresh clone — the suite
 * skips rather than fails, and the assertions below document exactly what the
 * files looked like so a regression is still obvious when they are present.
 */

const SAMPLE_DIR = path.join(process.cwd(), 'samples');

const resolver = new ProjectResolver(
  DEFAULT_PROJECTS.map((p, i) => ({
    id: `seed-${i}`,
    code: p.code,
    name: p.name,
    company: p.company,
    sortOrder: p.sortOrder,
    active: true,
    aliases: p.aliases,
  })),
);

const codeOf = (projectId: string | null) =>
  projectId ? resolver.all.find((p) => p.id === projectId)?.code ?? null : null;

function sampleFiles(): string[] {
  if (!fs.existsSync(SAMPLE_DIR)) return [];
  return fs.readdirSync(SAMPLE_DIR).filter((f) => f.endsWith('.xlsx'));
}

const available = sampleFiles();

describe('real GL exports', { skip: available.length === 0 && 'samples/ not present' }, () => {
  const parsed = new Map<string, ParsedFileResult>();

  before(async () => {
    for (const fileName of available) {
      const filePath = path.join(SAMPLE_DIR, fileName);
      const buffer = fs.readFileSync(filePath);
      const result = await processFile(
        {
          filePath,
          fileName,
          size: buffer.length,
          hash: createHash('sha256').update(buffer).digest('hex'),
        },
        { resolver, templates: [], defaultReportDate: '2026-08-31' },
      );
      // The pipeline leaves indexing to the persistence step; the calculation
      // engine expects it, so do it here as the import would.
      indexSourceRefs(result.data);
      parsed.set(fileName, result);
    }
  });

  it('reads every sample without failing', () => {
    for (const [fileName, result] of parsed) {
      assert.equal(result.status, 'parsed', `${fileName}: ${result.error ?? ''}`);
    }
  });

  it('classifies them as general ledger reports', () => {
    for (const [fileName, result] of parsed) {
      assert.equal(result.reportType, 'general_ledger', `${fileName} should be a GL report`);
    }
  });

  it('takes the report date from the period end, not the print timestamp', () => {
    // Row 5 reads "Date : 01/01/2026 - 31/08/2026"; row 2's "Report Date" is
    // 11–12/08/2026, which is when the report was printed.
    for (const [fileName, result] of parsed) {
      assert.equal(result.reportDate, '2026-08-31', `${fileName} report date`);
    }
  });

  it('identifies the company from the Thai entity name or the file name', () => {
    const expected: Record<string, string> = {
      'CTN_Advance': 'CHTN',
      'VTR_Advance': 'MARINA_VTR',
      'Sun9_Advance': 'HAMONIA',
      'Sun9_': 'HAMONIA',
    };

    for (const [fileName, result] of parsed) {
      const key = Object.keys(expected).find((k) => fileName.includes(k));
      if (!key) continue;
      assert.equal(codeOf(result.project.projectId), expected[key], `${fileName} project`);
    }
  });

  it('extracts ledger transactions with their source cells', () => {
    for (const [fileName, result] of parsed) {
      assert.ok(result.data.gl.length > 0, `${fileName} should yield GL entries`);

      for (const entry of result.data.gl.slice(0, 20)) {
        assert.equal(entry.sourceRef.file, fileName);
        assert.ok(entry.sourceRef.cell, 'every entry must cite a cell');
        assert.ok(Number.isFinite(entry.debit) && Number.isFinite(entry.credit));
      }
    }
  });

  it('summarises each ledger into an account balance', () => {
    for (const [fileName, result] of parsed) {
      assert.ok(result.data.wip.length > 0, `${fileName} should yield an account summary`);
      for (const account of result.data.wip) {
        assert.ok(account.accountCode, `${fileName}: account code should be captured`);
      }
    }
  });

  it('reconciles the computed closing balance with the Grand Total row', () => {
    // Grand Total as printed in each file. If our arithmetic drifts from the
    // accounting system's own footer, the engine is wrong.
    const expectedClosing: Record<string, number> = {
      'CTN_Advance': 747_598.0,
      'VTR_Advance': 8_216_482.19,
      'Sun9_Advance': 35_063_989.36,
    };

    for (const [fileName, result] of parsed) {
      const key = Object.keys(expectedClosing).find((k) => fileName.includes(k));
      if (!key) continue;

      const total = result.data.wip.reduce((sum, a) => sum + a.ytd, 0);
      assert.ok(
        Math.abs(total - expectedClosing[key]) < 1,
        `${fileName}: computed closing ${total} should match the Grand Total ${expectedClosing[key]}`,
      );
    }
  });

  it('reconciles our arithmetic against the printed footer, and says so', () => {
    // The strongest available check: the accounting system independently
    // prints the closing balance, so this rule catches a misread ledger.
    for (const [fileName, result] of parsed) {
      const calc = calculateMetrics(result.data, result.reportDate);
      const rule = runValidations(result.data, calc, null).find((r) => r.ruleKey === 'ledger_footer');

      assert.ok(rule, `${fileName} should run the ledger footer rule`);
      assert.equal(rule.status, 'pass', `${fileName}: ${rule.message}`);
    }
  });

  it('captures the printed total separately from the computed one', () => {
    for (const [fileName, result] of parsed) {
      for (const account of result.data.wip) {
        assert.notEqual(
          account.statedClosing,
          null,
          `${fileName}: the printed Grand Total should have been captured`,
        );
      }
    }
  });

  it('excludes the Total and Grand Total rows from the transactions', () => {
    for (const [fileName, result] of parsed) {
      const totals = result.data.gl.filter((e) =>
        /grand total|total a\/c/i.test(e.description ?? e.voucherNo ?? ''),
      );
      assert.equal(totals.length, 0, `${fileName} must not import its footer rows`);
    }
  });
});
