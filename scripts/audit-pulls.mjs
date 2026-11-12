#!/usr/bin/env node
/**
 * Reads what the pulls from Mango left in the database, and says what looks
 * wrong. Read-only: it opens the database for reading and writes nothing.
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

const companies = db
  .prepare('SELECT id, company_code, display_name FROM companies WHERE active = 1 ORDER BY sort_order, company_code')
  .all();

/** The snapshot the dashboard reads for a company: the same choice listSnapshots makes. */
const currentSnapshot = db.prepare(
  `SELECT s.id, s.import_id, s.report_date, i.label, i.error_count, i.warning_count, i.created_at
     FROM financial_snapshots s JOIN imports i ON i.id = s.import_id
    WHERE i.status = 'completed' AND s.company_id = ?
    ORDER BY s.report_date DESC, s.created_at DESC`,
);

/** Rows of one kind in a snapshot, with where each came from. */
const rows = (table, cols) => db.prepare(
  `SELECT ${cols}, COALESCE(r.source_file, '') AS src
     FROM ${table} t LEFT JOIN source_references r ON r.id = t.source_ref_id
    WHERE t.snapshot_id = ?`,
);
const receivables = rows('receivable_records', 't.contractual_amount AS a, t.receive_amount AS b');
const payables = rows('payable_records', 't.invoice_amount AS a, t.paid_amount AS b');
const banks = rows('bank_balances', 't.current_amount AS a, 0 AS b');
const issues = db.prepare(
  "SELECT severity, code, message FROM import_issues WHERE import_id = ? AND severity IN ('error','warning') ORDER BY severity, code",
);

/** "Mango Anywhere — MG2" → "MG2"; anything else is not from Mango. */
const mangoCode = (src) => (src.startsWith(MANGO) ? src.slice(MANGO.length).trim() : null);

const summary = [];
const problems = [];
const notes = [];

for (const company of companies) {
  const snaps = currentSnapshot.all(company.id);
  const snap = snaps[0];
  if (!snap) {
    summary.push({ company, none: true });
    continue;
  }

  const ar = receivables.all(snap.id);
  const ap = payables.all(snap.id);
  const bk = banks.all(snap.id);

  const split = (list) => {
    const mango = list.filter((r) => mangoCode(r.src));
    return { mango, other: list.length - mango.length, codes: [...new Set(mango.map((r) => mangoCode(r.src)))] };
  };
  const a = split(ar), p = split(ap), b = split(bk);
  const codes = [...new Set([...a.codes, ...p.codes, ...b.codes])];

  const owed = (list) => list.reduce((sum, r) => sum + (r.a - r.b), 0);
  const found = issues.all(snap.import_id);
  const bankErrors = found.filter((i) => i.severity === 'error' && i.code.startsWith('ANYWHERE_BANK_'));

  const entry = {
    company, snap, codes,
    customers: a.mango.length, suppliers: p.mango.length,
    owedByCustomers: owed(a.mango), owedToSuppliers: owed(p.mango),
    bankAccounts: b.mango.length, bankTotal: b.mango.reduce((s, r) => s + r.a, 0),
    fromWorkbooks: { receivable: a.other, payable: p.other, bank: b.other },
    errors: found.filter((i) => i.severity === 'error'),
    warnings: found.filter((i) => i.severity === 'warning'),
  };
  summary.push(entry);

  // A figure the pull itself said it could not believe, sitting in the
  // database. The pull used to write it anyway.
  if (bankErrors.length > 0 && b.mango.length > 0) {
    problems.push({
      company,
      what: `bank balances from Mango are in the database (${b.mango.length} accounts, ${baht(entry.bankTotal)}) `
        + `although the pull flagged them: ${bankErrors[0].code}`,
      fix: 'Roll back that import in Import History, then pull again with the current code, which withholds them.',
    });
  }
  // Said once. The case above already says the total is negative and why it is
  // not to be believed; this is for a negative total nobody flagged.
  else if (b.mango.length > 0 && entry.bankTotal < 0) {
    problems.push({
      company,
      what: `Mango bank balances total ${baht(entry.bankTotal)}, a negative cash position`,
      fix: 'Either the sign is the accounting way round (confirm against one account in Mango, then --flip-bank-sign) '
        + 'or loan accounts are mixed in with the cash.',
    });
  }
  if (codes.length > 1) {
    problems.push({
      company,
      what: `rows from more than one Mango company are mixed in this snapshot: ${codes.join(', ')}`,
      fix: 'Each Mango company should map to one company here. Roll back and pull with a corrected --map.',
    });
  }
}

// ---------------------------------------------------------------- across companies
const byCode = new Map();
for (const e of summary) for (const c of e.codes ?? []) byCode.set(c, [...(byCode.get(c) ?? []), e]);
for (const [code, list] of byCode) {
  if (list.length > 1) {
    problems.push({
      company: null,
      what: `Mango ${code} is filed under ${list.length} companies here: ${list.map((e) => e.company.company_code).join(', ')}`,
      fix: 'One Mango company was mapped to several. Both sets of figures are suspect: fix --map, roll back, pull again.',
    });
  }
}

// Two companies with identical receivable and payable positions are almost
// never two companies. It is one company read twice.
const live = summary.filter((e) => !e.none && e.customers + e.suppliers > 0);
for (let i = 0; i < live.length; i++) {
  for (let j = i + 1; j < live.length; j++) {
    const x = live[i], y = live[j];
    if (x.customers === y.customers && x.suppliers === y.suppliers
      && Math.round(x.owedByCustomers) === Math.round(y.owedByCustomers)
      && Math.round(x.owedToSuppliers) === Math.round(y.owedToSuppliers)) {
      problems.push({
        company: null,
        what: `${x.company.company_code} and ${y.company.company_code} hold identical Mango positions `
          + `(${x.customers} customers owing ${baht(x.owedByCustomers)})`,
        fix: 'That is one Mango company filed twice. The session was probably not switched between them.',
      });
    }
  }
}

for (const e of summary) {
  if (e.none) notes.push(`${e.company.company_code}: nothing has been imported yet`);
  else if (e.codes.length === 0) notes.push(`${e.company.company_code}: no rows from Mango; its figures come from uploaded workbooks`);
}

// ---------------------------------------------------------------------- report
console.log(bold('\nWhat the pulls from Mango left in the database'));
console.log(`(database: ${file})\n`);

const W = [15, 6, 11, 9, 9, 17, 17, 17];
const head = ['company', 'mango', 'as of', 'customers', 'suppliers', 'owed by customers', 'owed to suppliers', 'in the bank'];
console.log(head.map((h, i) => h.padEnd(W[i])).join('  '));
console.log(W.map((w) => '-'.repeat(w)).join('  '));
for (const e of summary) {
  if (e.none) {
    console.log([e.company.company_code.padEnd(W[0]), '—'.padEnd(W[1]), 'no data'].join('  '));
    continue;
  }
  console.log([
    e.company.company_code.padEnd(W[0]),
    (e.codes.join('+') || '—').padEnd(W[1]),
    e.snap.report_date.padEnd(W[2]),
    String(e.customers).padStart(W[3]),
    String(e.suppliers).padStart(W[4]),
    baht(e.owedByCustomers).padStart(W[5]),
    baht(e.owedToSuppliers).padStart(W[6]),
    (e.bankAccounts ? baht(e.bankTotal) : 'none').padStart(W[7]),
  ].join('  '));
}

console.log('\nCompare "owed by customers" and "owed to suppliers" with the same lines of a');
console.log('`--dry-run` for that Mango company. They are computed the same way and must match.');

const withErrors = summary.filter((e) => !e.none && e.errors.length > 0);
if (withErrors.length > 0) {
  console.log(bold('\nFindings recorded with the current import'));
  for (const e of withErrors) {
    for (const i of e.errors) console.log(`  ${e.company.company_code}  error    ${i.code}`);
  }
}

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
