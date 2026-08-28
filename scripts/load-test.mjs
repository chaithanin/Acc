import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Performance and recovery, at the volume the group will actually reach.
 *
 * The audit could say the figures were right and not that they would still
 * arrive in under a second once six companies had a few years of records
 * behind them. This loads the database to that size, measures every page and
 * every drill-down against it, then backs the whole thing up, destroys it, and
 * restores it — because a backup nobody has restored is a file, not a backup.
 *
 *   node --import ./scripts/register-ts.mjs scripts/load-test.mjs
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.LOAD_PORT ?? 3981);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'a-properly-long-password';

/** Five years of month-end closes, for six companies. */
const COMPANIES = Number(process.env.LOAD_COMPANIES ?? 6);
const MONTHS = Number(process.env.LOAD_MONTHS ?? 60);
/** Rows per fact table per company per month. */
const ROWS = Number(process.env.LOAD_ROWS ?? 120);

/** A page slower than this is a page somebody will complain about. */
const BUDGET_MS = Number(process.env.LOAD_BUDGET_MS ?? 1500);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtg-load-'));
process.env.GTG_DATA_DIR = dataDir;
process.env.GTG_ADMIN_PASSWORD = PASSWORD;

const results = [];
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  process.stdout.write(`${ok ? '  ok   ' : '  FAIL '}${name}\n`);
  if (detail) process.stdout.write(`         ${detail}\n`);
}

function timing(name, ms, budget = BUDGET_MS) {
  const ok = ms <= budget;
  results.push({ name, ok, detail: `${ms} ms` });
  process.stdout.write(
    `${ok ? '  ok   ' : '  SLOW '}${name.padEnd(46)}${String(ms).padStart(6)} ms\n`,
  );
}

// ------------------------------------------------------------------ loading

const db = await import('../src/lib/db/index.ts');
const companiesRepo = await import('../src/lib/db/repositories/companies.ts');
const projectsRepo = await import('../src/lib/db/repositories/projects.ts');
const usersRepo = await import('../src/lib/db/repositories/users.ts');
const { bootstrapDatabase } = await import('../src/lib/db/bootstrap.ts');

bootstrapDatabase();

const handle = db.getDb();
const newId = db.newId;
const now = db.nowIso();

process.stdout.write(bold(`\n── Loading ${COMPANIES} companies × ${MONTHS} months × ${ROWS} rows\n`));

const loadStart = Date.now();
const world = [];

const insertAll = handle.transaction(() => {
  const admin = usersRepo.createUser({
    email: 'load@example.com', name: 'Load', password: PASSWORD, role: 'admin',
  });

  for (let c = 0; c < COMPANIES; c += 1) {
    const code = `LOAD${c}`;
    const company = companiesRepo.createCompany({ companyCode: code, legalName: `${code} Co Ltd` });
    companiesRepo.grantCompany(admin.id, company.id);

    const project = projectsRepo.createProject({
      code: `${code}-P1`, name: `${code} Project`, companyId: company.id,
    });

    let firstSnapshot = null;

    for (let m = 0; m < MONTHS; m += 1) {
      const month = new Date(Date.UTC(2021, m, 1));
      const reportDate = new Date(Date.UTC(2021, m + 1, 0)).toISOString().slice(0, 10);
      const monthKey = reportDate.slice(0, 7);
      const isCurrent = m === MONTHS - 1 ? 1 : 0;

      const importId = newId();
      handle.prepare(
        `INSERT INTO imports (id, company_id, report_date, label, status, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, 'completed', ?, ?)`,
      ).run(importId, company.id, reportDate, `${code} ${monthKey}`, admin.id, now);

      const snapshotId = newId();
      handle.prepare(
        `INSERT INTO financial_snapshots
           (id, import_id, company_id, report_date, is_current, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(snapshotId, importId, company.id, reportDate, isCurrent, now);
      firstSnapshot ??= snapshotId;

      const common = [snapshotId, importId, project.id, company.id, reportDate];

      for (let r = 0; r < ROWS; r += 1) {
        const amount = 100_000 + ((c * 7919 + m * 104729 + r * 15485863) % 900_000);

        handle.prepare(
          `INSERT INTO bank_balances (id, snapshot_id, import_id, project_id, company_id, report_date,
             bank_name, account_no, current_amount, pending_expense)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(newId(), ...common, `Bank ${r % 8}`, `ACC-${r}`, amount, amount * 0.05);

        handle.prepare(
          `INSERT INTO receivable_records (id, snapshot_id, import_id, project_id, company_id,
             report_date, category, customer, unit, contractual_amount, receive_amount,
             accrue_amount, computed_accrue, due_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(newId(), ...common,
          ['contract', 'reservation', 'down_payment', 'transfer_fee'][r % 4],
          `Buyer ${c}-${r}`, `${String.fromCharCode(65 + (r % 6))}-${r}`,
          amount * 4, amount * 2, amount * 2, amount * 2,
          new Date(Date.UTC(2021, m - (r % 9), 28)).toISOString().slice(0, 10));

        handle.prepare(
          `INSERT INTO payable_records (id, snapshot_id, import_id, project_id, company_id,
             report_date, vendor, invoice_no, description, category, invoice_date, due_date,
             invoice_amount, paid_amount, stated_outstanding)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(newId(), ...common, `Vendor ${r % 40}`, `${code}-${monthKey}-${r}`,
          'Progress payment', 'construction',
          `${monthKey}-01`, new Date(Date.UTC(2021, m + 1, 15)).toISOString().slice(0, 10),
          amount, amount * 0.6, amount * 0.4);

        handle.prepare(
          `INSERT INTO expense_records (id, snapshot_id, import_id, project_id, company_id,
             report_date, category, description, month, amount, paid_amount, pending_amount, is_forecast)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        ).run(newId(), ...common,
          ['construction', 'marketing', 'administration', 'tax'][r % 4],
          `Cost ${r}`, monthKey, amount, amount * 0.8, amount * 0.2);

        handle.prepare(
          `INSERT INTO boq_records (id, snapshot_id, import_id, project_id, company_id, report_date,
             account_code, description, contractor, cost_category, month,
             boq_amount, boq_to_date, paid_amount, pending_amount)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(newId(), ...common, `51${r % 90}`, `Work package ${r}`, `Contractor ${r % 20}`,
          'construction', monthKey, amount * 10, amount * 4, amount * 3, amount);

        handle.prepare(
          `INSERT INTO gl_entries (id, snapshot_id, import_id, project_id, company_id, report_date,
             account_code, account_name, entry_date, voucher_no, vendor, description,
             debit, credit, balance, is_opening)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        ).run(newId(), ...common, `1${r % 900}`, `Account ${r % 900}`, `${monthKey}-15`,
          `JV-${monthKey}-${r}`, `Vendor ${r % 40}`, `Posting ${r}`,
          amount, 0, amount);
      }
      void month;
    }

    world.push({ code, companyId: company.id, projectId: project.id, firstSnapshot });
  }

  return admin;
});

const admin = insertAll();
const loadMs = Date.now() - loadStart;

const rowCount = handle
  .prepare(
    `SELECT (SELECT COUNT(*) FROM bank_balances)
          + (SELECT COUNT(*) FROM receivable_records)
          + (SELECT COUNT(*) FROM payable_records)
          + (SELECT COUNT(*) FROM expense_records)
          + (SELECT COUNT(*) FROM boq_records)
          + (SELECT COUNT(*) FROM gl_entries) AS n`,
  )
  .get().n;

process.stdout.write(`  ${rowCount.toLocaleString()} fact rows in ${(loadMs / 1000).toFixed(1)}s\n`);

// ------------------------------------------------------------ recalculation

process.stdout.write(bold('\n── Recalculating\n'));

const { recalculateSnapshot } = await import('../src/lib/db/repositories/snapshots.ts');
const live = handle
  .prepare('SELECT id, company_id FROM financial_snapshots WHERE is_current = 1')
  .all();

let slowest = 0;
for (const snapshot of live) {
  const started = Date.now();
  recalculateSnapshot(snapshot.company_id, snapshot.id);
  slowest = Math.max(slowest, Date.now() - started);
}
timing(`recalculate the slowest live snapshot (${ROWS * 6} rows)`, slowest, 5000);

// -------------------------------------------------------------- query speed

process.stdout.write(bold('\n── Queries, against the whole database\n'));

const { drilldown } = await import('../src/lib/db/repositories/drilldown.ts');
const { groupFigures } = await import('../src/lib/db/repositories/group.ts');

const first = world[0];
const liveSnapshot = handle
  .prepare('SELECT id FROM financial_snapshots WHERE company_id = ? AND is_current = 1')
  .get(first.companyId).id;

const scope = { companyId: first.companyId, snapshotId: liveSnapshot, projectId: null };

for (const key of ['bank_current_amount', 'total_receivable_outstanding', 'receivable_aged_120_plus',
  'accounts_payable', 'total_owed', 'total_expense']) {
  const started = Date.now();
  const result = drilldown(scope, key);
  timing(`drill-down ${key} (${result.recordCount} records)`, Date.now() - started, 800);
}

const groupStart = Date.now();
const consolidated = groupFigures(admin.id);
timing(`consolidate ${consolidated.companies.length} companies`, Date.now() - groupStart, 2000);

// ------------------------------------------------------------- page timings

process.stdout.write(bold('\n── Pages, through the running server\n'));

fs.cpSync(path.join(ROOT, '.next/static'), path.join(ROOT, '.next/standalone/.next/static'), { recursive: true });
fs.mkdirSync(path.join(ROOT, '.next/standalone/src/lib/db'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'src/lib/db/schema.sql'), path.join(ROOT, '.next/standalone/src/lib/db/schema.sql'));

const server = spawn(process.execPath, ['server.js'], {
  cwd: path.join(ROOT, '.next/standalone'),
  env: { ...process.env, GTG_DATA_DIR: dataDir, PORT: String(PORT), HOSTNAME: '127.0.0.1' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (b) => process.env.LOAD_VERBOSE && process.stderr.write(b));

for (let i = 0; i < 60; i += 1) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* not up */ }
  await new Promise((r) => setTimeout(r, 1000));
}

const cookies = new Map();
const cookieHeader = () => ({ cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') });
const absorb = (res) => {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
};

const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, '.next/server/server-reference-manifest.json'), 'utf8'),
);
const actionsFor = (page) =>
  Object.entries(manifest.node ?? {})
    .filter(([, entry]) => Object.keys(entry.workers ?? {}).some((w) =>
      w.replace(/^app/, '').replace(/\/page$/, '').replace(/\(dashboard\)/, '').replace(/\/+/g, '/') === page))
    .map(([id]) => id);

async function post(page, fields) {
  for (const id of actionsFor(page)) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
    form.append(`$ACTION_ID_${id}`, '');
    const res = await fetch(`${BASE}${page}`, {
      method: 'POST', headers: cookieHeader(), body: form, redirect: 'manual',
    });
    absorb(res);
    await res.text();
  }
}

await post('/login', { email: 'load@example.com', password: PASSWORD });
await post('/companies', { companyId: first.companyId });

for (const page of ['/', '/financial', '/projects', '/receivable', '/payable', '/boq',
  '/cashflow', '/ledger', '/reconciliation', '/import/history']) {
  // Warm once, measure the second: the first hit compiles and caches, and no
  // user ever sees that one twice.
  await fetch(`${BASE}${page}`, { headers: cookieHeader() }).then((r) => r.text());

  const started = Date.now();
  const res = await fetch(`${BASE}${page}`, { headers: cookieHeader() });
  const body = await res.text();
  const ms = Date.now() - started;

  timing(`GET ${page}`, ms);
  if (res.status >= 400) check(`GET ${page} answers`, false, `status ${res.status}`);
  void body;
}

// ------------------------------------------------------- backup and restore

process.stdout.write(bold('\n── Backup and restore\n'));

const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtg-backup-'));
const backupPath = path.join(backupDir, 'gtg.db');

const before = handle.prepare('SELECT COUNT(*) AS n FROM receivable_records').get().n;
const beforeCash = handle
  .prepare(
    `SELECT value FROM calculated_metrics
      WHERE company_id = ? AND metric_key = 'bank_current_amount' AND project_id IS NULL
      ORDER BY report_date DESC LIMIT 1`,
  )
  .get(first.companyId)?.value ?? null;

// SQLite's own online backup: consistent while the server is still serving,
// which is the only kind worth rehearsing. Copying the file by hand while WAL
// is active is how a backup that restores to a torn database is made.
const backupStart = Date.now();
await handle.backup(backupPath);
timing('back up while the server is serving', Date.now() - backupStart, 10_000);

const backupBytes = fs.statSync(backupPath).size;
check('the backup is a real file', backupBytes > 100_000, `${(backupBytes / 1e6).toFixed(1)} MB`);

// Destroy it, exactly as a disk failure would.
server.kill('SIGKILL');
await new Promise((r) => setTimeout(r, 500));
handle.close();
for (const name of fs.readdirSync(dataDir)) {
  if (name.startsWith('gtg.db')) fs.rmSync(path.join(dataDir, name), { force: true });
}
check('the live database is gone', !fs.existsSync(path.join(dataDir, 'gtg.db')), '');

// Restore, and read it back through the application rather than through SQLite.
fs.copyFileSync(backupPath, path.join(dataDir, 'gtg.db'));

const restoreProbe = spawn(process.execPath, [
  '--import', path.join(ROOT, 'scripts/register-ts.mjs'),
  '-e', `
    process.env.GTG_DATA_DIR = ${JSON.stringify(dataDir)};
    const db = await import(${JSON.stringify(path.join(ROOT, 'src/lib/db/index.ts'))});
    const handle = db.getDb();
    const rows = handle.prepare('SELECT COUNT(*) AS n FROM receivable_records').get().n;
    const cash = handle.prepare(\`
      SELECT value FROM calculated_metrics
       WHERE company_id = ? AND metric_key = 'bank_current_amount' AND project_id IS NULL
       ORDER BY report_date DESC LIMIT 1\`).get(${JSON.stringify(first.companyId)})?.value ?? null;
    const integrity = handle.prepare('PRAGMA integrity_check').get().integrity_check;
    const fk = handle.prepare('PRAGMA foreign_key_check').all().length;
    console.log(JSON.stringify({ rows, cash, integrity, fk }));
  `,
], { stdio: ['ignore', 'pipe', 'pipe'] });

let probeOut = '';
restoreProbe.stdout.on('data', (b) => { probeOut += String(b); });
const probeCode = await new Promise((r) => restoreProbe.on('exit', r));

let restored = null;
try {
  restored = JSON.parse(probeOut.trim().split('\n').pop());
} catch { /* reported below */ }

check('the restored database opens', probeCode === 0 && !!restored,
  probeCode === 0 ? '' : `the probe exited ${probeCode}`);

if (restored) {
  check('every record came back', restored.rows === before, `${restored.rows} of ${before}`);
  check('the figures came back with them', restored.cash === beforeCash,
    `${restored.cash} against ${beforeCash}`);
  check('SQLite reports the restored file as sound', restored.integrity === 'ok', restored.integrity);
  check('the restored file has no broken foreign keys', restored.fk === 0, `${restored.fk} broken`);
}

fs.rmSync(backupDir, { recursive: true, force: true });
fs.rmSync(dataDir, { recursive: true, force: true });

// ------------------------------------------------------------------ verdict

const failed = results.filter((r) => !r.ok);
process.stdout.write(bold(`\n${results.length} checks · ${results.length - failed.length} passed · ${failed.length} failed\n`));
for (const f of failed) process.stdout.write(`  ${f.name} — ${f.detail}\n`);
process.exit(failed.length === 0 ? 0 : 1);
