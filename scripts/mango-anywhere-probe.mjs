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

/**
 * Where the answers are.
 *
 * Mango is three applications on one host, and this took a while to see. The
 * estate module serves its own data; `production.anywhere` is a Vue front end
 * and serves pages only; and `production.service` is what that front end
 * actually calls. Asking the front end for endpoints returns 404 for every
 * name ever tried, which is exactly what happened — correctly, and for a
 * reason no amount of better guessing would have reached.
 */
const service = (process.env.MANGO_SERVICE_URL ?? `${HOST}/production.service`).replace(/\/+$/, '');

/**
 * The modules, as the front end names them.
 *
 * Taken from the screens the survey already found — `page/transaction/fin/...`
 * is asked for as `module_=FIN` — plus the ones an accounting system of this
 * shape always has. One call each, rather than a hundred and fifty guesses.
 */
const MODULES = (flag('modules') ?? 'FIN,AP,AR,GL,FA,IC,PO,RT,MA,OS,BG,CQ,PR,ST,PJ')
  .split(',').map((m) => m.trim().toUpperCase()).filter(Boolean);
const entry = flag('entry', 'page/');
const limit = Number(flag('limit', 150));
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

/**
 * Names that say outright that they read.
 *
 * Mango calls most of its own endpoints with `$_post`, so a GET to one
 * answers 404 — the route exists and the verb does not match, which is
 * indistinguishable from no route at all. Asking again with POST is therefore
 * necessary, and is the one place this survey could do harm.
 *
 * So the POST attempt runs off a list of names that are reads, rather than off
 * the absence of a name that writes. "Not obviously a write" is not good
 * enough to justify posting to an endpoint nobody here has ever seen.
 */
const READS = /(readlist|read_list|_read\b|_list\b|getlist|_get\b|search|lookup|count|combo|dropdown|select_|_rpt|report|balance|summary|detail)/i;

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
/**
 * Scripts still to read.
 *
 * A Vue application this size splits itself: the shell loads a main bundle,
 * and each screen's code — with its endpoints — arrives in a chunk of its own,
 * named inside that bundle. Reading only what the HTML lists reaches the shell
 * and stops one file short of everything worth finding.
 */
const scriptQueue = [];
const SCRIPT_PATTERN = /["'`]([A-Za-z0-9_./-]+\.js)(?:\?[^"'`]*)?["'`]/g;

const queueScript = (src) => {
  if (!src) return;
  if (/^https?:\/\//i.test(src) && !src.includes('mangoanywhere')) return;
  if (/(vue|jquery|bootstrap|kendo|moment|chart|polyfill|popper|lodash|axios|require|runtime)[.-]/i.test(src)) return;

  const path = src.replace(/^.*?\/production\.[a-z]+\//i, '').replace(/^\//, '').split('?')[0];
  if (!path || scanned.has(path) || scriptQueue.includes(path)) return;
  scriptQueue.push(path);
};

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

  for (const match of text.matchAll(SCRIPT_PATTERN)) queueScript(match[1]);

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

  const sources = [...answer.text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
  for (const src of sources) queueScript(src);
  if (sources.length > 0) console.log(`   ${''.padEnd(24)} ${sources.length} scripts listed`);

  return answer;
};

/**
 * Work through the scripts, including the ones the scripts name.
 *
 * Bounded, because a bundle can name a great many chunks and this is somebody
 * else's production server.
 */
const readScripts = async (max) => {
  let read = 0;

  while (scriptQueue.length > 0 && read < max) {
    const path = scriptQueue.shift();
    if (scanned.has(path)) continue;
    scanned.add(path);

    let script;
    try {
      script = await client.raw(path);
    } catch {
      continue;
    }
    if (script.status >= 400 || !script.text) continue;

    read += 1;
    const found = scan(script.text, path);
    if (found.confident || found.loose) {
      console.log(`     ${path.slice(-52).padEnd(54)} ${found.confident} named, ${found.loose} possible`);
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  return read;
};

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

// ------------------------------------------------------- the service's menu

/**
 * Ask the service what each module contains.
 *
 * `Anywhere/Center/MenuDisplay` is what the front end calls to draw its own
 * navigation, so it is the system describing itself — one authoritative answer
 * per module, in place of guessing at names and counting 404s.
 */
console.log(bold(`\n── Asking ${service} for each module's menu`));

const menus = [];
for (const module of MODULES) {
  const url = `${service}/Anywhere/Center/MenuDisplay?module_=${encodeURIComponent(module)}&lang_code=EN`;

  let answer;
  try {
    answer = await client.raw(url);
  } catch (err) {
    console.log(`   ${module.padEnd(5)} could not be read: ${err.message}`);
    continue;
  }

  if (!answer.contentType.includes('json')) {
    console.log(`   ${module.padEnd(5)} ${answer.status} ${answer.contentType.split(';')[0] || '—'}`);
    continue;
  }

  let body;
  try {
    body = JSON.parse(answer.text);
  } catch {
    console.log(`   ${module.padEnd(5)} answered JSON that will not parse`);
    continue;
  }

  const payload = body && typeof body === 'object' && 'success' in body ? body.data : body;
  if (body?.success === false) {
    console.log(`   ${module.padEnd(5)} refused: ${body.error ?? 'no reason given'}`);
    continue;
  }

  menus.push({ module, payload });
  console.log(`   ${module.padEnd(5)} ${shapeOf(payload)}`);

  // Menu entries name the screens, and screens are named after their data.
  scan(JSON.stringify(payload), `MenuDisplay:${module}`);
  await new Promise((r) => setTimeout(r, 250));
}

if (menus.length === 0) {
  console.log('\n   Nothing answered. If these are 401s the service wants the x-mango-auth');
  console.log('   header as well as the cookies — set MANGO_AUTH_TOKEN and run again.');
  console.log(`   The sign-in answered: ${JSON.stringify(client.loginAnswer ?? {}).slice(0, 300)}`);
} else if (savePath) {
  fs.writeFileSync(savePath, JSON.stringify(menus, null, 1), 'utf8');
  console.log(`\n   menus written to ${savePath}`);
}

console.log(bold('\n── Reading the pages, and the scripts they load'));

for (const page of [entry, '', 'page/', 'Home/Index']) {
  await readPage(page, page || '/');
}

const scriptsRead = await readScripts(Number(flag('scripts', 40)));
console.log(`   read ${scriptsRead} script${scriptsRead === 1 ? '' : 's'}`
  + `${scriptQueue.length > 0 ? `, ${scriptQueue.length} more named but not read (--scripts to raise)` : ''}`);

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

/**
 * A route is not an endpoint.
 *
 * This module routes in the browser: `page/transaction/ap/v_ap_senddoc` is a
 * screen Vue draws, not something the server answers. Asking for one returns
 * 404 every time, which is how a survey spends its whole budget learning
 * nothing and reports that the module is empty.
 *
 * They are worth more than that, though — read together they are a map of
 * what the module does, which is the thing actually worth knowing first.
 */
const isRoute = (path) => /^(page|transaction|report|master|setting|inquiry)\//i.test(path);
const looksLikeData = (path) => /(_data\/|readlist|_list\b|\/read|^api\/|_rpt\/|x\/)/i.test(path);

const routes = [...discovered].filter(([path]) => isRoute(path));
const callable = [...discovered].filter(([path]) => !isRoute(path));

const safe = callable.filter(([path]) => !MUTATES.test(path));
const skipped = callable.filter(([path]) => MUTATES.test(path));

// Ask the likeliest first: what Mango was seen calling, then what is shaped
// like one of its data endpoints, then the rest.
const rank = ([path, meta]) => (meta.confident ? 0 : 2) + (looksLikeData(path) ? 0 : 1);
safe.sort((a, b) => rank(a) - rank(b));

const named = safe.filter(([, meta]) => meta.confident).length;
console.log(`\n   ${discovered.size} names · ${routes.length} screens · ${callable.length} callable `
  + `(${named} named outright, ${skipped.length} skipped as writes)`);

/**
 * The map of the module, drawn from its screen names.
 *
 * Mango names its screens `page/<kind>/<module>/<screen>`, so grouping them
 * says what this application is for — and that is a finding in its own right,
 * whether or not a single endpoint answers.
 */
if (routes.length > 0) {
  const MODULES = {
    ap: 'accounts payable', ar: 'accounts receivable', gl: 'general ledger',
    fa: 'fixed assets', ic: 'inventory', po: 'purchase orders', pr: 'payroll',
    rt: 'retention', ma: 'maintenance', os: 'outsourcing', bg: 'budget',
    cq: 'cheques', wh: 'withholding tax', pj: 'projects', st: 'stock',
  };

  const tree = new Map();
  for (const [path] of routes) {
    // Both spellings appear: the front end's own links carry a `page/` prefix
    // and the menu the service returns does not.
    const parts = path.replace(/^page\//i, '').split('/');
    const kind = parts[0] ?? '—';
    const module = parts.length > 2 ? parts[1] : '—';
    const key = `${kind}/${module}`;
    tree.set(key, (tree.get(key) ?? 0) + 1);
  }

  console.log(bold('\n── What this module is, judging by its screens'));
  const byModule = new Map();
  for (const [key, count] of tree) {
    const module = key.split('/')[1];
    byModule.set(module, (byModule.get(module) ?? 0) + count);
  }

  for (const [module, count] of [...byModule].sort((a, b) => b[1] - a[1])) {
    const name = MODULES[module];
    console.log(`   ${module.padEnd(6)} ${String(count).padStart(4)} screens${name ? `   ${name}` : ''}`);
  }

  console.log('\n   Screens are drawn in the browser, so they are not asked for here — they');
  console.log('   answer 404 by design. What they show is what this module covers.');
}

if (safe.length === 0) {
  console.log('\n   Nothing to follow. The page may load its script from a separate file —');
  console.log('   rerun with --entry <path> pointing at a page that shows data.');
  process.exit(0);
}

// ------------------------------------------------------------------- probe

console.log(bold(`\n── Asking the callable ones what they hold (${Math.min(safe.length, limit)} of ${safe.length})`));

const findings = [];
for (const [path, meta] of safe.slice(0, limit)) {
  const where = meta.where;
  let answer;
  let verb = 'GET';
  try {
    answer = await client.raw(path);

    // A 404 from an endpoint that exists but only answers POST looks exactly
    // like no endpoint at all. Ask again, but only where the name says read.
    if ((answer.status === 404 || answer.status === 405) && READS.test(path) && !MUTATES.test(path)) {
      const posted = await client.raw(path, { method: 'POST', body: {} });
      if (posted.contentType.includes('json') || posted.status < 400) {
        answer = posted;
        verb = 'POST';
      } else {
        // Worth showing that both were tried: "GET 404" alone leaves a reader
        // wondering whether the verb was the problem.
        verb = 'both';
      }
    }
  } catch (err) {
    console.log(`   ${path.padEnd(52)} could not be read: ${err.message}`);
    continue;
  }

  const isJson = answer.contentType.includes('json');
  if (!isJson) {
    // Printed rather than tallied silently: a list of what was asked is what
    // makes "nothing answered" checkable by somebody who knows the system.
    // Without it the survey cannot be told apart from one asking nonsense.
    console.log(`   ${path.slice(0, 52).padEnd(54)} ${verb.padEnd(4)} ${answer.status}`);
    findings.push({ path, where, status: answer.status, kind: answer.contentType.split(';')[0], verb });
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
    findings.push({ path, where, status: answer.status, kind: 'refused', error: String(body.error ?? ''), verb });
    console.log(`\n   ${path}  (${verb})\n     refused: ${body.error ?? 'no reason given'}`);
    await new Promise((r) => setTimeout(r, 250));
    continue;
  }

  const payload = envelope ? body.data : body;
  const shape = shapeOf(payload);
  findings.push({ path, where, status: answer.status, kind: 'json', shape });

  console.log(`\n   ${bold(path)}  (${verb})`);
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

/**
 * The ones that are not simply absent.
 *
 * A 404 is the answer for a name that was never an endpoint, and a survey
 * that finds nothing but 404s has learned that its names were wrong. Anything
 * else — a 400 wanting parameters, a 401 or 403 about rights, a 500 that got
 * far enough to break — is an endpoint that exists. One of those is worth more
 * than the other hundred and forty-eight put together, so it does not get
 * averaged into a tally.
 */
const exists = findings.filter((f) => f.kind !== 'json' && f.status !== 404);
if (exists.length > 0) {
  console.log(bold('\n── These exist — they answered something other than "no such thing"'));
  for (const finding of exists) {
    console.log(`   ${finding.path}`);
    console.log(`     ${finding.verb} → ${finding.status}. `
      + `${finding.status === 400 ? 'It wanted parameters nobody supplied, which means the route is real.'
        : finding.status === 401 || finding.status === 403 ? 'It exists and this account may not have it.'
        : 'It got far enough to fail rather than to be missing.'}`);
  }
}

if (useful.length === 0 && findings.length > 0) {
  const asked = findings.map((f) => f.path);
  console.log(bold('\n── What was asked, so the guesses can be judged'));
  for (const path of asked.slice(0, 40)) console.log(`   ${path}`);
  if (asked.length > 40) console.log(`   … and ${asked.length - 40} more`);
  console.log('\n   If these do not look like endpoints of this system, the names are wrong');
  console.log('   and no amount of asking will help. One real URL settles it: open a screen');
  console.log('   that lists something, F12 → Network → Fetch/XHR, and read one request off it.');
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

if (menus.length > 0) {
  const total = menus.reduce((sum, m) => sum + (Array.isArray(m.payload) ? m.payload.length : 0), 0);
  console.log(bold(`\n── ${menus.length} modules described themselves, ${total} menu entries in all`));
  console.log('   That is the system saying what it holds, rather than this guessing at it.');
  console.log('   Run again with --save menus.json to keep the whole answer.');
}

console.log('\n   Paste the section above back and the mapping can be written against it.\n');
