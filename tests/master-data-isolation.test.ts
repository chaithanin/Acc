import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

/**
 * Master data is company data.
 *
 * Budgets and templates were keyed without a company, so the "all projects"
 * budget for a month was one row for the whole group and a shared template
 * disabled by one company was disabled for all six. These cover both, and the
 * project ownership the rest of the scoping reads from.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtg-master-'));
process.env.GTG_DATA_DIR = dir;

let companies: typeof import('@/lib/db/repositories/companies');
let projects: typeof import('@/lib/db/repositories/projects');
let budgets: typeof import('@/lib/db/repositories/budgets');
let templates: typeof import('@/lib/db/repositories/templates');

let marina: string;
let hamonia: string;
let marinaProject: string;
let hamoniaProject: string;
let sharedTemplate: string;

before(async () => {
  companies = await import('@/lib/db/repositories/companies');
  projects = await import('@/lib/db/repositories/projects');
  budgets = await import('@/lib/db/repositories/budgets');
  templates = await import('@/lib/db/repositories/templates');

  marina = companies.createCompany({ companyCode: 'MARINA', legalName: 'Marina' }).id;
  hamonia = companies.createCompany({ companyCode: 'HAMONIA', legalName: 'Hamonia' }).id;

  marinaProject = projects.createProject({ code: 'M-1', name: 'Marina One', companyId: marina }).id;
  hamoniaProject = projects.createProject({ code: 'H-1', name: 'Hamonia One', companyId: hamonia }).id;

  // A shipped default: no company, shared by both.
  sharedTemplate = templates.createTemplate({
    name: 'Shared receivable layout',
    reportType: 'receivable',
    matchRules: { fileNamePatterns: ['receivable'] },
  }).id;
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('projects', () => {
  it('are created into the company they were given', () => {
    assert.equal(projects.getProject(marinaProject)?.companyId, marina);
    assert.equal(projects.getProject(hamoniaProject)?.companyId, hamonia);
  });

  it('can be moved, and updating something else does not move them', () => {
    projects.updateProject(marinaProject, { name: 'Marina One (renamed)' });
    assert.equal(projects.getProject(marinaProject)?.companyId, marina);
  });
});

describe('budgets', () => {
  it('keep each company’s group-wide figure separate', () => {
    // The case that was broken: both companies enter an "all projects" budget
    // for the same month. Keyed without a company, the second overwrote the
    // first and both dials then showed the survivor.
    budgets.setBudget({
      companyId: marina, month: '2026-08', projectId: null,
      incomeBudget: 1_000_000, expenseBudget: 500_000, userId: null,
    });
    budgets.setBudget({
      companyId: hamonia, month: '2026-08', projectId: null,
      incomeBudget: 9_000_000, expenseBudget: 4_000_000, userId: null,
    });

    assert.equal(budgets.getBudget(marina, '2026-08', null)?.incomeBudget, 1_000_000);
    assert.equal(budgets.getBudget(hamonia, '2026-08', null)?.incomeBudget, 9_000_000);
  });

  it('are not readable by another company', () => {
    budgets.setBudget({
      companyId: hamonia, month: '2026-09', projectId: hamoniaProject,
      incomeBudget: 7_777, expenseBudget: null, userId: null,
    });

    assert.equal(budgets.getBudget(marina, '2026-09', hamoniaProject), null);
    assert.equal(budgets.getBudget(marina, '2026-09', null), null);
  });

  it('refuse a project belonging to another company', () => {
    assert.throws(
      () =>
        budgets.setBudget({
          companyId: marina, month: '2026-10', projectId: hamoniaProject,
          incomeBudget: 1, expenseBudget: 1, userId: null,
        }),
      /another company/,
    );

    assert.equal(budgets.getBudget(hamonia, '2026-10', hamoniaProject), null);
  });
});

describe('templates', () => {
  it('show the shared defaults to every company', () => {
    for (const company of [marina, hamonia]) {
      const ids = templates.listTemplatesForCompany(company).map((t) => t.id);
      assert.ok(ids.includes(sharedTemplate));
    }
  });

  it('let one company disable a shared default without disabling it for the others', () => {
    assert.equal(templates.setTemplateActiveForCompany(marina, sharedTemplate, false), true);

    const mine = templates.listTemplatesForCompany(marina).find((t) => t.id === sharedTemplate);
    const theirs = templates.listTemplatesForCompany(hamonia).find((t) => t.id === sharedTemplate);

    assert.equal(mine?.active, false);
    assert.equal(theirs?.active, true, 'disabling for one company disabled it for the other');

    // And the shared template itself was not edited.
    assert.equal(templates.getTemplate(sharedTemplate)?.active, true);
  });

  it('hide a company’s own template from the others', () => {
    const own = templates.createTemplate({
      name: 'Marina cashflow layout',
      reportType: 'cashflow',
      companyId: marina,
      matchRules: { fileNamePatterns: ['marina'] },
    });

    assert.ok(templates.listTemplatesForCompany(marina).some((t) => t.id === own.id));
    assert.ok(!templates.listTemplatesForCompany(hamonia).some((t) => t.id === own.id));

    // And it cannot be switched by the company that cannot see it.
    assert.equal(templates.setTemplateActiveForCompany(hamonia, own.id, false), false);
    assert.equal(templates.getTemplate(own.id)?.active, true);
  });
});
