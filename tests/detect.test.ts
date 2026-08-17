import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_PROJECTS } from '@/config/projects.default';
import { detectHeaders } from '@/lib/detect/header-detector';
import { ProjectResolver } from '@/lib/detect/project-resolver';
import { classifySheet } from '@/lib/detect/sheet-classifier';
import { normalizeKey, containsPhrase } from '@/lib/detect/normalize-text';
import { makeSheet, TEST_PROJECTS } from './helpers';

describe('text normalisation', () => {
  it('collapses spelling variants to the same key', () => {
    assert.equal(normalizeKey('The Sun Light Residence 9'), normalizeKey('the-sun_light residence9'));
    assert.equal(normalizeKey('Marina Golden Bay'), normalizeKey('MARINA  GOLDEN   BAY'));
  });

  it('matches whole tokens rather than substrings', () => {
    assert.ok(containsPhrase('VTR Report Reservation', 'VTR'));
    assert.ok(containsPhrase('Report VTR', 'vtr'));
    assert.equal(containsPhrase('CONVTREPORT', 'VTR'), false);
  });

  it('matches Thai by containment, since Thai has no word spaces', () => {
    assert.ok(containsPhrase('ยอดค้างรับรวม', 'ค้างรับ'));
  });
});

describe('project resolution', () => {
  const resolver = new ProjectResolver(TEST_PROJECTS);

  it('resolves every configured alias to its project', () => {
    const cases: [string, string][] = [
      ['Hamonia', 'p-hamonia'],
      ['Harmonia', 'p-hamonia'],
      ['SUN9', 'p-hamonia'],
      ['Sun 9', 'p-hamonia'],
      ['The Sun Light Residence 9', 'p-hamonia'],
      ['Marina Golden Bay', 'p-marina'],
      ['Victoria', 'p-marina'],
      ['VTR', 'p-marina'],
      ['Chaithanin', 'p-chtn'],
      ['CHTN', 'p-chtn'],
      ['Olympus', 'p-chtn'],
      ['GTG', 'p-gtg'],
      ['Rental', 'p-gtg'],
    ];

    for (const [alias, expected] of cases) {
      const match = resolver.find(alias, 'cell');
      assert.equal(match?.projectId, expected, `alias "${alias}" should resolve to ${expected}`);
    }
  });

  it('finds an alias inside a file name', () => {
    const match = resolver.resolveFile('VTR Report Reservation Down.xlsx', [], []);
    assert.equal(match.projectId, 'p-marina');
    assert.equal(match.matchedIn, 'file-name');
  });

  it('prefers the longest alias when several could match', () => {
    const match = resolver.find('Marina Golden Bay Victoria', 'cell');
    assert.equal(match?.projectId, 'p-marina');
    assert.equal(match?.matchedAlias, 'Marina Golden Bay Victoria');
  });

  it('falls back to sheet names when the file name says nothing', () => {
    const match = resolver.resolveFile('Book1.xlsx', ['Summary', 'WIP Sun09'], []);
    assert.equal(match.projectId, 'p-hamonia');
    assert.equal(match.matchedIn, 'sheet-name');
  });

  it('reports no match rather than guessing', () => {
    const match = resolver.resolveFile('Untitled.xlsx', ['Sheet1'], ['some text']);
    assert.equal(match.projectId, null);
    assert.equal(match.confidence, 0);
  });
});

describe('shipped project configuration', () => {
  // The seeded aliases are what production actually runs on, so they are
  // exercised directly rather than only through a hand-written fixture.
  const resolver = new ProjectResolver(
    DEFAULT_PROJECTS.map((p, i) => ({
      id: `seed-${i}`,
      code: p.code,
      name: p.name,
      company: p.company,
      companyId: null,
      sortOrder: p.sortOrder,
      active: true,
      aliases: p.aliases,
    })),
  );

  const byCode = (code: string) => resolver.all.find((p) => p.code === code)!.id;

  it('resolves the sheet names seen in the real workbooks', () => {
    const cases: [string, string][] = [
      ['WIP Sun09', 'HAMONIA'],
      ['DATA_SUN9 BOQ', 'HAMONIA'],
      ['FN Sun', 'HAMONIA'],
      ['BOQ Hamonia', 'HAMONIA'],
      ['Report Sun 09', 'HAMONIA'],
      ['DATA_VTR', 'MARINA_VTR'],
      ['FN VTR', 'MARINA_VTR'],
      ['VTR WIP', 'MARINA_VTR'],
      ['Report VTR', 'MARINA_VTR'],
      ['DATA_CHTN', 'CHTN'],
      ['FN CTN', 'CHTN'],
      ['GTG', 'GTG'],
    ];

    for (const [sheetName, code] of cases) {
      const match = resolver.resolveFile('Book1.xlsx', [sheetName], []);
      assert.equal(match.projectId, byCode(code), `sheet "${sheetName}" should map to ${code}`);
    }
  });

  it('tells the three Marina companies apart by their full names', () => {
    // "Marina Golden Bay" alone belongs to Victoria, so the longer Elya and
    // Geneva names must win on length or their data would be misfiled.
    const cases: [string, string][] = [
      ['บริษัท มาริน่า โกลเด้น เบย์ วิคทอเรีย จำกัด', 'MARINA_VTR'],
      ['บริษัท มาริน่า โกลเด้น เบย์ เอลย่า จำกัด', 'MARINA_ELYA'],
      ['บริษัท มาริน่า โกลเด้น เบย์ เจนิวา จำกัด', 'MARINA_GENEVA'],
      ['Marina Golden Bay Elya', 'MARINA_ELYA'],
      ['Marina Golden Bay Geneva', 'MARINA_GENEVA'],
      ['Marina Golden Bay', 'MARINA_VTR'],
    ];

    for (const [text, code] of cases) {
      const match = resolver.find(text, 'cell');
      assert.equal(match?.projectId, byCode(code), `"${text}" should map to ${code}`);
    }
  });

  it('resolves the Thai company names printed on the GL reports', () => {
    const cases: [string, string][] = [
      ['บริษัท ไชยธนินทร์ จำกัด ', 'CHTN'],
      ['บริษัท เดอะ ซัน ไลท์ เรสซิเด้นซ์ 9 จำกัด', 'HAMONIA'],
      ['บริษัท โกลบอล ท็อป กรุ๊ป จำกัด', 'GTG'],
    ];

    for (const [text, code] of cases) {
      const match = resolver.find(text, 'cell');
      assert.equal(match?.projectId, byCode(code), `"${text}" should map to ${code}`);
    }
  });

  it('does not let a short project code claim an unrelated word', () => {
    // "GEN" is a Geneva alias; it must not swallow "General Ledger".
    assert.equal(resolver.find('General Ledger', 'sheet-name')?.projectId, undefined);
    assert.equal(resolver.find('Generated Report', 'file-name')?.projectId, undefined);
  });

  it('gives every alias a unique owner, so no spelling is ambiguous', () => {
    const owners = new Map<string, string>();
    for (const project of DEFAULT_PROJECTS) {
      for (const alias of [project.name, project.code, ...project.aliases]) {
        const key = normalizeKey(alias);
        const existing = owners.get(key);
        assert.equal(
          existing ?? project.code,
          project.code,
          `alias "${alias}" is claimed by both ${existing} and ${project.code}`,
        );
        owners.set(key, project.code);
      }
    }
  });
});

describe('header detection', () => {
  it('finds a header row that is not the first row', () => {
    const sheet = makeSheet('Summary', [
      ['Hamonia Customer Receivable Report', null, null],
      ['As of 31/08/2026', null, null],
      [null, null, null],
      ['Customer', 'Contractual Amount', 'Receive Amount'],
      ['Somchai', 5_000_000, 2_000_000],
      ['Suda', 4_000_000, 4_000_000],
    ]);

    const detection = detectHeaders(sheet);
    assert.equal(detection.headerRow, 3);

    const fields = detection.columns.map((c) => c.field);
    assert.ok(fields.includes('customer'));
    assert.ok(fields.includes('contractual_amount'));
    assert.ok(fields.includes('receive_amount'));
  });

  it('maps Thai headers to the same canonical fields', () => {
    const sheet = makeSheet('ค้างรับ', [
      ['ชื่อลูกค้า', 'ยอดตามสัญญา', 'รับแล้ว', 'ค้างรับ'],
      ['สมชาย', 5_000_000, 2_000_000, 3_000_000],
    ]);

    const fields = detectHeaders(sheet).columns.map((c) => c.field);
    assert.ok(fields.includes('customer'));
    assert.ok(fields.includes('contractual_amount'));
    assert.ok(fields.includes('receive_amount'));
    assert.ok(fields.includes('accrue_amount'));
  });

  it('never assigns one canonical field to two columns', () => {
    const sheet = makeSheet('Data', [
      ['Amount', 'Total', 'Value'],
      [1, 2, 3],
    ]);

    const fields = detectHeaders(sheet).columns.map((c) => c.field);
    assert.equal(new Set(fields).size, fields.length);
  });
});

describe('sheet classification', () => {
  it('classifies a receivable sheet from its headers, not its name', () => {
    const sheet = makeSheet('Tab3', [
      ['Customer', 'Contractual Amount', 'Receive Amount', 'Accrue Amount'],
      ['Somchai', 5_000_000, 2_000_000, 3_000_000],
    ]);

    assert.equal(classifySheet(sheet).reportType, 'receivable');
  });

  it('classifies a WIP sheet', () => {
    const sheet = makeSheet('WIP Sun09', [
      ['Account Code', 'Account Name', 'Current Period', 'YTD', 'Advance Payment'],
      ['1010', 'Land', 1_000_000, 12_000_000, 0],
    ]);

    assert.equal(classifySheet(sheet).reportType, 'wip');
  });

  it('classifies a bank sheet', () => {
    const sheet = makeSheet('Bank Statement', [
      ['Bank', 'Bank Current Amount', 'Pending Expense'],
      ['SCB', 8_000_000, 3_000_000],
    ]);

    assert.equal(classifySheet(sheet).reportType, 'bank_statement');
  });

  it('leaves an unrecognisable sheet as unknown instead of guessing', () => {
    const sheet = makeSheet('Notes', [
      ['Please remember to send the report'],
      ['Thanks'],
    ]);

    assert.equal(classifySheet(sheet).reportType, 'unknown');
  });

  it('still classifies a renamed sheet correctly', () => {
    const renamed = makeSheet('Copy of Sheet (2)', [
      ['Account Code', 'Account Name', 'Current Period', 'YTD'],
      ['1010', 'Land', 1_000_000, 12_000_000],
    ]);

    assert.equal(classifySheet(renamed).reportType, 'wip');
  });
});
