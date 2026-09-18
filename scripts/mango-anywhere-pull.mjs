/**
 * Read the accounting figures out of Mango Anywhere, through a real browser.
 *
 *   node scripts/mango-anywhere-pull.mjs --dry-run
 *
 * Why a browser, when there is an API. There is one — production.service — and
 * its figures are reachable. But the calls that point a session at a company
 * want an `x-mango-auth` header, and that token is bound to the session that
 * minted it: signing in from a script gets cookies the service accepts for
 * `api/public` and refuses for everything else, and a token lifted from
 * somebody's browser is refused too, because it belongs to their session.
 *
 * What mints it is the front end's own JavaScript. So this runs the front end.
 *
 * It is emphatically **not** screen scraping. Nothing here reads a rendered
 * table, waits for a grid to paint, or clicks through a report. The browser is
 * used for one thing — to sign in and let the application authenticate itself —
 * and then the token it minted is taken off its own network traffic and used to
 * call the same JSON endpoints the application calls. The data arrives as JSON
 * with its columns intact, and a redesigned screen cannot break it.
 *
 * Environment:
 *   MANGO_USER, MANGO_PASS   a service account, not a person's login
 *   MANGO_MAINCODE           the company to read; MG1..MG6 (default MG1)
 *   MANGO_ANYWHERE_URL       optional, defaults to the published address
 *   MANGO_SERVICE_URL        optional
 *
 * Flags:
 *   --company <code>    which company in the dashboard the data belongs to
 *   --date YYYY-MM-DD   the date to file it under (default: today)
 *   --all-companies     walk every company this account can open
 *   --dry-run           fetch, map and report; write nothing
 *   --save <file>       write the raw answers to disk, for inspection
 *   --headed            show the browser, for watching it work
 *
 * Needs Chromium. Where Playwright's own is not installed:
 *   npx playwright install --with-deps chromium
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const HOST = 'https://chaithanin.mangoanywhere.com';
const anywhere = (process.env.MANGO_ANYWHERE_URL ?? `${HOST}/production.anywhere`).replace(/\/+$/, '');
const service = (process.env.MANGO_SERVICE_URL ?? `${HOST}/production.service`).replace(/\/+$/, '');

const companyCode = flag('company');
const reportDate = flag('date') ?? new Date().toISOString().slice(0, 10);
const dryRun = has('dry-run');
const savePath = flag('save');
const maincode = (process.env.MANGO_MAINCODE ?? 'MG1').toUpperCase();

if (!dryRun && !companyCode) {
  console.error('Which company is this for? Pass --company <code>, or --dry-run to only look.');
  process.exit(2);
}

const user = process.env.MANGO_USER?.trim();
const pass = process.env.MANGO_PASS;
if (!user || !pass) {
  console.error('MANGO_USER and MANGO_PASS are not set. Use a service account, not a person’s login.');
  process.exit(2);
}
if (/^<.*>$|^(your|xxx+|changeme|placeholder)/i.test(user) || /^[…．.\-_*·•]+$/.test(user)) {
  console.error('MANGO_USER still holds the placeholder from the instructions.');
  process.exit(2);
}

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const money = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n));

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    console.error('Playwright is not installed here. Run: npm ci');
    process.exit(2);
  }
}

/**
 * The endpoints to read, and what each is.
 *
 * Every one was observed being called by the finance dashboard itself. The
 * chat poller, the print warm-up and API/Public/UserInsertLogs were observed
 * too and are deliberately absent: the first says nothing about money, the
 * second exists to have an effect, and the third writes to an audit trail.
 */
const READS = [
  ['receivable balances', 'anywhereAPI/Dashboard/balanceArReadList', { startDate: '{date}', field: 'mainname', text: '' }],
  ['payable balances', 'anywhereAPI/Dashboard/balanceApReadList', { startDate: '{date}', field: 'mainname', text: '' }],
  ['receivables by month', 'anywhereAPI/Dashboard/viewArRead', { type: 'MONTH' }],
  ['payables by month', 'anywhereAPI/Dashboard/viewApRead', { type: 'MONTH' }],
  ['receivable ageing', 'anywhereAPI/Dashboard/BarchartArRead', { today: '{date}', startDate: '{date}' }],
  ['payable ageing', 'anywhereAPI/Dashboard/BarchartAPRead', { today: '{date}', startDate: '{date}' }],
  ['receivables, year to date', 'anywhereAPI/Dashboard/yearDetailARRead', {}],
  ['payables, year to date', 'anywhereAPI/Dashboard/yearDetailAPRead', {}],
  ['bank balances', 'anywhereAPI/Dashboard/view_bank_all_v2', { bank_guarantee: 'N', company_code: '{company}', chq_date: '{date}' }],
  ['bank guarantees', 'anywhereAPI/Dashboard/view_bank_all_v2', { bank_guarantee: 'Y', company_code: '{company}', chq_date: '{date}' }],
];

/** Column names and row counts. Never a value — this output gets pasted around. */
const shapeOf = (value) => {
  if (value === null || value === undefined) return 'nothing';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'empty';
    const first = value[0];
    if (first && typeof first === 'object') {
      const keys = Object.keys(first);
      return `${value.length} rows · ${keys.length} columns: ${keys.slice(0, 16).join(', ')}`
        + (keys.length > 16 ? ', …' : '');
    }
    return `${value.length} values`;
  }
  if (typeof value === 'object') {
    const rows = value.data ?? value.rows;
    if (Array.isArray(rows)) return `${shapeOf(rows)}${'total' in value ? ` (total ${value.total})` : ''}`;
    return `${Object.keys(value).length} keys: ${Object.keys(value).slice(0, 12).join(', ')}`;
  }
  return String(value);
};

console.log(bold(`\n── Mango Anywhere · ${anywhere}`));
console.log(`   as ${user} · company ${maincode}`);

/**
 * Find a Chromium, wherever this machine keeps one.
 *
 * Playwright looks for the exact build its own version was released with, and
 * a machine that already has a Chromium — a CI image, a container, a developer
 * who installed one — has a different one. That mismatch is not a missing
 * browser, and the error Playwright raises for it sends people to reinstall
 * something they already have.
 */
/**
 * Is this a real browser, or a script standing where one should be?
 *
 * On Ubuntu `chromium` and `chromium-browser` are transitional packages whose
 * binaries are shell scripts that hand off to a Snap. In a hosted shell the
 * Snap cannot run, and the failure arrives as "the browser has been closed" —
 * which reads as a crash rather than as the wrong file entirely. An executable
 * that begins with a shebang is not a browser, and saying so is worth more
 * than any amount of retrying.
 */
const looksLikeAScript = (file) => {
  try {
    const handle = fs.openSync(file, 'r');
    const head = Buffer.alloc(2);
    fs.readSync(handle, head, 0, 2, 0);
    fs.closeSync(handle);
    return head.toString('latin1') === '#!';
  } catch {
    return false;
  }
};

const findChromium = () => {
  // Checked rather than trusted: an override naming a file that is not there
  // otherwise fails several steps later as "executable doesn't exist", which
  // reads as a bug in the lookup rather than a typo in the variable.
  if (process.env.CHROMIUM_PATH) {
    const named = process.env.CHROMIUM_PATH;
    if (!fs.existsSync(named)) {
      console.error(`\n   CHROMIUM_PATH points at ${named}, and there is nothing there.`);
      process.exit(2);
    }
    return named;
  }

  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers', '/ms-playwright']
    .filter(Boolean);

  for (const root of roots) {
    let entries;
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    // Newest build first, and the full browser before the headless shell: the
    // shell cannot run a page that wants a real window.
    const candidates = entries
      .filter((name) => /^chromium/.test(name))
      .sort((a, b) => (a.includes('headless') ? 1 : 0) - (b.includes('headless') ? 1 : 0)
        || b.localeCompare(a, undefined, { numeric: true }));

    for (const name of candidates) {
      for (const relative of ['chrome-linux/chrome', 'chrome-linux/headless_shell',
        'chrome-headless-shell-linux64/chrome-headless-shell']) {
        const candidate = path.join(root, name, relative);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }

  /**
   * A browser the machine already has, installed the ordinary way.
   *
   * Playwright's own download is the first thing to fail on a machine with a
   * small disk or restricted egress — and a Chromium from the distribution's
   * packages works perfectly well for loading one page. Looking here turns
   * "install a browser" into "you already have one".
   */
  const systemNames = [
    // `chromium` before `chromium-browser`: on Debian and Ubuntu the latter is
    // sometimes a wrapper around a Snap, which cannot run in a hosted shell and
    // fails in a way that looks like the browser crashing.
    'chromium', 'chromium-browser', 'chrome', 'google-chrome', 'google-chrome-stable',
    'microsoft-edge', 'microsoft-edge-stable',
  ];
  const systemDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);

  for (const name of systemNames) {
    for (const dir of systemDirs) {
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
      } catch {
        continue;
      }
      // A wrapper is remembered but not chosen: a real binary further down the
      // list beats it, and it is only reported if nothing better turns up.
      if (looksLikeAScript(candidate)) {
        wrappers.push(candidate);
        continue;
      }
      return candidate;
    }
  }

  // Let Playwright try its own; it may well be right.
  return undefined;
};

const wrappers = [];
const executablePath = findChromium();

if (!executablePath && wrappers.length > 0) {
  console.error(`\n   The only browsers on this machine are wrappers, not browsers:`);
  for (const wrapper of wrappers) console.error(`     ${wrapper}`);
  console.error('\n   On Ubuntu these hand off to a Snap, and a Snap cannot run in a hosted');
  console.error('   shell — apt-get install chromium reinstalls the same wrapper. Google Chrome');
  console.error('   ships a real binary in a .deb, which does work:');
  console.error('     wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb');
  console.error('     sudo apt-get install -y ./google-chrome-stable_current_amd64.deb');
  console.error('   then run this again — it will be found on PATH.');
  process.exit(2);
}
if (executablePath) console.log(`   browser: ${executablePath}`);

/**
 * Keep the browser to itself.
 *
 * Left alone Chromium talks to Google on start-up — update checks, metrics,
 * variations — and this runs inside a company network against a finance
 * system, where unexplained outbound traffic is somebody's afternoon. None of
 * it is needed to load one page.
 *
 * The sandbox is dropped only when running as root, where the kernel refuses
 * it and Chromium will not start otherwise; anywhere else it stays on.
 */
const launchArgs = [
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-sync',
  '--no-first-run',
  '--no-default-browser-check',
  '--metrics-recording-only',
  '--disable-domain-reliability',
  '--disable-client-side-phishing-detection',
  '--safebrowsing-disable-auto-update',
  '--disable-breakpad',
  '--disable-crash-reporter',
  '--no-service-autorun',
  '--disable-search-engine-choice-screen',
  '--disable-features=OptimizationHints,MediaRouter,DialMediaRouteProvider,'
    + 'NetworkTimeServiceQuerying,InterestFeedContentSuggestions,Translate',
  '--disable-dev-shm-usage',
];

/**
 * Start it, and try again without the sandbox if it will not start.
 *
 * Chromium's sandbox needs kernel features a hosted shell or a container often
 * does not grant, and it fails as "the browser has been closed" — which says
 * nothing about sandboxes to whoever reads it. Dropping the sandbox is a real
 * reduction in isolation, so it is not the default: the safe attempt goes
 * first, and the fallback announces itself.
 */
const launch = (args) => chromium.launch({ headless: !has('headed'), executablePath, args });

let browser;
try {
  browser = await launch(launchArgs);
} catch (firstError) {
  try {
    browser = await launch([...launchArgs, '--no-sandbox']);
    console.log('   started without the sandbox — this machine will not grant it');
  } catch (err) {
    // Two different problems wearing the same message. Saying "no browser was
    // found" when one was found and would not start sends the reader to
    // install a second copy of what they already have.
    if (executablePath) {
      console.error(`\n   ${executablePath} would not start.`);
      console.error(`   ${err.message.split('\n').slice(0, 4).join('\n   ')}`);
      console.error('\n   It was found, so this is not a missing browser.');
      if (looksLikeAScript(executablePath)) {
        console.error(`   ${executablePath} is a shell script, not a browser — on Ubuntu it hands`);
        console.error('   off to a Snap, which cannot run in a hosted shell. apt-get install');
        console.error('   chromium reinstalls the same wrapper; Google Chrome ships a real binary:');
        console.error('     wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb');
        console.error('     sudo apt-get install -y ./google-chrome-stable_current_amd64.deb');
      } else {
        console.error('   Try another: CHROMIUM_PATH=/path/to/chrome, or install Google Chrome:');
        console.error('     wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb');
        console.error('     sudo apt-get install -y ./google-chrome-stable_current_amd64.deb');
      }
    } else {
      console.error(`\n   No browser was found: ${err.message.split('\n')[0]}`);
      console.error('\n   Playwright\u2019s own download is the first thing to fail on a machine with');
      console.error('   a small disk or restricted egress. One from the distribution\u2019s packages');
      console.error('   does this job just as well:');
      console.error('     sudo apt-get update && sudo apt-get install -y chromium   # Debian, Ubuntu');
      console.error('     sudo dnf install -y chromium                              # Fedora, RHEL');
      console.error('   or point at one already installed:  CHROMIUM_PATH=/path/to/chrome');
    }
    process.exit(2);
  }
}
const context = await browser.newContext({ ignoreHTTPSErrors: false });

/**
 * Nothing leaves for anywhere but Mango.
 *
 * The launch flags ask Chromium not to talk to Google on start-up and it does
 * anyway — update checks and connectivity probes. Asking is not the same as
 * preventing, and this runs inside a company network against a finance system,
 * where an unexplained outbound connection is somebody's afternoon.
 *
 * So the rule is enforced here rather than requested: requests to any host but
 * Mango's are refused, and what was refused is reported, so a page that turns
 * out to need something external says so instead of failing silently.
 */
const allowedHost = new URL(anywhere).host;
const blocked = new Map();

await context.route('**/*', async (route) => {
  const url = route.request().url();
  if (/^(data|blob|about):/.test(url)) return route.continue();

  let host;
  try {
    host = new URL(url).host;
  } catch {
    return route.continue();
  }

  if (host === allowedHost) return route.continue();

  blocked.set(host, (blocked.get(host) ?? 0) + 1);
  return route.abort();
});

const page = await context.newPage();

/**
 * Take the token off the application's own traffic.
 *
 * This is the whole trick. The front end mints a token for its session and
 * sends it on every call; watching one go past is how a script obtains one
 * that is valid for the session it is actually using.
 */
let authToken = null;
const seenEndpoints = new Set();

page.on('request', (request) => {
  const header = request.headers()['x-mango-auth'];
  if (header && header !== authToken) authToken = header;

  const url = request.url();
  if (url.startsWith(service)) seenEndpoints.add(url.slice(service.length + 1).split('?')[0]);
});

try {
  console.log('   opening the front end');
  await page.goto(`${anywhere}/page/`, { waitUntil: 'domcontentloaded', timeout: 90_000 });

  // The application redirects to its own sign-in when there is no session.
  await page.waitForTimeout(2_000);

  const signInNeeded = await page.locator('input[type=password]').count() > 0;
  if (signInNeeded) {
    console.log('   signing in');
    await page.locator('input[type=password]').first().fill(pass);

    const userField = page.locator('input[type=text]:visible, input[name*=user i]:visible').first();
    if (await userField.count() > 0) await userField.fill(user);

    // The company picker, where the page offers one.
    const picker = page.locator('select').first();
    if (await picker.count() > 0) {
      await picker.selectOption({ value: maincode }).catch(() => undefined);
    }

    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 90_000 }).catch(() => undefined),
      page.keyboard.press('Enter'),
    ]);
    await page.waitForTimeout(3_000);
  }

  // Let the application finish its own start-up: it is the start-up that mints
  // the token and points the session at a company.
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => undefined);
  await page.waitForTimeout(2_000);

  if (blocked.size > 0) {
    const summary = [...blocked].map(([host, count]) => `${host}${count > 1 ? ` ×${count}` : ''}`).join(', ');
    console.log(`   refused to let the browser reach: ${summary}`);
  }
  console.log(`   the application called ${seenEndpoints.size} endpoints on the service`);
  console.log(`   token: ${authToken ? 'taken off its own traffic' : 'not seen — the reads below will fail'}`);

  if (!authToken) {
    console.error('\n   No x-mango-auth header went past. Either the sign-in did not complete or this');
    console.error('   build does not use one. Run again with --headed to watch what happens.');
    await page.screenshot({ path: 'mango-anywhere-signin.png' }).catch(() => undefined);
    console.error('   A screenshot of where it stopped: mango-anywhere-signin.png');
    process.exit(1);
  }

  // ------------------------------------------------------------------ read

  const fill = (value) => String(value)
    .replace('{date}', reportDate)
    .replace('{company}', maincode);

  console.log(bold('\n── Reading'));
  const answers = {};

  for (const [label, endpoint, params] of READS) {
    const query = Object.entries(params)
      .map(([key, value]) => `${key}=${encodeURIComponent(fill(value))}`)
      .join('&');
    const url = `${service}/${endpoint}${query ? `?${query}` : ''}`;

    // Fetched from inside the page: its origin, its cookies, its token. The
    // same request the application makes, which is the point.
    const answer = await page.evaluate(async ([target, token]) => {
      try {
        const response = await fetch(target, {
          headers: { 'x-mango-auth': token, accept: 'application/json, text/plain, */*' },
          credentials: 'include',
        });
        const text = await response.text();
        return { status: response.status, text: text.slice(0, 2_000_000) };
      } catch (err) {
        return { status: 0, text: String(err) };
      }
    }, [url, authToken]);

    if (answer.status !== 200) {
      console.log(`   ${label.padEnd(28)} ${answer.status}`);
      continue;
    }

    let body;
    try {
      body = JSON.parse(answer.text);
    } catch {
      console.log(`   ${label.padEnd(28)} answered something that is not JSON`);
      continue;
    }

    const payload = body && typeof body === 'object' && 'success' in body ? body.data : body;
    if (body?.success === false) {
      console.log(`   ${label.padEnd(28)} refused: ${body.error ?? 'no reason given'}`);
      continue;
    }

    answers[endpoint + (params.bank_guarantee ? `?guarantee=${params.bank_guarantee}` : '')] = payload;
    console.log(`   ${label.padEnd(28)} ${shapeOf(payload)}`);
  }

  if (savePath) {
    fs.mkdirSync(path.dirname(path.resolve(savePath)), { recursive: true });
    fs.writeFileSync(savePath, JSON.stringify({ maincode, reportDate, answers }, null, 1), 'utf8');
    console.log(`\n   written to ${savePath}`);
  }

  const read = Object.keys(answers).length;
  console.log(bold(`\n── ${read} of ${READS.length} answered`));

  if (read === 0) {
    console.error('\n   Nothing answered. The token went past but the reads were refused, which');
    console.error('   means the session is signed in and not pointed at a company.');
    process.exit(1);
  }

  if (dryRun) {
    console.log(bold('\n   --dry-run: nothing was written.\n'));
  } else {
    console.log('\n   Mapping into the dashboard is not written yet — the columns above are');
    console.log('   what it will be written against. Run with --save and keep the file.\n');
  }
} finally {
  await context.close();
  await browser.close();
}
