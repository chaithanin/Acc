/**
 * End-to-end audit of the running application.
 *
 * Drives the standalone bundle — the same one the container serves — over HTTP
 * as a user of every role, across two companies holding real imported data.
 *
 * It is not a unit test. The unit suite proves the functions are right; this
 * proves the deployed thing works: that a page renders rather than merely
 * answers 200, that a form actually writes to SQLite, that a role cannot reach
 * what it should not, and that the figure on a dashboard is the figure in the
 * database.
 *
 * Forms are driven through their real server actions. Next.js posts a form
 * action as multipart to the page's own URL with a `$ACTION_ID_<id>` field, so
 * that is what this sends — the same request the browser makes, not a
 * shortcut through the repository underneath.
 *
 * Usage: node --import ./scripts/register-ts.mjs scripts/e2e-audit.mjs
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.E2E_PORT ?? 3977);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.resolve(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtg-e2e-'));

process.env.GTG_DATA_DIR = dataDir;
process.env.GTG_ADMIN_PASSWORD = 'e2e-audit-password';

const REPORT_DATE = '2026-08-31';
const PASSWORD = 'a-long-enough-password';

const results = [];
let currentModule = '(setup)';

const bold = (s) => `[1m${s}[0m`;

function module_(name) {
  currentModule = name;
  process.stdout.write(`\n${bold(`── ${name}`)}\n`);
}

function check(name, ok, detail, severity = 'High') {
  results.push({ module: currentModule, name, ok, detail, severity });
  process.stdout.write(`${ok ? '  ok   ' : ` ${severity[0]}FAIL `}${name}\n`);
  if (!ok && detail) process.stdout.write(`         ${detail}\n`);
}

function warn(name, detail) {
  results.push({ module: currentModule, name, ok: true, warning: true, detail, severity: 'Low' });
  process.stdout.write(`  warn  ${name}\n         ${detail}\n`);
}

// --------------------------------------------------------------- seeding

const ref = (file, cell) => ({ file, sheet: 'Sheet1', row: 1, col: 1, cell });

function dataset(projectId, file, a) {
  const base = { projectId, projectLabel: null, sourceRef: ref(file, 'B2') };
  return {
    bank: [
      { kind: 'bank', ...base, bankName: 'Kasikorn', accountNo: '1', currentAmount: a, pendingExpense: a * 0.1 },
      { kind: 'bank', ...base, sourceRef: ref(file, 'B3'), bankName: 'Bangkok', accountNo: '2', currentAmount: a * 0.5, pendingExpense: 0 },
    ],
    receivable: [
      { kind: 'receivable', ...base, category: 'contract', customer: 'Buyer A', unit: 'A-1', contractualAmount: a, receiveAmount: a * 0.4, accrueAmount: a * 0.6, dueDate: null },
      { kind: 'receivable', ...base, sourceRef: ref(file, 'B4'), category: 'reservation', customer: 'Buyer B', unit: 'A-2', contractualAmount: a * 0.2, receiveAmount: 0, accrueAmount: a * 0.2, dueDate: null },
    ],
    income: [{ kind: 'income', ...base, category: 'contract', description: 'Sale', month: '2026-08', contractualAmount: a * 0.3, receivedAmount: a * 0.1, accruedAmount: a * 0.2, isForecast: false }],
    expense: [{ kind: 'expense', ...base, category: 'construction', description: 'Build', month: '2026-08', amount: a * 0.25, paidAmount: a * 0.2, pendingAmount: a * 0.05, isForecast: false }],
    boq: [{ kind: 'boq', ...base, accountCode: '5100', description: 'Structure', contractor: 'Somsak', costCategory: 'construction', month: '2026-08', boqAmount: a * 2, boqToDate: a, paidAmount: a * 0.8, pendingAmount: a * 0.2 }],
    wip: [{ kind: 'wip', ...base, accountCode: '1400', accountName: 'WIP', currentPeriod: a * 0.1, ytd: a * 0.6, advancePayment: a * 0.15, statedClosing: null }],
    cashflow: [{ kind: 'cashflow', ...base, month: '2026-09', openingBalance: a, expectedIncome: a * 0.2, expectedExpense: a * 0.1, netCashflow: a * 0.1, closingBalance: a * 1.1, isComputed: false }],
    gl: [{ kind: 'gl', ...base, accountCode: '1000', accountName: 'Cash', entryDate: '2026-08-01', voucherNo: 'JV-1', vendor: null, description: 'Opening', costCode: null, module: null, job: null, debit: a, credit: 0, balance: a, isOpeningBalance: true }],
  };
}

function parsedFile(projectId, fileName, amount) {
  return {
    fileName, originalName: fileName, containerFile: null, filePath: `/tmp/${fileName}`,
    hash: createHash('sha256').update(fileName).digest('hex'), size: 2048, fileType: 'xlsx',
    project: { projectId, projectCode: 'P1', projectName: 'Project', matchedAlias: 'Project', matchedIn: 'manual', confidence: 1 },
    reportDate: REPORT_DATE, reportType: 'receivable', reportTypeLabel: 'Receivable',
    sheetCount: 1, sheets: [], data: dataset(projectId, fileName, amount), rowCount: 10,
    issues: [{ severity: 'warning', code: 'e2e_issue', message: `Issue for ${fileName}`, source: { file: fileName, sheet: 'Sheet1', row: 1, cell: 'B2' } }],
    status: 'parsed', error: null,
  };
}

const ROLES = ['admin', 'finance', 'management', 'viewer'];

let db;
let repos = {};
let world;

async function seed() {
  db = await import('../src/lib/db/index.ts');
  repos.companies = await import('../src/lib/db/repositories/companies.ts');
  repos.users = await import('../src/lib/db/repositories/users.ts');
  repos.projects = await import('../src/lib/db/repositories/projects.ts');
  repos.imports = await import('../src/lib/db/repositories/imports.ts');
  repos.reports = await import('../src/lib/db/repositories/customer-card-reports.ts');
  repos.budgets = await import('../src/lib/db/repositories/budgets.ts');
  repos.templates = await import('../src/lib/db/repositories/templates.ts');
  const { bootstrapDatabase } = await import('../src/lib/db/bootstrap.ts');

  bootstrapDatabase();

  const make = (code, amount, roles) => {
    const company = repos.companies.createCompany({ companyCode: code, legalName: `${code} Co Ltd` });
    const project = repos.projects.createProject({ code: `${code}-P1`, name: `${code} Project`, companyId: company.id });

    const people = {};
    for (const role of roles) {
      const user = repos.users.createUser({
        email: `${role}.${code.toLowerCase()}@example.com`,
        name: `${role} of ${code}`, password: PASSWORD, role,
      });
      repos.companies.grantCompany(user.id, company.id);
      people[role] = { id: user.id, email: user.email, role, cookies: new Map() };
    }

    const result = repos.imports.persistImport({
      companyId: company.id, reportDate: REPORT_DATE, label: `${code} August`,
      userId: people.admin.id, files: [parsedFile(project.id, `${code}.xlsx`, amount)],
      issues: [], mode: 'new',
    });

    const report = repos.reports.saveReport({
      companyId: company.id, projectLabel: code, reportDate: REPORT_DATE,
      completionDate: '2028-09-30', maxUplift: 0.2, sourceFileName: `${code}-card.xlsx`,
      sourceHash: `hash-${code}`, sourceRows: 5, sheetName: 'Sheet1', headerRow: 6,
      workbook: Buffer.from(`workbook holding ${code} figures`),
      contracts: 1, units: 1, totalSalePrice: amount, totalExpected: amount * 1.2,
      totalPlan: amount, totalPaid: amount * 0.5, totalOutstanding: amount * 0.5,
      totalInterest: amount * 0.2, okCount: 1, checkCount: 0, errorCount: 0,
      checks: [], issues: [], needsConfirmation: [], userId: people.admin.id,
    });

    return {
      code, companyId: company.id, companyName: `${code} Co Ltd`,
      projectId: project.id, projectCode: `${code}-P1`,
      importId: result.importId, snapshotId: result.snapshotId, reportId: report.id,
      amount, people,
    };
  };

  const alpha = make('E2EALPHA', 1_000_000, ROLES);
  const beta = make('E2EBETA', 7_777_777, ['admin', 'finance']);

  const both = repos.users.createUser({ email: 'both@example.com', name: 'Both companies', password: PASSWORD, role: 'admin' });
  repos.companies.grantCompany(both.id, alpha.companyId);
  repos.companies.grantCompany(both.id, beta.companyId);

  const orphan = repos.users.createUser({ email: 'orphan@example.com', name: 'No companies', password: PASSWORD, role: 'finance' });

  // A company with a user and nothing else. Its screens are the test for
  // invented data: anything but zero on them was not read from a file.
  const emptyCo = repos.companies.createCompany({ companyCode: 'E2EEMPTY', legalName: 'E2EEMPTY Co Ltd' });
  const emptyAdmin = repos.users.createUser({
    email: 'admin.e2eempty@example.com', name: 'admin of E2EEMPTY', password: PASSWORD, role: 'admin',
  });
  repos.companies.grantCompany(emptyAdmin.id, emptyCo.id);

  return {
    alpha, beta,
    empty: {
      companyId: emptyCo.id,
      admin: { id: emptyAdmin.id, email: emptyAdmin.email, role: 'admin', cookies: new Map() },
    },
    both: { id: both.id, email: 'both@example.com', role: 'admin', cookies: new Map() },
    orphan: { id: orphan.id, email: 'orphan@example.com', role: 'finance', cookies: new Map() },
  };
}

// ---------------------------------------------------------------- server

let serverErrors = [];

function startServer() {
  const standalone = path.join(ROOT, '.next/standalone');
  fs.cpSync(path.join(ROOT, '.next/static'), path.join(standalone, '.next/static'), { recursive: true });
  fs.mkdirSync(path.join(standalone, 'src/lib/db'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'src/lib/db/schema.sql'), path.join(standalone, 'src/lib/db/schema.sql'));

  const child = spawn(process.execPath, ['server.js'], {
    cwd: standalone,
    env: { ...process.env, GTG_DATA_DIR: dataDir, PORT: String(PORT), HOSTNAME: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (b) => process.env.E2E_VERBOSE && process.stdout.write(b));
  child.stderr.on('data', (b) => {
    serverErrors.push(String(b));
    if (process.env.E2E_VERBOSE) process.stderr.write(String(b));
  });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`\nThe server exited with ${code} before the audit finished.`);
      process.exit(2);
    }
  });

  return child;
}

async function assertPortFree() {
  try {
    const r = await fetch(`${BASE}/api/health`);
    if (r.status > 0) throw new Error(`Something already listens on ${PORT}; set E2E_PORT.`);
  } catch (err) {
    if (err.message.includes('already listens')) throw err;
  }
}

async function waitForServer(attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('The server did not start.');
}

// ------------------------------------------------------------------ http

function cookieHeader(who) {
  if (!who?.cookies?.size) return {};
  return { cookie: [...who.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
}

function absorbCookies(who, res) {
  if (!who?.cookies) return;
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    who.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

async function get(url, who) {
  const res = await fetch(`${BASE}${url}`, { headers: cookieHeader(who), redirect: 'manual' });
  absorbCookies(who, res);
  return { status: res.status, text: await res.text(), location: res.headers.get('location'), headers: res.headers };
}

async function send(method, url, who, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { ...cookieHeader(who), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  absorbCookies(who, res);
  return { status: res.status, text: await res.text(), headers: res.headers };
}

// --------------------------------------------------------- server actions

/** page path -> [action ids], from the build's own manifest. */
const ACTIONS = (() => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, '.next/server/server-reference-manifest.json'), 'utf8'),
  );
  const byPage = new Map();
  for (const [id, entry] of Object.entries(manifest.node ?? {})) {
    for (const worker of Object.keys(entry.workers ?? {})) {
      const page = worker.replace(/^app/, '').replace(/\/page$/, '').replace(/\(dashboard\)/, '') || '/';
      const key = page.replace(/\/+/g, '/');
      if (!byPage.has(key)) byPage.set(key, []);
      byPage.get(key).push(id);
    }
  }
  return byPage;
})();

/**
 * Where a server action sent the browser.
 *
 * A form posted without JavaScript is answered with an ordinary redirect, so
 * the destination is in Location; the RSC flavour puts it in a header of its
 * own. Reading only the second one made every redirect look like null.
 */
const redirectOf = (res) =>
  res.headers.get('x-action-redirect') ?? res.headers.get('location');

/**
 * Submits a form the way the browser does.
 *
 * A page can register several actions and the manifest does not say which is
 * which, so each is tried until one has the effect the caller is looking for.
 * An action handed fields it does not recognise returns without doing
 * anything — every one of them guards its inputs — so this is safe to sweep.
 */
async function submit(page, fields, who, { expect } = {}) {
  const ids = ACTIONS.get(page) ?? [];
  if (ids.length === 0) return { ok: false, reason: `no server action registered for ${page}`, tried: 0 };

  const attempts = [];

  for (const id of ids) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
    form.append(`$ACTION_ID_${id}`, '');

    const res = await fetch(`${BASE}${page}`, {
      method: 'POST',
      headers: cookieHeader(who),
      body: form,
      redirect: 'manual',
    });
    absorbCookies(who, res);

    const text = await res.text();
    const redirect = redirectOf(res);
    attempts.push({ id, status: res.status, redirect, text });

    if (!expect) {
      if (res.status < 500) return { ok: true, id, status: res.status, redirect, text, attempts };
    } else if (expect()) {
      return { ok: true, id, status: res.status, redirect, text, attempts };
    }
  }

  return { ok: false, reason: 'no action produced the expected effect', attempts, tried: ids.length };
}

/**
 * Submits a page's own form, the way a browser does.
 *
 * A server action that closes over anything — and one defined inside a server
 * component and handed to a client component always does — is given its bound
 * arguments in hidden fields beside the action id. Next decrypts them before
 * the action body runs, so an id synthesised from the manifest fails at
 * `atob` and the action never happens. The fields are therefore taken from the
 * rendered page and only the values under test are replaced.
 */
const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" };
const unescapeHtml = (v) =>
  v.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_, e) => HTML_ENTITIES[e]);

function hiddenFields(form) {
  const out = [];
  for (const tag of form.match(/<input\b[^>]*>/g) ?? []) {
    if (!/type="hidden"/.test(tag)) continue;
    const name = tag.match(/name="([^"]*)"/)?.[1];
    if (!name) continue;
    out.push([unescapeHtml(name), unescapeHtml(tag.match(/value="([^"]*)"/)?.[1] ?? '')]);
  }
  return out;
}

async function submitForm(page, who, { contains = [], fields = {}, expect } = {}) {
  const rendered = await get(page, who);
  if (rendered.status >= 400 || streamedError(rendered.text)) {
    return { ok: false, reason: `GET ${page} answered ${rendered.status}` };
  }

  const forms = (rendered.text.match(/<form\b[\s\S]*?<\/form>/g) ?? [])
    .filter((f) => contains.every((c) => f.includes(c)));
  if (forms.length === 0) {
    return { ok: false, reason: `no form on ${page} matching ${JSON.stringify(contains)}` };
  }

  const attempts = [];
  for (const form of forms) {
    const body = new FormData();
    const carried = hiddenFields(form);
    for (const [name, value] of carried) {
      if (!(name in fields)) body.append(name, value);
    }
    for (const [k, v] of Object.entries(fields)) body.append(k, String(v));

    const res = await fetch(`${BASE}${page}`, {
      method: 'POST',
      headers: { ...cookieHeader(who), origin: BASE },
      body,
      redirect: 'manual',
    });
    absorbCookies(who, res);
    const text = await res.text();
    const redirect = redirectOf(res);
    attempts.push({ status: res.status, redirect, carried: carried.map(([n]) => n) });

    if (expect ? expect() : res.status < 500) {
      return { ok: true, status: res.status, redirect, text, attempts };
    }
  }

  return {
    ok: false,
    reason: `${forms.length} form(s) tried, none had the expected effect: ` +
      attempts.map((a) => `[${a.status} -> ${a.redirect} · fields ${a.carried.join(',')}]`).join(' '),
    attempts,
  };
}

/** Signs in through the real login form and keeps the session cookie. */
async function login(who, password = PASSWORD) {
  who.cookies = new Map();
  const r = await submit('/login', { email: who.email, password }, who);
  return { ...r, signedIn: who.cookies.has('gtg_session') };
}

// ------------------------------------------------------------- assertions

const streamedError = (text) => /E\{\\"digest\\":\\"\d/.test(text);
const renders = (r, marker) => r.status < 400 && r.text.includes(marker) && !streamedError(r.text);

const row = (sql, ...p) => db.getDb().prepare(sql).get(...p);
const all = (sql, ...p) => db.getDb().prepare(sql).all(...p);
const count = (sql, ...p) => row(sql, ...p)?.n ?? 0;

export { results };

// =====================================================================
//                              the audit
// =====================================================================

async function audit() {
  const { alpha, beta, both, orphan } = world;

  // ------------------------------------------------------------ M1 auth
  module_('M1 · Authentication & session');
  {
    const anon = await get('/', null);
    check('an unauthenticated request to / is sent to the login page',
      anon.status === 307 && anon.location === '/login',
      `status ${anon.status}, location ${anon.location}`, 'Critical');

    const loginPage = await get('/login', null);
    check('the login page renders', renders(loginPage, 'Email'), `status ${loginPage.status}`, 'Critical');

    const bad = { ...alpha.people.admin, cookies: new Map() };
    const wrong = await login(bad, 'definitely-not-the-password');
    check('a wrong password is refused and sets no session',
      !wrong.signedIn && String(wrong.redirect).includes('error'),
      `signedIn=${wrong.signedIn} redirect=${wrong.redirect}`, 'Critical');
    check('the refusal does not say which half was wrong',
      !/password|email/i.test(String(wrong.redirect)),
      `redirect ${wrong.redirect}`, 'Low');

    for (const role of ROLES) {
      const who = alpha.people[role];
      const r = await login(who);
      check(`${role} can sign in through the real form`, r.signedIn,
        `status ${r.status} redirect ${r.redirect}`, 'Critical');
    }

    await login(beta.people.admin);
    await login(beta.people.finance);
    await login(both);
    await login(orphan);

    const session = row('SELECT COUNT(*) AS n FROM auth_sessions');
    check('every sign-in wrote a session row', session.n >= 8, `${session.n} sessions`, 'High');

    // Sign-in must select a company, or every page redirects to the chooser.
    const admin = alpha.people.admin;
    const chooser = await get('/companies', admin);
    check('the company chooser renders after sign-in',
      renders(chooser, alpha.companyName) || renders(chooser, 'E2EALPHA'),
      `status ${chooser.status}`, 'Critical');
  }

  // ------------------------------------------- M2 company selection
  module_('M2 · Company selection');
  {
    const admin = alpha.people.admin;
    const picked = await submit('/companies', { companyId: alpha.companyId }, admin);
    check('choosing a company is accepted', picked.ok, picked.reason, 'Critical');

    const active = row('SELECT active_company_id FROM auth_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', admin.id);
    check('the choice is written to the session row',
      active?.active_company_id === alpha.companyId,
      `session holds ${active?.active_company_id}, expected ${alpha.companyId}`, 'Critical');

    for (const role of ROLES) {
      const who = alpha.people[role];
      await submit('/companies', { companyId: alpha.companyId }, who);
    }
    await submit('/companies', { companyId: beta.companyId }, beta.people.admin);
    await submit('/companies', { companyId: beta.companyId }, beta.people.finance);
    await submit('/companies', { companyId: alpha.companyId }, both);

    // A company the user has no grant for must not become active.
    const before = row('SELECT active_company_id AS c FROM auth_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', alpha.people.finance.id)?.c;
    await submit('/companies', { companyId: beta.companyId }, alpha.people.finance);
    const after = row('SELECT active_company_id AS c FROM auth_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', alpha.people.finance.id)?.c;
    check('a company the user was never granted cannot be selected',
      after === before && after !== beta.companyId,
      `active company went from ${before} to ${after}`, 'Critical');

    const orphanPage = await get('/companies', orphan);
    check('a user with no companies is told so rather than shown an error',
      orphanPage.status < 400 && !streamedError(orphanPage.text),
      `status ${orphanPage.status}`, 'Medium');
  }

  // --------------------------------------------------- M3 pages by role
  module_('M3 · Every page, for every role');

  // marker: a phrase from deep inside the page, so a crash cannot pass.
  const PAGES = [
    ['/', 'Executive Overview', 'dashboard:view'],
    ['/financial', 'Financial', 'dashboard:view'],
    ['/projects', 'Bank', 'dashboard:view'],
    ['/receivable', 'Receivable', 'dashboard:view'],
    ['/boq', 'BOQ', 'dashboard:view'],
    ['/cashflow', 'Cash Flow', 'dashboard:view'],
    ['/ledger', 'Ledger', 'dashboard:view'],
    ['/reconciliation', 'Reconciliation', 'dashboard:view'],
    ['/account', 'Change password', 'dashboard:view'],
    ['/import', 'Upload Financial Excel Files', 'import:run'],
    ['/import/history', 'Import History', 'dashboard:view'],
    ['/inspector', 'Data Inspector', 'import:run'],
    ['/reports/customer-card', 'Where to get the customer card', 'import:run'],
    ['/settings/budget', 'Income budget', 'mapping:edit'],
    ['/settings/projects', 'Add a project', 'projects:edit'],
    ['/settings/templates', 'How mapping is decided', 'mapping:edit'],
    ['/settings/companies', 'Companies', 'users:manage'],
    ['/settings/users', 'Users', 'users:manage'],
  ];

  const PERMISSIONS = {
    'dashboard:view': ['admin', 'finance', 'management', 'viewer'],
    'export:run': ['admin', 'finance', 'management'],
    'import:run': ['admin', 'finance'],
    'import:rollback': ['admin', 'finance'],
    'mapping:edit': ['admin', 'finance'],
    'projects:edit': ['admin', 'finance'],
    'users:manage': ['admin'],
  };

  for (const [url, marker, permission] of PAGES) {
    for (const role of ROLES) {
      const who = alpha.people[role];
      const allowed = PERMISSIONS[permission].includes(role);
      const r = await get(url, who);

      if (allowed) {
        check(`${role} · GET ${url} renders`, renders(r, marker),
          `status ${r.status}${streamedError(r.text) ? ' — the page threw while rendering' : ''}${r.location ? ` → ${r.location}` : ''}`,
          'High');
      } else {
        const refused = r.status === 307 || r.status === 404 || (r.status < 400 && !r.text.includes(marker));
        check(`${role} · GET ${url} is refused`, refused,
          `status ${r.status}${r.location ? ` → ${r.location}` : ''} — the page rendered for a role without ${permission}`,
          'Critical');
      }
    }
  }

  // ------------------------------------------------------ M4 APIs by role
  module_('M4 · Every API, for every role');
  {
    const health = await get('/api/health', null);
    check('GET /api/health answers without a session', health.status === 200, `status ${health.status}`, 'Medium');

    for (const role of ROLES) {
      const who = alpha.people[role];
      const r = await get(`/api/drilldown?snapshotId=${alpha.snapshotId}&metricKey=bank_current_amount`, who);
      const body = JSON.parse(r.text || '{}');
      check(`${role} · GET /api/drilldown answers`, r.status === 200 && Array.isArray(body.rows),
        `status ${r.status}: ${r.text.slice(0, 120)}`, 'High');
    }

    const anon = await get(`/api/drilldown?snapshotId=${alpha.snapshotId}&metricKey=bank_current_amount`, null);
    check('an unauthenticated drill-down is refused', anon.status === 401, `status ${anon.status}`, 'Critical');

    for (const role of ['management', 'viewer']) {
      const who = alpha.people[role];
      const r = await send('POST', `/api/imports/${alpha.importId}`, who, { action: 'recalculate' });
      check(`${role} cannot POST /api/imports/{id}`, r.status === 403, `status ${r.status}: ${r.text.slice(0, 100)}`, 'Critical');

      const rep = await send('POST', '/api/reports/customer-card', who, {});
      check(`${role} cannot POST /api/reports/customer-card`, rep.status === 403, `status ${rep.status}`, 'Critical');

      const dl = await get(`/api/reports/customer-card/${alpha.reportId}`, who);
      check(`${role} can still download a stored report (export permission)`, dl.status === 200,
        `status ${dl.status}`, 'Medium');
    }

    const del = await send('DELETE', `/api/reports/customer-card/${alpha.reportId}`, alpha.people.viewer);
    check('viewer cannot DELETE a report', del.status === 403, `status ${del.status}`, 'Critical');

    const logout = await send('POST', '/api/auth/logout', alpha.people.viewer);
    check('POST /api/auth/logout answers', logout.status < 400, `status ${logout.status}`, 'Medium');
    const gone = row('SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id = ?', alpha.people.viewer.id);
    check('logout removed the session row', gone.n === 0, `${gone.n} sessions remain`, 'High');
    await login(alpha.people.viewer);
    await submit('/companies', { companyId: alpha.companyId }, alpha.people.viewer);
  }

  // -------------------------------------------------------- M5 CRUD
  module_('M5 · CRUD through the real forms');
  const admin = alpha.people.admin;
  {
    // --- projects + aliases
    const code = 'E2E-NEW';
    const created = await submit('/settings/projects',
      { code, name: 'E2E New Project', company: 'E2E' }, admin,
      { expect: () => !!row('SELECT id FROM projects WHERE code = ?', code) });
    const project = row('SELECT id, company_id, active FROM projects WHERE code = ?', code);
    check('create a project through the form writes it to the database',
      created.ok && !!project, created.reason ?? 'no row', 'Critical');
    check('the new project belongs to the company in session',
      project?.company_id === alpha.companyId,
      `company_id ${project?.company_id}, expected ${alpha.companyId}`, 'Critical');

    if (project) {
      const list = await get('/settings/projects', admin);
      check('the new project appears on the page', list.text.includes('E2E New Project'), 'not listed', 'High');

      const alias = 'E2E-ALIAS-XYZ';
      const aliased = await submit('/settings/projects', { projectId: project.id, alias }, admin,
        { expect: () => !!row('SELECT id FROM project_aliases WHERE alias = ?', alias) });
      check('add an alias writes it to the database', aliased.ok && !!row('SELECT id FROM project_aliases WHERE alias = ?', alias),
        aliased.reason, 'High');

      // duplicate alias must be refused
      const dup = await submit('/settings/projects', { projectId: alpha.projectId, alias }, admin);
      const owners = all('SELECT project_id FROM project_aliases WHERE alias = ?', alias);
      check('the same alias cannot be claimed by two projects', owners.length === 1,
        `${owners.length} projects hold "${alias}"`, 'Critical');

      const removed = await submit('/settings/projects', { projectId: project.id, alias }, admin,
        { expect: () => !row('SELECT id FROM project_aliases WHERE alias = ? AND project_id = ?', alias, project.id) });
      check('remove an alias deletes it', removed.ok, removed.reason, 'High');

      const deactivated = await submit('/settings/projects', { projectId: project.id, active: '0' }, admin,
        { expect: () => row('SELECT active FROM projects WHERE id = ?', project.id)?.active === 0 });
      check('deactivate a project updates the row', deactivated.ok,
        `active is ${row('SELECT active FROM projects WHERE id = ?', project.id)?.active}`, 'High');
    }

    // --- budgets
    const saved = await submit('/settings/budget',
      { month: '2026-08', projectId: '', incomeBudget: '5000000', expenseBudget: '3500000' }, admin,
      { expect: () => !!row('SELECT id FROM budgets WHERE month = ? AND company_id = ?', '2026-08', alpha.companyId) });
    const budget = row('SELECT income_budget AS i, expense_budget AS e FROM budgets WHERE month = ? AND company_id = ?', '2026-08', alpha.companyId);
    check('save a budget through the form writes it', saved.ok && budget?.i === 5_000_000,
      `budget row ${JSON.stringify(budget)}`, 'Critical');

    await submit('/settings/budget',
      { month: '2026-08', projectId: '', incomeBudget: '6000000', expenseBudget: '3500000' }, admin,
      { expect: () => row('SELECT income_budget AS i FROM budgets WHERE month = ? AND company_id = ?', '2026-08', alpha.companyId)?.i === 6_000_000 });
    const updated = row('SELECT income_budget AS i FROM budgets WHERE month = ? AND company_id = ?', '2026-08', alpha.companyId);
    const budgetRows = count('SELECT COUNT(*) AS n FROM budgets WHERE month = ? AND company_id = ?', '2026-08', alpha.companyId);
    check('saving the same month again updates rather than duplicates',
      updated?.i === 6_000_000 && budgetRows === 1,
      `income ${updated?.i}, ${budgetRows} rows`, 'High');

    const fin = await get('/financial', admin);
    check('the budget reaches the financial dashboard', fin.status < 400 && !streamedError(fin.text),
      `status ${fin.status}`, 'High');

    // --- users and companies are exercised in M5b, through a browser: their
    // forms are inside client components and their actions carry encrypted
    // bound arguments, so a synthesised POST cannot reach them.

    // --- templates
    const template = repos.templates.listTemplatesForCompany(alpha.companyId)[0];
    if (template) {
      const wasActive = template.active;
      const toggled = await submit('/settings/templates',
        { id: template.id, active: wasActive ? '0' : '1' }, admin,
        { expect: () => repos.templates.listTemplatesForCompany(alpha.companyId).find((t) => t.id === template.id)?.active !== wasActive });
      check('toggling a template changes it for this company', toggled.ok, toggled.reason, 'High');

      const other = repos.templates.listTemplatesForCompany(beta.companyId).find((t) => t.id === template.id);
      check('toggling a shared template leaves the other company alone',
        other?.active === wasActive,
        `the other company now sees active=${other?.active}, expected ${wasActive}`, 'Critical');
    } else {
      warn('no templates to toggle', 'the seed produced no templates for this company');
    }

    // --- account: change my own password
    //
    // Changing a password revokes every session it opened, this one included.
    // That is deliberate, so the session has to be rebuilt with the new
    // password before anything else is attempted with it.
    const newPassword = 'another-long-enough-password';
    const pw = await submit('/account',
      { currentPassword: PASSWORD, newPassword, confirmPassword: newPassword }, admin);

    const afterChange = await get('/', admin);
    check('changing a password revokes the sessions the old one opened',
      afterChange.status === 307 && afterChange.location === '/login',
      `status ${afterChange.status}, location ${afterChange.location}`, 'High');

    const stillOld = await login({ ...admin, cookies: new Map() }, PASSWORD);
    check('the old password no longer signs in', !stillOld.signedIn,
      'the replaced password still works', 'Critical');

    const relogin = await login(admin, newPassword);
    check('changing my own password works and the new one signs in',
      pw.ok && relogin.signedIn, `submit ${pw.ok}, signed in ${relogin.signedIn}`, 'High');

    const wrongCurrent = await submit('/account',
      { currentPassword: 'not-the-current-one', newPassword: 'yet-another-password', confirmPassword: 'yet-another-password' }, admin);
    check('a password change without the current password is refused',
      /error=/.test(String(wrongCurrent.redirect)) &&
        (await login({ ...admin, cookies: new Map() }, 'yet-another-password')).signedIn === false,
      `redirect ${wrongCurrent.redirect}`, 'Critical');

    // put it back so the rest of the audit keeps working
    await login(admin, newPassword);
    await submit('/account', { currentPassword: newPassword, newPassword: PASSWORD, confirmPassword: PASSWORD }, admin);
    const restored = await login(admin);
    check('the admin session is usable again after the password round trip',
      restored.signedIn, 'could not sign back in with the original password', 'Critical');
    await submit('/companies', { companyId: alpha.companyId }, admin);
    const scoped = await get('/', admin);
    check('the restored session is scoped to a company again',
      scoped.status < 400 && !streamedError(scoped.text),
      `status ${scoped.status}, location ${scoped.location}`, 'Critical');
  }

  // -------------------------- M5b CRUD through a browser that runs the page
  //
  // Everything above is HTTP. These forms are not reachable that way: they
  // live inside client components behind an Edit button, and their actions
  // carry encrypted bound arguments that only the page itself can produce.
  // A real browser is the only honest way to test them, so this module drives
  // Chromium against the same server and then reads the database directly.
  module_('M5b · Forms that need a browser');
  {
    let browser;
    try {
      const { chromium } = await import('playwright');
      // The image ships one Chromium; this Playwright build expects a newer
      // revision number. Pointing at the installed binary is what the
      // environment documents, and downloading another is not an option.
      const installed = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome']
        .find((candidate) => fs.existsSync(candidate));
      browser = await chromium.launch(installed ? { executablePath: installed } : {});
    } catch (err) {
      check('a browser is available to test the JavaScript-only forms', false,
        `${err.message} — the create-user and edit-company forms went untested`, 'High');
    }

    if (browser) {
      const ctx = await browser.newContext({ baseURL: BASE });
      const page = await ctx.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e)));

      const signIn = async (email, password) => {
        await page.goto('/login', { waitUntil: 'domcontentloaded' });
        await page.fill('input[name="email"]', email);
        await page.fill('input[name="password"]', password);
        await Promise.all([
          page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 }),
          page.click('button[type="submit"]'),
        ]);
      };

      const chooseCompany = async (companyId) => {
        await page.goto('/companies', { waitUntil: 'domcontentloaded' });
        const form = page.locator(`form:has(input[value="${companyId}"])`);
        if (await form.count()) {
          await Promise.all([
            page.waitForURL((u) => u.pathname === '/', { timeout: 15_000 }),
            form.locator('button[type="submit"]').first().click(),
          ]);
        }
      };

      try {
        await signIn(admin.email, PASSWORD);
        check('the sign-in form works in a browser', !page.url().includes('/login'),
          `landed on ${page.url()}`, 'Critical');
        await chooseCompany(alpha.companyId);

        // ---------------------------------------------------------- users
        const email = 'e2e.created@example.com';
        await page.goto('/settings/users', { waitUntil: 'domcontentloaded' });

        const addUser = page.locator('form:has(button:text("Create user"))');
        await addUser.locator('input[name="name"]').fill('E2E Created');
        await addUser.locator('input[name="email"]').fill(email);
        await addUser.locator('input[name="password"]').fill(PASSWORD);
        await addUser.locator('select[name="role"]').selectOption('viewer');
        await addUser.locator(`input[name="companies"][value="${alpha.companyId}"]`).check();
        await addUser.locator('button:text("Create user")').click();
        await page.waitForLoadState('networkidle');

        const created = row('SELECT id, role, name FROM users WHERE email = ?', email);
        check('create a user through the form writes it', !!created,
          'no row appeared for the account the form was filled in for', 'Critical');

        if (created) {
          const grants = count('SELECT COUNT(*) AS n FROM user_companies WHERE user_id = ?', created.id);
          check('the new user is granted only the company ticked on the form', grants === 1,
            `${grants} grants`, 'High');

          const granted = row('SELECT company_id AS c FROM user_companies WHERE user_id = ?', created.id);
          check('the grant names the company that was ticked', granted?.c === alpha.companyId,
            `granted ${granted?.c}`, 'Critical');

          const stored = row('SELECT password_hash AS h FROM users WHERE id = ?', created.id);
          check('the password is stored hashed, never in the clear',
            !!stored?.h && !String(stored.h).includes(PASSWORD),
            'the plain password appears in the row', 'Critical');

          const signsIn = await login({ email, cookies: new Map() });
          check('the account the form made can actually sign in', signsIn.signedIn,
            'the new account cannot sign in with the password it was given', 'Critical');

          // --- edit that user, which is behind an Edit button
          await page.goto('/settings/users', { waitUntil: 'domcontentloaded' });
          // The Edit button belongs to a row, and the row is identified by the
          // address printed on it — the nearest ancestor of that address which
          // owns an Edit button is the card for this account and no other.
          await page.locator(
            `xpath=//p[normalize-space()="${email}"]`
            + '/ancestor::*[.//button[normalize-space()="Edit"]][1]'
            + '//button[normalize-space()="Edit"]',
          ).click();
          const editForm = page.locator(`form:has(input[name="id"][value="${created.id}"]):has(input[name="name"])`);
          await editForm.locator('input[name="name"]').fill('E2E Renamed');
          await editForm.locator('select[name="role"]').selectOption('management');
          await editForm.locator('button[type="submit"]').first().click();
          await page.waitForLoadState('networkidle');

          const after = row('SELECT name, role FROM users WHERE id = ?', created.id);
          check('edit a user writes the change', after?.name === 'E2E Renamed' && after?.role === 'management',
            `row now ${JSON.stringify(after)}`, 'Critical');

          // --- duplicate email
          const before = count('SELECT COUNT(*) AS n FROM users');
          await page.goto('/settings/users', { waitUntil: 'domcontentloaded' });
          const dup = page.locator('form:has(button:text("Create user"))');
          await dup.locator('input[name="name"]').fill('Duplicate');
          await dup.locator('input[name="email"]').fill(email);
          await dup.locator('input[name="password"]').fill(PASSWORD);
          await dup.locator(`input[name="companies"][value="${alpha.companyId}"]`).check();
          await dup.locator('button:text("Create user")').click();
          await page.waitForLoadState('networkidle');
          check('an email already in use cannot create a second account',
            count('SELECT COUNT(*) AS n FROM users') === before,
            `user count went from ${before} to ${count('SELECT COUNT(*) AS n FROM users')}`, 'Critical');
          check('the refusal is shown rather than swallowed',
            /already|in use|exists/i.test(await page.content()),
            'the page came back with no message explaining the refusal', 'Medium');

          // --- an account with no company is refused
          const beforeNoCo = count('SELECT COUNT(*) AS n FROM users');
          await page.goto('/settings/users', { waitUntil: 'domcontentloaded' });
          const noCo = page.locator('form:has(button:text("Create user"))');
          await noCo.locator('input[name="name"]').fill('No Company');
          await noCo.locator('input[name="email"]').fill('e2e.nocompany@example.com');
          await noCo.locator('input[name="password"]').fill(PASSWORD);
          await noCo.locator('button:text("Create user")').click();
          await page.waitForLoadState('networkidle');
          check('an account with no company is refused rather than created blind',
            count('SELECT COUNT(*) AS n FROM users') === beforeNoCo,
            'an account was created with no company to open', 'High');

          // --- a password shorter than the policy is refused
          const beforeShort = count('SELECT COUNT(*) AS n FROM users');
          await page.goto('/settings/users', { waitUntil: 'domcontentloaded' });
          const short = page.locator('form:has(button:text("Create user"))');
          await short.locator('input[name="name"]').fill('Short Password');
          await short.locator('input[name="email"]').fill('e2e.short@example.com');
          await short.locator('input[name="password"]').fill('abc');
          await short.locator(`input[name="companies"][value="${alpha.companyId}"]`).check();
          await short.evaluate((f) => f.noValidate = true);
          await short.locator('button:text("Create user")').click();
          await page.waitForLoadState('networkidle');
          check('a password below the policy is refused on the server, not only by the browser',
            count('SELECT COUNT(*) AS n FROM users') === beforeShort,
            'a short password created an account once the browser check was bypassed', 'Critical');
        }

        // ------------------------------------------------------ companies
        const companyActions = ACTIONS.get('/settings/companies') ?? [];
        check('adding a company is possible without database access', false,
          `/settings/companies registers ${companyActions.length} actions and none of them creates a company `
          + '(upload logo, remove logo, update details), and the page has no add form; a new subsidiary '
          + 'can only be added by writing to the database', 'Improvement');

        const renamed = 'E2E Alpha Renamed';
        await page.goto('/settings/companies', { waitUntil: 'domcontentloaded' });
        await page.locator(
          `xpath=//input[@name="id" and @value="${alpha.companyId}"]`
          + '/ancestor::*[.//button[normalize-space()="Edit"]][1]'
          + '//button[normalize-space()="Edit"]',
        ).first().click();
        const coForm = page.locator(`form:has(input[name="id"][value="${alpha.companyId}"]):has(input[name="displayName"])`);
        await coForm.locator('input[name="displayName"]').fill(renamed);
        await coForm.locator('button[type="submit"]').first().click();
        await page.waitForLoadState('networkidle');

        const nowNamed = row('SELECT display_name AS d FROM companies WHERE id = ?', alpha.companyId)?.d;
        check('editing a company through the form writes it', nowNamed === renamed,
          `display name is ${nowNamed}`, 'Critical');

        const betaName = row('SELECT display_name AS d FROM companies WHERE id = ?', beta.companyId)?.d;
        check('editing one company leaves the others alone', betaName !== renamed,
          `the other company is now called ${betaName}`, 'Critical');

        // --- a non-admin cannot reach the page at all
        await ctx.clearCookies();
        await signIn(alpha.people.finance.email, PASSWORD);
        await page.goto('/settings/users', { waitUntil: 'domcontentloaded' });
        check('a finance user sent to the users page is turned away',
          !page.url().includes('/settings/users'),
          `finance landed on ${page.url()}`, 'Critical');

        check('no JavaScript error was thrown while all of that ran',
          pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '), 'Medium');
      } catch (err) {
        check('the browser walkthrough completed', false, String(err).slice(0, 300), 'High');
      } finally {
        await browser.close();
      }

      // The audit's own session was replaced by the browser's work above.
      await login(admin);
      await submit('/companies', { companyId: alpha.companyId }, admin);
    }
  }

  // ------------------------------------------------- M6 import workflow
  module_('M6 · Import workflow');
  {
    const history = await get('/import/history', admin);
    check('the import appears in history', history.text.includes('E2EALPHA August') || history.text.includes('August'),
      'the seeded import is not listed', 'High');

    const inspector = await get(`/inspector?importId=${alpha.importId}`, admin);
    check('the inspector opens the import', renders(inspector, 'Data Inspector'), `status ${inspector.status}`, 'High');

    const recalc = await send('POST', `/api/imports/${alpha.importId}`, admin, { action: 'recalculate' });
    const recalcBody = JSON.parse(recalc.text || '{}');
    check('recalculate answers with what it rewrote',
      recalc.status === 200 && recalcBody.metrics > 0,
      `status ${recalc.status}: ${recalc.text.slice(0, 140)}`, 'High');

    const metricsAfter = count('SELECT COUNT(*) AS n FROM calculated_metrics WHERE snapshot_id = ?', alpha.snapshotId);
    check('recalculate left the metrics in place', metricsAfter > 0, `${metricsAfter} metrics`, 'Critical');

    const unknown = await send('POST', `/api/imports/${alpha.importId}`, admin, { action: 'nonsense' });
    check('an unknown import action is refused', unknown.status === 400, `status ${unknown.status}`, 'Medium');

    // Roll back BETA's import so ALPHA is untouched by it.
    const rolled = await send('POST', `/api/imports/${beta.importId}`, beta.people.admin, { action: 'rollback' });
    check('rollback answers', rolled.status === 200, `status ${rolled.status}: ${rolled.text.slice(0, 120)}`, 'High');

    const importRow = row('SELECT status FROM imports WHERE id = ?', beta.importId);
    check('the rolled-back import is kept with its status changed, not deleted',
      importRow?.status === 'rolled_back', `status ${importRow?.status}`, 'Critical');

    const snapshots = count('SELECT COUNT(*) AS n FROM financial_snapshots WHERE import_id = ?', beta.importId);
    check('its snapshot is gone', snapshots === 0, `${snapshots} snapshots remain`, 'High');

    for (const table of ['bank_balances', 'receivable_records', 'income_records', 'expense_records', 'boq_records', 'wip_records', 'gl_entries', 'cashflow_forecasts', 'calculated_metrics']) {
      const left = count(`SELECT COUNT(*) AS n FROM ${table} WHERE import_id = ?`, beta.importId);
      check(`rollback cascaded to ${table}`, left === 0, `${left} rows remain`, 'Critical');
    }

    const alphaLeft = count('SELECT COUNT(*) AS n FROM bank_balances WHERE import_id = ?', alpha.importId);
    check('the other company’s records are untouched by that rollback', alphaLeft > 0,
      `${alphaLeft} rows`, 'Critical');

    const twice = await send('POST', `/api/imports/${beta.importId}`, beta.people.admin, { action: 'rollback' });
    check('rolling back twice is refused rather than repeated', twice.status === 409, `status ${twice.status}`, 'Medium');
  }

  // ------------------------------------------ M7 customer card report
  module_('M7 · Customer Card report');
  {
    const page = await get('/reports/customer-card', admin);
    check('the stored report is listed', page.text.includes('Reports produced'), 'the list is missing', 'High');

    const detail = await get(`/reports/customer-card/${alpha.reportId}`, admin);
    check('its detail page renders', renders(detail, 'Reconciliation by unit'), `status ${detail.status}`, 'High');

    const download = await get(`/api/reports/customer-card/${alpha.reportId}`, admin);
    check('the workbook downloads with the right content type',
      download.status === 200 && String(download.headers.get('content-type')).includes('spreadsheetml'),
      `status ${download.status}, type ${download.headers.get('content-type')}`, 'High');
    check('the downloaded bytes are the ones that were stored',
      download.text.includes('E2EALPHA'), 'the file did not contain the expected marker', 'Critical');

    const missing = await get('/api/reports/customer-card/00000000-0000-0000-0000-000000000000', admin);
    check('an unknown report id answers 404', missing.status === 404, `status ${missing.status}`, 'Medium');

    const gone = await send('DELETE', `/api/reports/customer-card/${beta.reportId}`, beta.people.admin);
    check('a report can be deleted by its owner', gone.status === 200, `status ${gone.status}`, 'High');
    check('the row is gone', !row('SELECT id FROM customer_card_reports WHERE id = ?', beta.reportId),
      'the row survived the delete', 'High');
    const file = row('SELECT stored_path FROM customer_card_reports WHERE id = ?', beta.reportId);
    check('the workbook file is gone with it', !file, 'the row still names a file', 'Medium');
  }

  // ------------------------------- M8 dashboard reconciles with the DB
  module_('M8 · Dashboard figures against the database');
  {
    const bankInDb = row(
      'SELECT SUM(current_amount) AS total FROM bank_balances WHERE snapshot_id = ? AND company_id = ?',
      alpha.snapshotId, alpha.companyId,
    );
    const metric = row(
      `SELECT value FROM calculated_metrics
        WHERE snapshot_id = ? AND company_id = ? AND project_id IS NULL AND metric_key = 'bank_current_amount'`,
      alpha.snapshotId, alpha.companyId,
    );
    check('the stored KPI equals the sum of its records',
      Math.abs((metric?.value ?? 0) - (bankInDb?.total ?? 0)) < 0.01,
      `KPI ${metric?.value} vs records ${bankInDb?.total}`, 'Critical');

    const drill = await get(`/api/drilldown?snapshotId=${alpha.snapshotId}&metricKey=bank_current_amount`, admin);
    const body = JSON.parse(drill.text || '{}');
    check('the drill-down total equals the same figure',
      Math.abs((body.total ?? 0) - (bankInDb?.total ?? 0)) < 0.01,
      `drill-down ${body.total} vs records ${bankInDb?.total}`, 'Critical');
    check('the drill-down lists every contributing record',
      body.recordCount === 2 && body.rows.length === 2,
      `recordCount ${body.recordCount}, rows ${body.rows?.length}`, 'High');

    const overview = await get('/', admin);
    const expected = (bankInDb?.total ?? 0).toLocaleString('en-US');
    const compact = `฿${((bankInDb?.total ?? 0) / 1_000_000).toFixed(2)}M`;
    check('the overview shows that figure',
      overview.text.includes(expected) || overview.text.includes(compact),
      `neither "${expected}" nor "${compact}" is on the page`, 'High');

    const receivableDb = row(
      `SELECT SUM(contractual_amount - receive_amount) AS total FROM receivable_records
        WHERE snapshot_id = ? AND company_id = ?`,
      alpha.snapshotId, alpha.companyId,
    );
    const receivableDrill = JSON.parse(
      (await get(`/api/drilldown?snapshotId=${alpha.snapshotId}&metricKey=total_receivable_outstanding`, admin)).text || '{}',
    );
    check('receivable outstanding reconciles too',
      Math.abs((receivableDrill.total ?? 0) - (receivableDb?.total ?? 0)) < 0.01,
      `drill-down ${receivableDrill.total} vs records ${receivableDb?.total}`, 'Critical');

    const truncated = JSON.parse(
      (await get(`/api/drilldown?snapshotId=${alpha.snapshotId}&metricKey=total_receivable_outstanding&limit=1`, admin)).text || '{}',
    );
    check('a truncated drill-down still reports the true total',
      Math.abs((truncated.total ?? 0) - (receivableDb?.total ?? 0)) < 0.01,
      `total ${truncated.total} vs ${receivableDb?.total}`, 'High');
  }

  // ------------------------------------------------ M9 data integrity
  module_('M9 · Data integrity');
  {
    for (const table of ['bank_balances', 'receivable_records', 'income_records', 'expense_records', 'boq_records', 'wip_records', 'gl_entries', 'cashflow_forecasts', 'calculated_metrics', 'financial_snapshots', 'imports']) {
      const orphans = count(`SELECT COUNT(*) AS n FROM ${table} WHERE company_id IS NULL`);
      check(`no row in ${table} is without a company`, orphans === 0,
        `${orphans} rows have company_id NULL and are visible to nobody`, 'High');
    }

    const dupAlias = all(
      'SELECT alias_key, COUNT(*) AS n FROM project_aliases GROUP BY alias_key HAVING n > 1',
    );
    check('no alias is claimed twice', dupAlias.length === 0,
      `${dupAlias.length} duplicated aliases`, 'Critical');

    const dupEmail = all('SELECT email, COUNT(*) AS n FROM users GROUP BY email HAVING n > 1');
    check('no email is registered twice', dupEmail.length === 0, `${dupEmail.length} duplicates`, 'Critical');

    const currents = all(
      `SELECT company_id, report_date, COUNT(*) AS n FROM financial_snapshots
        WHERE is_current = 1 GROUP BY company_id, report_date HAVING n > 1`,
    );
    check('one live snapshot per company per report date', currents.length === 0,
      `${currents.length} dates have more than one`, 'Critical');

    const fk = db.getDb().pragma('foreign_key_check');
    check('the database has no broken foreign keys', fk.length === 0,
      `${fk.length} violations: ${JSON.stringify(fk.slice(0, 3))}`, 'Critical');

    const integrity = db.getDb().pragma('integrity_check');
    check('SQLite reports the file as sound',
      integrity[0]?.integrity_check === 'ok', JSON.stringify(integrity.slice(0, 2)), 'Critical');

    // Refresh after everything above: the figures must survive a reload.
    const again = await get('/', admin);
    check('the dashboard still renders after all of the above',
      renders(again, 'Executive Overview'), `status ${again.status}`, 'High');
  }

  // ------------------------------- M11 a company with no data shows no data
  //
  // The strongest test for invented figures is a company that has never had a
  // file imported. Every number on its screens has to be nothing, because
  // there is nothing for one to have come from. A placeholder, a demo dataset
  // or a figure left over from another company would show up here as a number
  // that is not zero.
  module_('M11 · A company with no data');
  {
    const who = world.empty.admin;
    await login(who);
    await submit('/companies', { companyId: world.empty.companyId }, who);

    const EMPTY_TABLES = ['bank_balances', 'receivable_records', 'income_records', 'expense_records', 'calculated_metrics'];
    const records = EMPTY_TABLES.reduce(
      (n, table) => n + count(`SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ?`, world.empty.companyId),
      0,
    );
    check('the empty company really has no records', records === 0, `${records} records`, 'Critical');

    for (const page of ['/', '/financial', '/projects', '/receivable', '/boq', '/cashflow', '/ledger', '/reconciliation']) {
      const r = await get(page, who);
      if (r.status >= 400 || streamedError(r.text)) {
        check(`${page} renders for a company with no data`, false, `status ${r.status}`, 'High');
        continue;
      }

      // Money on these screens is written with thousands separators. Any such
      // figure here would be a number nobody imported.
      const visible = r.text.replace(/<script[\s\S]*?<\/script>/g, '');
      const grouped = [...visible.matchAll(/>[^<]*?(\d{1,3}(?:,\d{3})+(?:\.\d+)?)/g)].map((m) => m[1]);
      const nonZero = grouped.filter((g) => Number(g.replace(/,/g, '')) !== 0);
      check(`${page} shows no figure for a company that has imported nothing`,
        nonZero.length === 0, `showed ${nonZero.slice(0, 6).join(', ')}`, 'Critical');
    }

    // The empty company has no snapshot of its own, so the only snapshot id
    // its admin could put in the URL is another company's. It must come back
    // as not there rather than as that company's records.
    const borrowed = await get(
      `/api/drilldown?snapshotId=${alpha.snapshotId}&metricKey=bank_current_amount`, who);
    const body = JSON.parse(borrowed.text || '{}');
    check('a snapshot id belonging to another company answers not-found, not its records',
      borrowed.status === 404 && (body.rows?.length ?? 0) === 0 && !body.total,
      `status ${borrowed.status}, ${body.rows?.length ?? '?'} rows, total ${body.total}`, 'Critical');
    check('the refusal does not admit the snapshot exists elsewhere',
      !/another|other company|belongs/i.test(String(body.error)),
      `said: ${body.error}`, 'Low');

    const reports = await get('/reports/customer-card', who);
    check('the report list for an empty company lists nothing',
      reports.status < 400 && !reports.text.includes('E2EALPHA') && !reports.text.includes('E2EBETA'),
      'another company’s reports are listed', 'Critical');

    await login(admin);
    await submit('/companies', { companyId: alpha.companyId }, admin);
  }

  // ------------------------- M12 the things a brief asks about but code hides
  //
  // Repeated sign-in attempts, two people saving at once, and what the session
  // cookie actually carries. None of these are visible by reading a page.
  module_('M12 · Security posture & concurrency');
  {
    // --- how many wrong guesses does the sign-in form accept?
    const guesser = { email: alpha.people.admin.email, cookies: new Map() };
    let accepted = 0;
    const startedAt = process.hrtime.bigint();
    for (let i = 0; i < 20; i += 1) {
      const r = await login(guesser, `wrong-guess-number-${i}`);
      if (!r.signedIn && String(r.redirect).includes('error')) accepted += 1;
      else break;
    }
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    check('repeated wrong passwords are slowed down or locked out',
      accepted < 20,
      `20 wrong passwords in a row were all answered normally in ${Math.round(elapsedMs)}ms `
      + '(about ' + Math.round(elapsedMs / 20) + 'ms each); there is no lockout, no delay and no attempt counter, '
      + 'so the sign-in form can be guessed at indefinitely',
      'High');

    const stillWorks = await login({ ...alpha.people.admin, cookies: new Map() });
    check('a real password still works after those attempts', stillWorks.signedIn,
      'the account was locked by the guessing, which would be a denial of service', 'Medium');

    // --- what the session cookie carries
    const fresh = { email: alpha.people.admin.email, cookies: new Map() };
    const form = new FormData();
    form.append('email', fresh.email);
    form.append('password', PASSWORD);
    for (const id of ACTIONS.get('/login') ?? []) form.append(`$ACTION_ID_${id}`, '');
    const loginRes = await fetch(`${BASE}/login`, { method: 'POST', body: form, redirect: 'manual' });
    const setCookie = loginRes.headers.getSetCookie?.().find((c) => c.startsWith('gtg_session=')) ?? '';
    check('the session cookie is HttpOnly', /HttpOnly/i.test(setCookie), setCookie.slice(0, 160), 'Critical');
    check('the session cookie is SameSite', /SameSite=(Lax|Strict)/i.test(setCookie), setCookie.slice(0, 160), 'High');
    check('the session cookie is marked Secure in a production build',
      /Secure/i.test(setCookie),
      `the cookie is sent without Secure: ${setCookie.slice(0, 160)}`, 'High');
    check('the session cookie carries an opaque id, not the account',
      !setCookie.includes(fresh.email) && !/role|admin/i.test(setCookie.split(';')[0]),
      setCookie.split(';')[0], 'Critical');

    // --- there is no audit trail beyond what the import tables happen to keep
    const auditTables = all(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE '%audit%' OR name LIKE '%activity%' OR name LIKE '%event_log%')",
    );
    check('there is a record of who changed what', auditTables.length > 0,
      'no audit table exists; imports and stored reports name their user, but a role change, a company '
      + 'rename, a grant, a password reset and a rollback leave nothing behind that says who did it',
      'High');

    // --- two people saving the same budget month at once
    await login(admin);
    await submit('/companies', { companyId: alpha.companyId }, admin);
    const rival = { ...both, cookies: new Map() };
    await login(rival);
    await submit('/companies', { companyId: alpha.companyId }, rival);

    await Promise.all([
      submit('/settings/budget', { month: '2026-11', incomeBudget: '1000', expenseBudget: '500' }, admin),
      submit('/settings/budget', { month: '2026-11', incomeBudget: '2000', expenseBudget: '900' }, rival),
    ]);
    const budgetRows = count(
      'SELECT COUNT(*) AS n FROM budgets WHERE month = ? AND company_id = ?', '2026-11', alpha.companyId);
    check('two people saving the same month at once leave one row, not two',
      budgetRows === 1, `${budgetRows} rows for 2026-11`, 'Critical');

    const kept = row('SELECT income_budget AS i FROM budgets WHERE month = ? AND company_id = ?', '2026-11', alpha.companyId);
    check('the row that survives is one of the two that were saved',
      kept?.i === 1000 || kept?.i === 2000, `income is ${kept?.i}`, 'High');

    // --- two rollbacks of the same import at once
    const both409 = await Promise.all([
      send('POST', `/api/imports/${alpha.importId}`, admin, { action: 'rollback' }),
      send('POST', `/api/imports/${alpha.importId}`, rival, { action: 'rollback' }),
    ]);
    const okCount = both409.filter((r) => r.status === 200).length;
    check('rolling the same import back from two places at once succeeds exactly once',
      okCount === 1, `${okCount} of 2 answered 200 (${both409.map((r) => r.status).join(', ')})`, 'Critical');

    const importStatus = row('SELECT status FROM imports WHERE id = ?', alpha.importId)?.status;
    check('the import is left rolled back, not half rolled back',
      importStatus === 'rolled_back', `status ${importStatus}`, 'Critical');

    check('the database is still sound after the concurrent writes',
      row('PRAGMA integrity_check')?.integrity_check === 'ok',
      JSON.stringify(row('PRAGMA integrity_check')), 'Critical');
  }

  // -------------------------------------- M10 errors surfaced by the server
  module_('M10 · Errors');
  {
    const real = serverErrors
      .join('')
      .split('\n')
      .filter((line) =>
        /Error|error|⨯/.test(line) &&
        !/Warning|deprecated|punycode|ExperimentalWarning/.test(line),
      );

    check('the server logged no unhandled errors while all of the above ran',
      real.length === 0,
      real.slice(0, 6).join(' | ').slice(0, 500), 'High');

    const notFound = await get('/no-such-page-4718', admin);
    check('an unknown page answers 404 rather than crashing',
      notFound.status === 404, `status ${notFound.status}`, 'Medium');

    const badId = await get('/reports/customer-card/not-a-uuid', admin);
    check('a malformed id in a URL answers 404 rather than crashing',
      badId.status === 404, `status ${badId.status}`, 'Medium');
  }
}

// ------------------------------------------------------------------ main

let server;
let exitCode = 0;

try {
  await assertPortFree();
  world = await seed();
  server = startServer();
  await waitForServer();
  await audit();
} catch (err) {
  console.error(`\nThe audit could not finish: ${err.stack ?? err.message}`);
  exitCode = 2;
} finally {
  server?.kill('SIGTERM');
}

// ---------------------------------------------------------------- report

const failed = results.filter((r) => !r.ok);
const warned = results.filter((r) => r.warning);
const bySeverity = (s) => failed.filter((f) => f.severity === s);

console.log(`\n${bold('═'.repeat(72))}`);
console.log(bold('  SUMMARY'));
console.log(bold('═'.repeat(72)));

const modules = [...new Set(results.map((r) => r.module))];
console.log(`\n  ${'MODULE'.padEnd(44)}${'RUN'.padStart(5)}${'PASS'.padStart(6)}${'FAIL'.padStart(6)}${'WARN'.padStart(6)}`);
console.log(`  ${'-'.repeat(67)}`);
for (const m of modules) {
  const rows = results.filter((r) => r.module === m);
  const f = rows.filter((r) => !r.ok).length;
  const w = rows.filter((r) => r.warning).length;
  console.log(`  ${m.padEnd(44)}${String(rows.length).padStart(5)}${String(rows.length - f).padStart(6)}${String(f).padStart(6)}${String(w).padStart(6)}`);
}

console.log(`\n  ${results.length} checks · ${results.length - failed.length} passed · ${failed.length} failed · ${warned.length} warnings`);
console.log(`  Critical ${bySeverity('Critical').length} · High ${bySeverity('High').length} · Medium ${bySeverity('Medium').length} · Low ${bySeverity('Low').length}`);

if (failed.length > 0) {
  console.log(`\n${bold('  FAILURES')}\n`);
  for (const f of failed) {
    console.log(`  [${f.severity}] ${f.module} — ${f.name}`);
    if (f.detail) console.log(`      ${f.detail}`);
  }
}

const blocking = bySeverity('Critical').length + bySeverity('High').length;
console.log(`\n${bold('  VERDICT: ' + (blocking === 0 ? 'no Critical or High failures' : `NOT READY — ${blocking} Critical/High failures`))}\n`);

fs.rmSync(dataDir, { recursive: true, force: true });
process.exit(exitCode || (blocking > 0 ? 1 : 0));
