#!/usr/bin/env node
/**
 * Reads what is in the database, and in particular what the pulls from Mango
 * left there, and says what looks wrong. Read-only: it opens the database for
 * reading and writes nothing.
 *
 * Runs inside the container, where better-sqlite3 and the database both live:
 *
 *   docker exec gtg-app-1 node scripts/audit-pulls.mjs
 *
 * What it can and cannot establish. It can say what is in the database, where
 * each row came from, and whether the pull's own findings were respected. It
 * cannot say whether Mango's numbers were read correctly, because Mango is not
 * reachable from here: for that, put the "owed by customers" line of a
 * `--dry-run` beside the same company's line below. They are computed the same
 * way and must match to the baht.
 *
 * It looks at EVERY snapshot, not only the newest. The dashboard opens the one
 * with the latest report date, and a snapshot with an impossible date (it has
 * happened: 4710-05-31) sits in front of everything real, so reading only the
 * newest would report the impossible one and say nothing of what is behind it.
 *
 * Deliberately plain JavaScript with no imports from the app, like users.mjs:
 * the runtime image carries the compiled bundle rather than source.
 *
 * Exits 1 when it found something that should be fixed before the figures are
 * relied on, so it can sit in a pipeline.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = process.env.GTG_DATA_DIR
  ? path.resolve(process.env.GTG_DATA_DIR)
  : path.resolve(process.cwd(), 'data');
const file = path.join(dataDir, 'gtg-financial.db');
if (!fs.existsSync(file)) {
  console.error(`No database at ${file}.`);
  process.exit(2);
}
const db = new Database(file, { readonly: true, fileMustExist: true });

const MANGO = 'Mango Anywhere — ';
const baht = (n) => Math.round(n ?? 0).toLocaleString('en-US');
const bold = (t) => `\x1b[1m${t}\x1b[0m`;
const thisYear = new Date().getUTCFullYear();

/** A report date no report here can have. The dashboard ranks snapshots by date, newest first. */
const impossibleDate = (iso) => {
  const y = Number(String(iso).slice(0, 4));
  return !Number.isFinite(y) || y < 2000 || y > thisYear + 1;
};

const companies = db
  .prepare('SELECT id, company_code, display_name FROM companies WHERE active = 1 ORDER BY sort_order, company_code')
  .all();

/** Every completed snapshot a company has, in the order the dashboard ranks them. */
const snapshotsOf = db.prepare(
  `SELECT s.id, s.import_id, s.report_date, s.is_current, i.label, i.created_at
     FROM financial_snapshots s JOIN imports i ON i.id = s.import_id
    WHERE i.status = 'completed' AND s.company_id = ?
    ORDER BY s.report_date DESC, s.created_at DESC`,
);

const rowsOf = (table, cols) => db.prepare(
  `SELECT ${cols}, COALESCE(r.source_file, '') AS src
     FROM ${table} t LEFT JOIN source_references r ON r.id = t.source_ref_id
    WHERE t.snapshot_id = ?`,
);
const receivables = rowsOf('receivable_records', 't.contractual_amount AS a, t.receive_amount AS b');
const payables = rowsOf('payable_records', 't.invoice_amount AS a, t.paid_amount AS b');
const banks = rowsOf('bank_balances', 't.current_amount AS a, 0 AS b');
const issuesOf = db.prepare(
  "SELECT severity, code FROM import_issues WHERE import_id = ? AND severity = 'error' ORDER BY code",
);
const filesOf = db.prepare('SELECT original_name FROM import_files WHERE import_id = ? ORDER BY created_at LIMIT 3');

/** "Mango Anywhere — MG2" → "MG2"; anything else is not from Mango. */
const mangoCode = (src) => (src.startsWith(MANGO) ? src.slice(MANGO.length).trim() : null);

// ----------------------------------------------------------- pulls ever recorded
// Counted from the imports themselves, so it does not matter which snapshot is
// current, whether one was replaced, or what date it was filed under.
const pulls = db.prepare(
  `SELECT i.id, i.status, i.report_date, i.created_at, i.label, c.company_code
     FROM imports i LEFT JOIN companies c ON c.id = i.company_id
    WHERE i.label LIKE 'Mango Anywhere%'
       OR EXISTS (SELECT 1 FROM import_files f WHERE f.import_id = i.id AND f.file_name LIKE 'mango-anywhere-%')
    ORDER BY i.created_at`,
).all();

// ------------------------------------------------------------- every snapshot
const rows = [];
const problems = [];
const notes = [];

for (const company of companies) {
  const snaps = snapshotsOf.all(company.id);
  if (snaps.length === 0) {
    notes.push(`${company.company_code}: nothing has been imported yet`);
    continue;
  }

  snaps.forEach((snap, position) => {
    const ar = receivables.all(snap.id), ap = payables.all(snap.id), bk = banks.all(snap.id);
    const all = [...ar, ...ap, ...bk];
    const codes = [...new Set(all.map((r) => mangoCode(r.src)).filter(Boolean))];
    const fromMango = all.filter((r) => mangoCode(r.src)).length;
    const bankRows = bk.filter((r) => mangoCode(r.src));
    const owed = (list) => list.reduce((sum, r) => sum + (r.a - r.b), 0);
    const errors = issuesOf.all(snap.import_id);
    const bankErrors = errors.filter((i) => i.code.startsWith('ANYWHERE_BANK_'));

    const row = {
      company, snap,
      isDefault: position === 0 && Boolean(snap.is_current),
      isCurrent: Boolean(snap.is_current),
      source: codes.length ? `Mango ${codes.join('+')}${fromMango < all.length ? ' + uploads' : ''}` : 'uploads',
      codes,
      counts: { ar: ar.length, ap: ap.length, bank: bk.length },
      owedByCustomers: owed(ar), owedToSuppliers: owed(ap), cash: bk.reduce((s, r) => s + r.a, 0),
      files: filesOf.all(snap.import_id).map((f) => f.original_name),
      mango: { ar: ar.filter((r) => mangoCode(r.src)), ap: ap.filter((r) => mangoCode(r.src)) },
    };
    if (row.isCurrent) rows.push(row);

    // ----------------------------------------------------------- what is wrong
    if (impossibleDate(snap.report_date)) {
      problems.push({
        company,
        what: `a snapshot is dated ${snap.report_date}${row.isDefault ? ', and it is the one the dashboard opens' : ''}`
          + (row.files.length ? ` (from ${row.files.join(', ')})` : ''),
        fix: 'The dashboard ranks snapshots by date, newest first, so it sits in front of every real period. '
          + 'Roll that import back in Import History, then upload the file again with the report date typed in.',
      });
    }
    if (bankErrors.length > 0 && bankRows.length > 0) {
      problems.push({
        company,
        what: `bank balances from Mango are in the ${snap.report_date} snapshot (${bankRows.length} accounts, `
          + `${baht(bankRows.reduce((s, r) => s + r.a, 0))}) although the pull flagged them: ${bankErrors[0].code}`,
        fix: 'Roll back that import in Import History, then pull again with the current code, which withholds them.',
      });
    } else if (bankRows.length > 0 && bankRows.reduce((s, r) => s + r.a, 0) < 0) {
      problems.push({
        company,
        what: `Mango bank balances in the ${snap.report_date} snapshot total `
          + `${baht(bankRows.reduce((s, r) => s + r.a, 0))}, a negative cash position`,
        fix: 'Either the sign is the accounting way round (confirm against one account in Mango, then --flip-bank-sign) '
          + 'or loan accounts are mixed in with the cash.',
      });
    }
    if (codes.length > 1) {
      problems.push({
        company,
        what: `rows from more than one Mango company are mixed in the ${snap.report_date} snapshot: ${codes.join(', ')}`,
        fix: 'Each Mango company should map to one company here. Roll back and pull with a corrected --map.',
      });
    }
  });
}

// ---------------------------------------------------------------- across companies
const mangoRows = rows.filter((r) => r.codes.length > 0);
const byCode = new Map();
for (const r of mangoRows) for (const c of r.codes) {
  const owners = byCode.get(c) ?? new Set();
  owners.add(r.company.company_code);
  byCode.set(c, owners);
}
for (const [code, owners] of byCode) {
  if (owners.size > 1) {
    problems.push({
      company: null,
      what: `Mango ${code} is filed under ${owners.size} companies here: ${[...owners].join(', ')}`,
      fix: 'One Mango company was mapped to several. Both sets of figures are suspect: fix --map, roll back, pull again.',
    });
  }
}

// Two companies with identical receivable and payable positions are almost
// never two companies. It is one company read twice.
for (let i = 0; i < mangoRows.length; i++) {
  for (let j = i + 1; j < mangoRows.length; j++) {
    const x = mangoRows[i], y = mangoRows[j];
    if (x.company.id === y.company.id) continue;
    if (x.counts.ar === y.counts.ar && x.counts.ap === y.counts.ap
      && Math.round(x.owedByCustomers) === Math.round(y.owedByCustomers)
      && Math.round(x.owedToSuppliers) === Math.round(y.owedToSuppliers)
      && x.counts.ar + x.counts.ap > 0) {
      problems.push({
        company: null,
        what: `${x.company.company_code} and ${y.company.company_code} hold identical Mango positions `
          + `(${x.counts.ar} customers owing ${baht(x.owedByCustomers)})`,
        fix: 'That is one Mango company filed twice. The session was probably not switched between them.',
      });
    }
  }
}

// ---------------------------------------------------------------------- report
console.log(bold('\nWhat is in the database, and what the pulls from Mango left there'));
console.log(`(database: ${file})`);

console.log(bold('\nPulls from Mango recorded here'));
if (pulls.length === 0) {
  console.log('  none. No pull from Mango has ever been written to this database.');
  console.log('  (A pull run from another machine writes to THAT machine\'s database: without');
  console.log('   GTG_DATA_DIR pointing at this one, it goes to ./data beside the code.)');
} else {
  const by = (s) => pulls.filter((p) => p.status === s).length;
  console.log(`  ${pulls.length} recorded: ${by('completed')} completed, ${by('rolled_back')} rolled back, `
    + `${pulls.length - by('completed') - by('rolled_back')} other`);
  for (const p of pulls.slice(-12)) {
    console.log(`  ${String(p.created_at).slice(0, 16)}  ${String(p.company_code ?? '?').padEnd(14)} `
      + `${p.status.padEnd(11)} ${p.label ?? ''}`);
  }
}

console.log(bold('\nEvery current snapshot  (* = the one the dashboard opens)'));
const W = [14, 12, 22, 5, 5, 5, 17, 17, 17];
const head = ['company', 'as of', 'from', 'cust', 'supp', 'bank', 'owed by customers', 'owed to suppliers', 'cash in the bank'];
console.log(head.map((h, i) => h.padEnd(W[i])).join('  '));
console.log(W.map((w) => '-'.repeat(w)).join('  '));
for (const r of rows) {
  const date = `${r.isDefault ? '*' : ' '}${r.snap.report_date}${impossibleDate(r.snap.report_date) ? ' ✗' : ''}`;
  console.log([
    r.company.company_code.padEnd(W[0]),
    date.padEnd(W[1]),
    r.source.padEnd(W[2]),
    String(r.counts.ar).padStart(W[3]),
    String(r.counts.ap).padStart(W[4]),
    String(r.counts.bank).padStart(W[5]),
    baht(r.owedByCustomers).padStart(W[6]),
    baht(r.owedToSuppliers).padStart(W[7]),
    (r.counts.bank ? baht(r.cash) : 'none').padStart(W[8]),
  ].join('  '));
}
console.log('\nWhere "from" says Mango, compare "owed by customers" and "owed to suppliers" with the same');
console.log('lines of a `--dry-run` for that Mango company. They are computed the same way and must match.');

if (notes.length > 0) {
  console.log(bold('\nNoted'));
  for (const n of notes) console.log(`  ${n}`);
}

if (problems.length === 0) {
  console.log(bold('\nNothing found that should be fixed before these figures are relied on.\n'));
  process.exit(0);
}

console.log(bold(`\n${problems.length} thing${problems.length === 1 ? '' : 's'} to fix`));
for (const p of problems) {
  console.log(`\n  ${p.company ? p.company.company_code : 'across companies'}: ${p.what}`);
  console.log(`    → ${p.fix}`);
}
console.log('');
process.exit(1);
