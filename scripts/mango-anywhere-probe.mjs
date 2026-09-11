/**
 * Survey a Mango module nobody here has mapped yet, and report its shape.
 *
 *   node --import ./scripts/register-ts.mjs scripts/mango-anywhere-probe.mjs
 *
 * `production.re` is the estate-sales module and this system already reads it.
 * `production.anywhere` is the other one, and if it holds what its name
 * suggests — budgets, commitments, progress — it covers the part of every
 * project that is still typed in by hand: cost budget, revised budget and
 * committed cost.
 *
 * Nobody can say that from here, because the development container cannot
 * reach Mango at all. So this exists to be run from somewhere that can, and to
 * answer the question in a form that can be pasted back.
 *
 * Three rules it keeps:
 *
 *   It discovers rather than guesses. Mango's Vue pages name the endpoints
 *   they call, so the page is read and those names are followed. Inventing
 *   plausible URLs produces a wall of 404s and teaches nothing.
 *
 *   It reads and never writes. Anything whose name suggests it changes
 *   something is skipped without being called, listed at the end so the
 *   skipping is visible rather than silent.
 *
 *   It prints structure, not content. Column names and row counts, never the
 *   values in them — the output is meant to be pasted into a chat, and this
 *   is a live finance system.
 *
 * Environment: MANGO_BASE_URL is ignored; set MANGO_ANYWHERE_URL to point
 * elsewhere. MANGO_USER, MANGO_PASS and MANGO_MAINCODE are as ever.
 */

import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : fallback;
};

const HOST = 'https://chaithanin.mangoanywhere.com';
const base = (process.env.MANGO_ANYWHERE_URL ?? `${HOST}/production.anywhere`).replace(/\/+$/, '');
const entry = flag('entry', 'page/');
const limit = Number(flag('limit', 60));
const savePath = flag('save');

const bold = (s) => `\x1b[1m${s}\x1b[0m`;

const { MangoClient, credentialsFromEnv, MangoError } =
  await import('../src/lib/sources/mango/client.ts');

/**
 * Where to sign in.
 *
 * This module has no sign-in page of its own — it answers 404 for one. The
 * session is shared across Mango's modules, so the sign-in happens at the
 * estate module, which does have one, and the cookies are carried across.
 */
const loginBase = (process.env.MANGO_LOGIN_URL ?? process.env.MANGO_BASE_URL ?? `${HOST}/production.re`)
  .replace(/\/+$/, '');

let credentials;
try {
  credentials = { ...credentialsFromEnv(), baseUrl: base, loginBaseUrl: loginBase };
} catch (err) {
  console.error(err instanceof MangoError ? err.message : err);
  process.exit(2);
}

console.log(bold(`\n── Surveying ${base}`));
console.log(`   as ${credentials.username} · company ${credentials.maincode}`);
if (loginBase !== base) console.log(`   signing in at ${loginBase}, which is where the login page is`);

const client = new MangoClient(credentials);
try {
  await client.login();
} catch (err) {
  console.error(`\n   ${err.message}`);
  console.error('\n   Point MANGO_LOGIN_URL at whichever module does have a sign-in page,');
  console.error('   or MANGO_ANYWHERE_URL at the right address for this one.');
  process.exit(1);
}
console.log('   signed in');

// ---------------------------------------------------------------- discover

/**
 * Anything that looks like it changes something is never called.
 *
 * Read-only is the whole basis on which this connects to a finance system at
 * all, and a survey is exactly where an accident would happen — a name like
 * `approve_all` is one GET away from being a bad afternoon.
 */
const MUTATES = /(save|update|delete|remove|insert|create|edit|upload|import|approve|reject|cancel|submit|confirm|post_|_post$|_do$|send|print|export)/i;

const CANDIDATE = /["'`](?:\/)?((?:[a-z][a-z0-9_]*\/){1,3}[A-Za-z][A-Za-z0-9_]*)["'`]/g;

const discovered = new Map();
const note = (path, where) => {
  const clean = path.replace(/^\/+/, '');
  if (!clean.includes('/')) return;
  if (/\.(js|css|png|jpe?g|svg|gif|woff2?|map|ico)$/i.test(clean)) return;
  if (!discovered.has(clean)) discovered.set(clean, where);
};

console.log(bold('\n── Reading the pages for the endpoints they call'));

for (const page of [entry, '', 'page/', 'Home/Index']) {
  try {
    const answer = await client.raw(page);
    console.log(`   ${(page || '/').padEnd(20)} ${answer.status} ${answer.contentType.split(';')[0]} `
      + `${answer.text.length.toLocaleString()} bytes`);
    if (!answer.text || answer.status >= 400) continue;

    let found = 0;
    for (const match of answer.text.matchAll(CANDIDATE)) {
      const before = discovered.size;
      note(match[1], page || '/');
      if (discovered.size > before) found += 1;
    }
    if (found) console.log(`   ${''.padEnd(20)} ${found} endpoint names in this page`);
  } catch (err) {
    console.log(`   ${(page || '/').padEnd(20)} could not be read: ${err.message}`);
  }
}

/**
 * A second pass, through the pages the first one found.
 *
 * A module root loads a shell; the endpoints that matter are named by the
 * screens underneath it. Stopping at the root finds almost nothing, which is
 * indistinguishable from a module that holds almost nothing — so anything that
 * answers HTML is treated as another page to read rather than as a failure.
 */
console.log(bold('\n── Following the pages those named'));

const pagesToRead = [...discovered.keys()].slice(0, limit);
let reached = 0;

for (const candidate of pagesToRead) {
  if (MUTATES.test(candidate)) continue;

  let answer;
  try {
    answer = await client.raw(candidate);
  } catch {
    continue;
  }
  if (answer.status >= 400 || answer.contentType.includes('json') || !answer.text) continue;

  reached += 1;
  let found = 0;
  for (const match of answer.text.matchAll(CANDIDATE)) {
    const before = discovered.size;
    note(match[1], candidate);
    if (discovered.size > before) found += 1;
  }
  if (found) console.log(`   ${candidate.padEnd(40)} named ${found} more`);
  await new Promise((r) => setTimeout(r, 200));
}
console.log(`   read ${reached} further page${reached === 1 ? '' : 's'}`);

// The two that every Mango module has, worth confirming even if no page named them.
for (const known of ['api/public/AuthStatus', 'rex_rpt/MenuReportReadList']) note(known, 'known');

const safe = [...discovered].filter(([path]) => !MUTATES.test(path));
const skipped = [...discovered].filter(([path]) => MUTATES.test(path));

console.log(`\n   ${discovered.size} candidates · ${safe.length} read-only · ${skipped.length} skipped as writes`);

if (safe.length === 0) {
  console.log('\n   Nothing to follow. The page may load its script from a separate file —');
  console.log('   rerun with --entry <path> pointing at a page that shows data.');
  process.exit(0);
}

// ------------------------------------------------------------------- probe

/** Column names and counts. Never a value: this output gets pasted around. */
const shapeOf = (value, depth = 0) => {
  if (value === null || value === undefined) return 'nothing';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'empty list';
    const first = value[0];
    if (first && typeof first === 'object') {
      const keys = Object.keys(first);
      return `${value.length} rows · ${keys.length} columns: ${keys.slice(0, 14).join(', ')}`
        + (keys.length > 14 ? ', …' : '');
    }
    return `${value.length} values`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (depth > 0) return `object with ${entries.length} keys`;
    return `${entries.length} keys:`
      + entries.map(([k, v]) => `\n       ${k}: ${shapeOf(v, depth + 1)}`).join('');
  }
  return typeof value;
};

console.log(bold(`\n── Asking each one what it holds (${Math.min(safe.length, limit)} of ${safe.length})`));

const findings = [];
for (const [path, where] of safe.slice(0, limit)) {
  let answer;
  try {
    answer = await client.raw(path);
  } catch (err) {
    console.log(`\n   ${path}\n     could not be read: ${err.message}`);
    continue;
  }

  const isJson = answer.contentType.includes('json');
  if (!isJson) {
    // HTML here means signed out or not permitted — never an empty dataset.
    findings.push({ path, where, status: answer.status, kind: answer.contentType.split(';')[0] });
    continue;
  }

  let body;
  try {
    body = JSON.parse(answer.text);
  } catch {
    continue;
  }

  const envelope = body && typeof body === 'object' && 'success' in body;
  if (envelope && body.success === false) {
    // Not a finding about the data — a finding about this account's rights, or
    // an endpoint that wants parameters nobody has supplied yet.
    findings.push({ path, where, status: answer.status, kind: 'refused', error: String(body.error ?? '') });
    console.log(`\n   ${path}\n     refused: ${body.error ?? 'no reason given'}`);
    await new Promise((r) => setTimeout(r, 250));
    continue;
  }

  const payload = envelope ? body.data : body;
  const shape = shapeOf(payload);
  findings.push({ path, where, status: answer.status, kind: 'json', shape });

  console.log(`\n   ${bold(path)}`);
  console.log(`     ${shape}`);

  // Courtesy: this is somebody's production server and it logs every call.
  await new Promise((r) => setTimeout(r, 250));
}

const useful = findings.filter((f) => f.kind === 'json');
console.log(bold(`\n── ${useful.length} endpoints answered data`));

if (skipped.length > 0) {
  console.log(`\n   Not called, because the name says they change something:`);
  console.log(`     ${skipped.map(([p]) => p).join(', ')}`);
}

if (savePath) {
  fs.writeFileSync(savePath, JSON.stringify(findings, null, 1), 'utf8');
  console.log(`\n   written to ${savePath}`);
}

console.log('\n   Paste the section above back and the mapping can be written against it.\n');
