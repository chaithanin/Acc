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
const note = (path, where, confident = false) => {
  const clean = path.replace(/^\/+/, '').split('?')[0];
  if (!clean.includes('/') || clean.length > 120) return;
  if (/^https?:/i.test(clean)) return;
  if (/\.(js|css|png|jpe?g|svg|gif|woff2?|map|ico|html?)$/i.test(clean)) return;

  const held = discovered.get(clean);
  // A path named outright beats the same path merely spotted in a bundle.
  if (!held || (confident && !held.confident)) discovered.set(clean, { where, confident });
};

/**
 * The names a page calls, in two tiers.
 *
 * Mango's own calls go through `$_get` / `$_post`, so a string sitting inside
 * one of those is an endpoint and not a guess. Everything else that merely
 * looks like a path is kept too, but separately — in a bundled application
 * most of those are asset paths and route names, and mixing the two turns a
 * short list of real answers into a long list of 404s.
 */
const CALLED = /\$_(?:post|get|ajax|download)\s*\([^)]{0,200}?["'`]([^"'`]+)["'`]/g;
const URL_FIELD = /\b(?:url|action|endpoint|api)\s*:\s*["'`]([^"'`]+)["'`]/g;

const scanned = new Set();

const scan = (text, where) => {
  let confident = 0;
  let loose = 0;

  for (const pattern of [CALLED, URL_FIELD]) {
    for (const match of text.matchAll(pattern)) {
      const before = discovered.size;
      note(match[1], where, true);
      if (discovered.size > before) confident += 1;
    }
  }

  for (const match of text.matchAll(CANDIDATE)) {
    const before = discovered.size;
    note(match[1], where, false);
    if (discovered.size > before) loose += 1;
  }

  return { confident, loose };
};

/**
 * Read a page, then read the scripts it loads.
 *
 * This is the part that was missing, and it is most of the job. The module is
 * a Vue application: its pages are a shell of a few kilobytes and every
 * endpoint name lives in the bundle they pull in. Reading only the HTML finds
 * two names and concludes the module holds nothing, which is exactly the wrong
 * conclusion to hand somebody.
 */
const readPage = async (path, label = path) => {
  if (scanned.has(path)) return null;
  scanned.add(path);

  let answer;
  try {
    answer = await client.raw(path);
  } catch (err) {
    console.log(`   ${label.padEnd(24)} could not be read: ${err.message}`);
    return null;
  }

  const type = answer.contentType.split(';')[0] || '—';
  console.log(`   ${label.padEnd(24)} ${answer.status} ${type.padEnd(10)} ${answer.text.length.toLocaleString()} bytes`);

  // A redirect is a signpost: read where it points.
  if (answer.status >= 300 && answer.status < 400) {
    const target = (answer.text.match(/href="([^"]+)"/i) ?? [])[1];
    if (target) await readPage(target.replace(/^.*?\/production\.[a-z]+\//i, ''), `↳ ${target}`);
    return answer;
  }

  if (answer.status >= 400 || !answer.text) return answer;

  const { confident, loose } = scan(answer.text, path || '/');
  if (confident || loose) {
    console.log(`   ${''.padEnd(24)} ${confident} named outright, ${loose} more that look like paths`);
  }

  // Now the scripts. Same host only, and never the vendor bundles — those are
  // megabytes of framework with no Mango endpoint in them.
  const sources = [...answer.text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
  const ours = sources.filter((src) => !/^https?:\/\//i.test(src) || src.includes('mangoanywhere'))
    .filter((src) => !/(vue|jquery|bootstrap|kendo|moment|chart|polyfill|popper|lodash|axios)[.-]/i.test(src));

  if (sources.length > 0) {
    console.log(`   ${''.padEnd(24)} ${sources.length} scripts, reading ${Math.min(ours.length, 12)}`);
  }

  for (const src of ours.slice(0, 12)) {
    const scriptPath = src.replace(/^.*?\/production\.[a-z]+\//i, '').replace(/^\//, '');
    if (scanned.has(scriptPath)) continue;
    scanned.add(scriptPath);

    let script;
    try {
      script = await client.raw(scriptPath);
    } catch {
      continue;
    }
    if (script.status >= 400 || !script.text) continue;

    const found = scan(script.text, scriptPath);
    if (found.confident || found.loose) {
      console.log(`     ${scriptPath.slice(-46).padEnd(48)} ${found.confident} named, ${found.loose} possible`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  return answer;
};

console.log(bold('\n── Reading the pages, and the scripts they load'));

for (const page of [entry, '', 'page/', 'Home/Index']) {
  await readPage(page, page || '/');
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

const pagesToRead = [...discovered.keys()].filter((path) => !MUTATES.test(path)).slice(0, limit);
let reached = 0;

for (const candidate of pagesToRead) {
  if (scanned.has(candidate)) continue;
  const answer = await readPage(candidate);
  if (answer && answer.status < 400 && !answer.contentType.includes('json')) reached += 1;
  await new Promise((r) => setTimeout(r, 150));
}
console.log(`   read ${reached} further page${reached === 1 ? '' : 's'}`);

// The two that every Mango module has, worth confirming even if no page named them.
for (const known of ['api/public/AuthStatus', 'rex_rpt/MenuReportReadList']) note(known, 'known');

const safe = [...discovered].filter(([path]) => !MUTATES.test(path));
const skipped = [...discovered].filter(([path]) => MUTATES.test(path));

// Named-outright first: those are Mango's own calls and the likeliest to answer.
safe.sort((a, b) => Number(b[1].confident) - Number(a[1].confident));

const named = safe.filter(([, meta]) => meta.confident).length;
console.log(`\n   ${discovered.size} candidates · ${named} named outright · `
  + `${safe.length - named} spotted in passing · ${skipped.length} skipped as writes`);

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
for (const [path, meta] of safe.slice(0, limit)) {
  const where = meta.where;
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
console.log(bold(`\n── ${useful.length} endpoint${useful.length === 1 ? '' : 's'} answered data`));

/**
 * What everything else said.
 *
 * "0 endpoints answered data" on its own is not a finding, it is the absence
 * of one — it cannot be told apart from a module that holds nothing, a survey
 * that looked in the wrong place, or a session that quietly lapsed. The tally
 * below is what makes those three distinguishable.
 */
const tally = new Map();
for (const finding of findings) {
  if (finding.kind === 'json') continue;
  const label = finding.kind === 'refused' ? `refused: ${finding.error || 'no reason'}`
    : `${finding.status} ${finding.kind}`;
  tally.set(label, (tally.get(label) ?? 0) + 1);
}

if (tally.size > 0) {
  console.log('\n   The rest answered:');
  for (const [label, count] of [...tally].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${String(count).padStart(4)} × ${label}`);
  }

  if ([...tally.keys()].some((k) => /text\/html/.test(k))) {
    console.log('\n   HTML where JSON was expected means the session lapsed or this account may');
    console.log('   not see it — never that the endpoint is empty. If everything answered HTML,');
    console.log('   the survey found pages rather than endpoints: try --entry on a screen that');
    console.log('   shows data, and check that the account can open this module at all.');
  }
}

if (skipped.length > 0) {
  console.log(`\n   Not called, because the name says they change something:`);
  console.log(`     ${skipped.map(([p]) => p).join(', ')}`);
}

if (useful.length === 0 && discovered.size < 10) {
  console.log('\n   Almost nothing was found to ask. That usually means the endpoint names live');
  console.log('   in a script this did not reach — run again with --save findings.json and');
  console.log('   --entry pointing at a screen that actually lists something.');
}

if (savePath) {
  fs.writeFileSync(savePath, JSON.stringify(findings, null, 1), 'utf8');
  console.log(`\n   written to ${savePath}`);
}

console.log('\n   Paste the section above back and the mapping can be written against it.\n');
