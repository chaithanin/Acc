/**
 * The adversarial two-company test, fired at a running server.
 *
 * The repository tests in `tests/data-isolation.test.ts` prove the queries are
 * scoped. This proves the deployed surface is: it starts the real application,
 * signs in as a user granted exactly one company, and sends every route the
 * OTHER company's snapshot id, import id and project id.
 *
 * Anything that comes back with the other company's data is a release blocker.
 * Nothing here is subtle — that is the point. These are the requests an
 * ordinary user makes by copying a URL out of a colleague's message.
 *
 * Usage:  node --import ./scripts/register-ts.mjs scripts/adversarial-test.mjs
 * The server is built and started by this script against a throwaway database.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.ADVERSARIAL_PORT ?? 3987);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtg-adversarial-'));

process.env.GTG_DATA_DIR = dataDir;
process.env.GTG_ADMIN_PASSWORD = 'adversarial-test-password';

const failures = [];
const checks = [];

function check(name, ok, detail) {
  checks.push({ name, ok });
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  process.stdout.write(`${ok ? '  ok  ' : ' FAIL '} ${name}\n`);
  if (!ok && detail) process.stdout.write(`        ${detail}\n`);
}

// ---------------------------------------------------------------- seeding

const REPORT_DATE = '2026-08-31';

function ref(file, cell) {
  return { file, sheet: 'Sheet1', row: 1, col: 1, cell };
}

function dataset(projectId, file, amount) {
  const base = { projectId, projectLabel: null, sourceRef: ref(file, 'B2') };
  return {
    bank: [{ kind: 'bank', ...base, bankName: 'Test Bank', accountNo: '1', currentAmount: amount, pendingExpense: 0 }],
    receivable: [{
      kind: 'receivable', ...base, category: 'contract', customer: 'Buyer', unit: 'A-1',
      contractualAmount: amount, receiveAmount: 0, accrueAmount: amount, dueDate: null,
    }],
    income: [], expense: [], boq: [], wip: [], cashflow: [], gl: [],
  };
}

function parsedFile(projectId, fileName, amount) {
  return {
    fileName, originalName: fileName, containerFile: null,
    filePath: `/tmp/${fileName}`,
    hash: createHash('sha256').update(fileName).digest('hex'),
    size: 1024, fileType: 'xlsx',
    project: {
      projectId, projectCode: 'P1', projectName: 'Project',
      matchedAlias: 'Project', matchedIn: 'manual', confidence: 1,
    },
    reportDate: REPORT_DATE, reportType: 'receivable', reportTypeLabel: 'Receivable',
    sheetCount: 1, sheets: [], data: dataset(projectId, fileName, amount),
    rowCount: 2, issues: [], status: 'parsed', error: null,
  };
}

async function seed() {
  const db = await import('../src/lib/db/index.ts');
  const companies = await import('../src/lib/db/repositories/companies.ts');
  const projects = await import('../src/lib/db/repositories/projects.ts');
  const users = await import('../src/lib/db/repositories/users.ts');
  const imports = await import('../src/lib/db/repositories/imports.ts');
  const { bootstrapDatabase } = await import('../src/lib/db/bootstrap.ts');

  bootstrapDatabase();

  const make = (code, amount) => {
    const company = companies.createCompany({ companyCode: code, legalName: `${code} Co` });
    const project = projects.createProject({
      code: `${code}-P1`, name: `${code} Project`, companyId: company.id,
    });

    const user = users.createUser({
      email: `${code.toLowerCase()}@example.com`,
      name: `${code} Finance`,
      password: 'a-long-enough-password',
      role: 'finance',
    });
    companies.grantCompany(user.id, company.id);

    const result = imports.persistImport({
      companyId: company.id, reportDate: REPORT_DATE, label: `${code} August`,
      userId: user.id, files: [parsedFile(project.id, `${code}.xlsx`, amount)],
      issues: [], mode: 'new',
    });

    // The session is created directly rather than through the sign-in form,
    // which is a server action and not addressable over plain HTTP.
    const sessionId = db.newId();
    db.getDb()
      .prepare(
        `INSERT INTO auth_sessions (id, user_id, expires_at, created_at, active_company_id)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(sessionId, user.id, new Date(Date.now() + 86400_000).toISOString(), db.nowIso(), company.id);

    return {
      code,
      companyId: company.id,
      projectId: project.id,
      importId: result.importId,
      snapshotId: result.snapshotId,
      sessionId,
      amount,
    };
  };

  // Codes that no seeded project can collide with — the bootstrap derives a
  // company from each default project, and a clash would fail before the test
  // had begun.
  return { marina: make('ADVTEST_A', 1_000_000), hamonia: make('ADVTEST_B', 7_777_777) };
}

// ---------------------------------------------------------------- server

/**
 * Starts the STANDALONE build — the same bundle the container runs.
 *
 * `next start` refuses to serve an `output: standalone` build, and testing a
 * different server from the one that ships would prove nothing about the one
 * that does.
 */
function startServer() {
  const root = path.resolve(import.meta.dirname, '..');
  const standalone = path.join(root, '.next/standalone');

  // The standalone bundle carries its own tree; static assets and the schema
  // are copied beside it exactly as the Dockerfile does.
  fs.cpSync(path.join(root, '.next/static'), path.join(standalone, '.next/static'), {
    recursive: true,
  });
  fs.mkdirSync(path.join(standalone, 'src/lib/db'), { recursive: true });
  fs.copyFileSync(
    path.join(root, 'src/lib/db/schema.sql'),
    path.join(standalone, 'src/lib/db/schema.sql'),
  );

  const child = spawn(process.execPath, ['server.js'], {
    cwd: standalone,
    env: { ...process.env, GTG_DATA_DIR: dataDir, PORT: String(PORT), HOSTNAME: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (b) => process.env.ADVERSARIAL_VERBOSE && process.stdout.write(b));
  child.stderr.on('data', (b) => process.stderr.write(b));

  // A server that never came up must not be mistaken for one that did. Without
  // this the requests below would reach whatever else is listening, and a run
  // against someone else's database would report a clean bill of health.
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`\nThe server exited with code ${code} before the test finished.`);
      process.exit(2);
    }
  });

  return child;
}

/** Refuses to run against a server this script did not start. */
async function assertPortFree() {
  try {
    const response = await fetch(`${BASE}/api/health`);
    if (response.ok || response.status > 0) {
      throw new Error(
        `Something is already listening on ${PORT}. A stale server would answer every ` +
          'request from its own database, and every check below would be meaningless. ' +
          'Stop it, or set ADVERSARIAL_PORT.',
      );
    }
  } catch (err) {
    if (err.message.includes('already listening')) throw err;
    // Connection refused: the port is free, which is what we want.
  }
}

async function waitForServer(attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('The server did not start.');
}

const asUser = (party) => ({ cookie: `gtg_session=${party.sessionId}` });

async function get(url, party) {
  const response = await fetch(`${BASE}${url}`, {
    headers: asUser(party),
    redirect: 'manual',
  });
  const text = await response.text();
  return { status: response.status, text, location: response.headers.get('location') };
}

async function post(url, party, body) {
  const response = await fetch(`${BASE}${url}`, {
    method: 'POST',
    headers: { ...asUser(party), 'content-type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await response.text();
  return { status: response.status, text };
}

// ------------------------------------------------------------------ runs

async function run({ marina, hamonia }) {
  console.log(`\nSeeded ADVTEST_A (฿${marina.amount.toLocaleString()}) and ADVTEST_B (฿${hamonia.amount.toLocaleString()}).`);
  console.log('Signed in as ADVTEST_A throughout; every request below carries ADVTEST_B identifiers.\n');

  /**
   * What must never appear in an ADVTEST_A response.
   *
   * Deliberately NOT the identifiers: a page echoes the query string it was
   * given back into its own links and forms, so finding ADVTEST_B's snapshot
   * id in the HTML proves only that the requester supplied it. What must not
   * come back is ADVTEST_B's DATA — its figures, its name, its project.
   */
  const secrets = [
    String(hamonia.amount),
    hamonia.amount.toLocaleString('en-US'),
    (hamonia.amount / 1_000_000).toFixed(2),
    'ADVTEST_B',
  ];

  const leaks = (text) => secrets.filter((s) => text.includes(s));

  // --- /api/drilldown -----------------------------------------------------
  for (const metricKey of ['bank_current_amount', 'total_receivable_outstanding']) {
    const r = await get(
      `/api/drilldown?snapshotId=${hamonia.snapshotId}&metricKey=${metricKey}`,
      marina,
    );
    const body = JSON.parse(r.text || '{}');
    check(
      `GET /api/drilldown with ADVTEST_B's snapshot (${metricKey})`,
      r.status === 404 || ((body.rows ?? []).length === 0 && (body.total ?? 0) === 0),
      `status ${r.status}, ${(body.rows ?? []).length} rows, total ${body.total}`,
    );
  }

  {
    const r = await get(
      `/api/drilldown?snapshotId=${marina.snapshotId}&metricKey=bank_current_amount&projectId=${hamonia.projectId}`,
      marina,
    );
    const body = JSON.parse(r.text || '{}');
    check(
      "GET /api/drilldown with own snapshot but ADVTEST_B's project",
      (body.rows ?? []).length === 0 && (body.total ?? 0) === 0,
      `${(body.rows ?? []).length} rows, total ${body.total}`,
    );
  }

  {
    // The control: ADVTEST_A's own drill-down must still work, or the checks
    // above would pass on a route that returns nothing to anybody.
    const r = await get(
      `/api/drilldown?snapshotId=${marina.snapshotId}&metricKey=bank_current_amount`,
      marina,
    );
    const body = JSON.parse(r.text || '{}');
    check(
      'CONTROL: ADVTEST_A can still drill into its own snapshot',
      r.status === 200 && (body.rows ?? []).length > 0 && body.total === marina.amount,
      `status ${r.status}, ${(body.rows ?? []).length} rows, total ${body.total}`,
    );
  }

  // --- /api/imports/[id] --------------------------------------------------
  for (const action of ['rollback', 'recalculate']) {
    const r = await post(`/api/imports/${hamonia.importId}`, marina, { action });
    check(
      `POST /api/imports/{ADVTEST_B's import} ${action} is refused`,
      r.status === 404,
      `status ${r.status}: ${r.text.slice(0, 160)}`,
    );
  }

  {
    const r = await post(`/api/imports/${marina.importId}`, marina, {
      action: 'recalculate',
      snapshotId: hamonia.snapshotId,
    });
    check(
      "POST /api/imports/{own import} recalculating ADVTEST_B's snapshot is refused",
      r.status === 409,
      `status ${r.status}: ${r.text.slice(0, 160)}`,
    );
  }

  // --- /api/import/confirm ------------------------------------------------
  {
    const r = await post('/api/import/confirm', marina, { previewId: 'not-a-real-preview' });
    check(
      'POST /api/import/confirm with an unknown preview is refused',
      r.status === 404,
      `status ${r.status}`,
    );
  }

  // --- /api/reports/customer-card -----------------------------------------
  {
    // It reads no stored data, but it still runs only for a company: without
    // one there is nothing to label the report with and no access decision has
    // been made. A request with no body must not reach the parser either.
    const r = await post('/api/reports/customer-card', marina, {});
    check(
      'POST /api/reports/customer-card without a file is refused',
      r.status === 400 || r.status === 500,
      `status ${r.status}: ${r.text.slice(0, 120)}`,
    );
  }

  // --- pages --------------------------------------------------------------
  /**
   * Each page carries a phrase that only appears once it has actually
   * rendered.
   *
   * A page that crashes leaks nothing and would otherwise pass — which is how
   * a settings page broken by a non-serialisable server action got a clean
   * bill of health from a green build, a clean type-check and this very
   * script. "No leak" must not be earnable by failing to render.
   */
  const pages = [
    [`/?snapshotId=${hamonia.snapshotId}`, 'Executive Overview'],
    [`/?projectId=${hamonia.projectId}`, 'Executive Overview'],
    [`/financial?snapshotId=${hamonia.snapshotId}`, 'Financial'],
    [`/receivable?snapshotId=${hamonia.snapshotId}`, 'Receivable'],
    [`/ledger?snapshotId=${hamonia.snapshotId}`, 'Ledger'],
    [`/boq?snapshotId=${hamonia.snapshotId}`, 'BOQ'],
    [`/cashflow?snapshotId=${hamonia.snapshotId}`, 'Cash Flow'],
    [`/projects?snapshotId=${hamonia.snapshotId}&projectId=${hamonia.projectId}`, 'Projects'],
    [`/reconciliation?snapshotId=${hamonia.snapshotId}`, 'Reconciliation'],
    [`/inspector?importId=${hamonia.importId}`, 'Data Inspector'],
    ['/import/history', 'Import History'],
    ['/reports/customer-card', 'Customer Card Report'],
    // Deliberately a phrase from deep inside the page, not its heading. A
    // server component streams its header before the component that fails, so
    // a title proves only that rendering started.
    ['/settings/projects', 'Add a project'],
    ['/settings/budget', 'Income budget'],
    ['/settings/templates', 'How mapping is decided'],
  ];

  for (const [page, marker] of pages) {
    const r = await get(page, marina);
    const found = leaks(r.text);
    /**
     * A page that threw during streaming still answers 200 with most of its
     * HTML — the failure is recorded as an error entry in the RSC payload and
     * nowhere else. That is exactly what a non-serialisable server action did
     * to the projects settings page, and what a status check alone missed.
     */
    const streamedError = /E\{\\"digest\\":\\"\d/.test(r.text);
    const rendered = r.status < 400 && r.text.includes(marker) && !streamedError;

    check(
      `GET ${page}`,
      found.length === 0 && rendered,
      found.length
        ? `leaked: ${found.join(', ')}`
        : rendered
          ? `status ${r.status}`
          : streamedError
            ? `the page threw while rendering (status ${r.status})`
            : `the page did not render (status ${r.status}, no "${marker}")`,
    );
  }

  // --- and the same from the other side ------------------------------------
  {
    const r = await get(`/api/drilldown?snapshotId=${marina.snapshotId}&metricKey=bank_current_amount`, hamonia);
    const body = JSON.parse(r.text || '{}');
    check(
      'GET /api/drilldown: ADVTEST_B cannot read ADVTEST_A either',
      r.status === 404 || (body.rows ?? []).length === 0,
      `status ${r.status}, ${(body.rows ?? []).length} rows`,
    );
  }
}

// ------------------------------------------------------------------ main

// Seeded before the server starts, so there is no question of the server
// holding a connection opened before the rows existed.
let seeded;
try {
  await assertPortFree();
  seeded = await seed();
} catch (err) {
  console.error(`\nSeeding failed: ${err.message}`);
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(2);
}

const server = startServer();
let exitCode = 0;

try {
  await waitForServer();
  await run(seeded);

  console.log(`\n${checks.length} checks, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.log('\nDATA LEAKED — this build must not go to production:\n');
    for (const f of failures) console.log(`  · ${f}`);
    exitCode = 1;
  } else {
    console.log('\nNo endpoint returned another company’s data.');
  }
} catch (err) {
  console.error(`\nThe test could not run: ${err.message}`);
  exitCode = 2;
} finally {
  server.kill('SIGTERM');
  fs.rmSync(dataDir, { recursive: true, force: true });
}

process.exit(exitCode);
