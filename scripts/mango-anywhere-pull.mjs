/**
 * Read the accounting figures out of Mango Anywhere, through a real browser.
 *
 *   npm run anywhere:pull -- --dry-run
 *
 * Run through the TypeScript loader, as the other pulls are — the mapper it
 * imports lives in src/ and uses the @/ alias.
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
 *   --force             import even when this pull is identical to a previous one
 *   --flip-bank-sign    take the bank balances as the negative of what Mango
 *                       sends, once that has been confirmed against one
 *                       account in Mango's own screen
 *   --date YYYY-MM-DD   the date to file it under (default: today)
 *   --all-companies     walk every company this account can open, asking Mango
 *                       which those are
 *   --map MG2=HAMONIA,MG1=CHTN
 *                       which company here each Mango company is. Needed to
 *                       write more than one; the two systems spell the same
 *                       company differently and a near-match would file one
 *                       subsidiary's balances under another.
 *   --dry-run           fetch, map and report; write nothing
 *   --save <file>       write the raw answers to disk, for inspection
 *   --headed            show the browser, for watching it work
 *
 * Needs Chromium. Where Playwright's own is not installed:
 *   npx playwright install --with-deps chromium
 */

import { createHash } from 'node:crypto';
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
// Mango returns the bank balances the accounting way round. Confirmed against
// one account in its own screen, this records the answer in the command.
const flipBankSign = has('flip-bank-sign');
const allCompanies = has('all-companies');
// Which company here each Mango company is. Given rather than guessed: the two
// systems spell the same company differently, and a near-match files one
// subsidiary's balances under another.
const companyMap = (flag('map') ?? '').split(',').map((pair) => pair.trim()).filter(Boolean);
const maincode = (process.env.MANGO_MAINCODE ?? 'MG1').toUpperCase();

if (!dryRun && !companyCode && !has('all-companies')) {
  console.error('Which company is this for? Pass --company <code>, or --all-companies with');
  console.error('--map, or --dry-run to only look.');
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
  ['arBalances', 'receivable balances', 'anywhereAPI/Dashboard/balanceArReadList', { startDate: '{date}', field: 'mainname', text: '' }],
  ['apBalances', 'payable balances', 'anywhereAPI/Dashboard/balanceApReadList', { startDate: '{date}', field: 'mainname', text: '' }],
  ['arByMonth', 'receivables by month', 'anywhereAPI/Dashboard/viewArRead', { type: 'MONTH' }],
  ['apByMonth', 'payables by month', 'anywhereAPI/Dashboard/viewApRead', { type: 'MONTH' }],
  ['arAgeing', 'receivable ageing', 'anywhereAPI/Dashboard/BarchartArRead', { today: '{date}', startDate: '{date}' }],
  ['apAgeing', 'payable ageing', 'anywhereAPI/Dashboard/BarchartAPRead', { today: '{date}', startDate: '{date}' }],
  ['arYear', 'receivables, year to date', 'anywhereAPI/Dashboard/yearDetailARRead', {}],
  ['apYear', 'payables, year to date', 'anywhereAPI/Dashboard/yearDetailAPRead', {}],
  ['bankAccounts', 'bank balances', 'anywhereAPI/Dashboard/view_bank_all_v2', { bank_guarantee: 'N', company_code: '{company}', chq_date: '{date}' }],
  ['bankGuarantees', 'bank guarantees', 'anywhereAPI/Dashboard/view_bank_all_v2', { bank_guarantee: 'Y', company_code: '{company}', chq_date: '{date}' }],
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
/**
 * Is this an actual browser binary?
 *
 * A launcher script is not a red flag by itself, and treating it as one cost a
 * round: Google Chrome's own .deb installs `/usr/bin/google-chrome` as a small
 * shell script that execs `/opt/google/chrome/chrome`, and that is a perfectly
 * good browser. What is unusable is a script handing off to a Snap, because a
 * Snap cannot run in a hosted shell. So the question is not "script or binary"
 * but "does this lead to a binary that exists".
 */
const isElf = (file) => {
  try {
    const handle = fs.openSync(file, 'r');
    const head = Buffer.alloc(4);
    fs.readSync(handle, head, 0, 4, 0);
    fs.closeSync(handle);
    return head[0] === 0x7f && head.toString('latin1', 1, 4) === 'ELF';
  } catch {
    return false;
  }
};

/**
 * Follow a launcher script to the binary it starts.
 *
 * Reads the paths the script mentions and returns the first that is a real
 * executable. One pointing only into /snap is a dead end and says so rather
 * than being followed.
 */
const resolveLauncher = (file) => {
  let text;
  try {
    if (fs.statSync(file).size > 64_000) return { snap: false, target: null };
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { snap: false, target: null };
  }

  const mentioned = [...text.matchAll(/(\/[\w./+-]{4,})/g)].map((match) => match[1]);
  if (mentioned.some((candidate) => candidate.startsWith('/snap/'))) {
    return { snap: true, target: null };
  }

  for (const candidate of mentioned) {
    if (candidate === file) continue;
    if (isElf(candidate)) return { snap: false, target: candidate };
  }
  return { snap: false, target: null };
};

/**
 * Where the packages actually put the binary.
 *
 * Looked at before PATH, because this is the answer rather than a signpost to
 * it: each of these is the real executable a launcher script on PATH would
 * have started.
 */
const WELL_KNOWN = [
  '/opt/google/chrome/chrome',
  '/opt/google/chrome/google-chrome',
  '/opt/google/chrome-beta/chrome',
  '/opt/chromium.org/chromium/chromium',
  '/opt/microsoft/msedge/msedge',
  '/usr/lib/chromium/chromium',
  '/usr/lib/chromium-browser/chromium-browser',
  '/usr/lib64/chromium-browser/chromium-browser',
];

const deadEnds = [];

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

  // The binaries the packages install, which is where a launcher on PATH would
  // have sent us anyway.
  for (const candidate of WELL_KNOWN) {
    if (isElf(candidate)) return candidate;
  }

  /**
   * A browser the machine already has, installed the ordinary way.
   *
   * Playwright's own download is the first thing to fail on a machine with a
   * small disk or restricted egress, and a browser from the distribution's
   * packages loads one page perfectly well. Looking here turns "install a
   * browser" into "you already have one".
   */
  const systemNames = [
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

      if (isElf(candidate)) return candidate;

      // A launcher script: follow it. One leading to a real binary is as good
      // as finding the binary; one leading only into /snap is remembered so it
      // can be named if nothing better turns up.
      const { snap, target } = resolveLauncher(candidate);
      if (target) return target;
      deadEnds.push({ path: candidate, snap });
    }
  }

  // Let Playwright try its own; it may well be right.
  return undefined;
};

const executablePath = findChromium();

if (!executablePath && deadEnds.length > 0) {
  console.error('\n   Every browser on this machine is a launcher with nothing behind it:');
  for (const dead of deadEnds) {
    console.error(`     ${dead.path}${dead.snap ? '   → a Snap, which cannot run here' : ''}`);
  }
  if (deadEnds.some((dead) => dead.snap)) {
    console.error('\n   On Ubuntu apt-get install chromium reinstalls the same Snap wrapper, so');
    console.error('   there is no apt route to a real one. Google Chrome ships a real binary:');
  } else {
    console.error('\n   Install one that does:');
  }
  console.error('     wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb');
  console.error('     sudo apt-get install -y ./google-chrome-stable_current_amd64.deb');
  console.error('   then run this again.');
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
      console.error('   Try another: CHROMIUM_PATH=/path/to/chrome, or install Google Chrome:');
      console.error('     wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb');
      console.error('     sudo apt-get install -y ./google-chrome-stable_current_amd64.deb');
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

  // The application redirects to its own sign-in when there is no session, and
  // the redirect is not instant. Waiting for the field rather than for a moment
  // means a slow hop is not mistaken for being signed in already.
  await page.locator('input[type=password]').first()
    .waitFor({ state: 'visible', timeout: 20_000 })
    .catch(() => undefined);

  const signInNeeded = await page.locator('input[type=password]').count() > 0;
  if (signInNeeded) {
    console.log('   signing in');

    // Username first, then password: filling the password field and then
    // hunting for a text box has the focus in the wrong place if the page
    // submits on Enter mid-way.
    const userField = page.locator('input[type=text]:visible, input[name*=user i]:visible').first();
    if (await userField.count() > 0) await userField.fill(user);
    await page.locator('input[type=password]').first().fill(pass);

    // The company picker, where the page offers one.
    const picker = page.locator('select').first();
    if (await picker.count() > 0) {
      await picker.selectOption({ value: maincode }).catch(() => undefined);
    }

    const submit = page.locator('button[type=submit], input[type=submit], button:has-text("Login"), button:has-text("Sign in"), button:has-text("เข้าสู่ระบบ")').first();
    if (await submit.count() > 0) await submit.click({ timeout: 10_000 }).catch(() => undefined);
    else await page.keyboard.press('Enter');

    /**
     * Wait for the password box to go, and read the page if it does not.
     *
     * A sign-in that does not take leaves Mango's own explanation on the
     * screen — a wrong password, an expired one, a session already open
     * elsewhere. Waiting a minute and then reporting "no token went past"
     * throws that explanation away and substitutes a guess.
     */
    const signedIn = await page.locator('input[type=password]').first()
      .waitFor({ state: 'detached', timeout: 25_000 })
      .then(() => true)
      .catch(() => false);

    if (!signedIn) {
      const said = (await page.locator('body').innerText().catch(() => ''))
        .split('\n').map((l) => l.trim())
        .filter((l) => l && l.length < 200)
        .slice(0, 12)
        .join(' · ');

      console.error('\n   The sign-in did not take. Mango still shows a password box, and the page says:');
      console.error(`     ${said || '(nothing this could read)'}`);
      console.error('\n   Worth knowing: this Mango has an API/Public/KickUserOnline endpoint, which');
      console.error('   is what a system with one session per account has. If somebody is signed in');
      console.error('   as this account in a browser, that may be the whole of it — which is another');
      console.error('   reason for the pull to have a service account of its own.');
      await page.screenshot({ path: 'mango-anywhere-signin.png', fullPage: true }).catch(() => undefined);
      console.error('\n   A screenshot: mango-anywhere-signin.png');
      process.exit(1);
    }
  }

  /**
   * Wait for the token, not for a number of seconds.
   *
   * The start-up is what mints the token, and how long it takes depends on the
   * network and on Mango. A run that waited three seconds and then reported "no
   * token went past" was reporting its own impatience: six endpoints had been
   * called where a complete start-up calls eighteen.
   */
  const waitForToken = async (seconds) => {
    for (let waited = 0; waited < seconds * 4; waited += 1) {
      if (authToken) return true;
      await page.waitForTimeout(250);
    }
    return Boolean(authToken);
  };

  if (!(await waitForToken(30))) {
    /**
     * Nudge it, by opening a screen that needs figures.
     *
     * The shell can settle without asking for anything, and this is the screen
     * the captured traffic came from — a screen that has to fetch to draw
     * itself, which is what makes the application authenticate.
     */
    console.log('   nothing yet; opening a screen that needs figures');
    await page.goto(`${anywhere}/page/transaction/fin/v_fn_cash_on_hand`,
      { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined);
    await waitForToken(30);
  }

  if (blocked.size > 0) {
    const summary = [...blocked].map(([host, count]) => `${host}${count > 1 ? ` ×${count}` : ''}`).join(', ');
    console.log(`   refused to let the browser reach: ${summary}`);
  }
  console.log(`   the application called ${seenEndpoints.size} endpoints on the service`);
  console.log(`   token: ${authToken ? 'taken off its own traffic' : 'not seen — the reads below will fail'}`);

  if (!authToken) {
    console.error('\n   No x-mango-auth header went past in a minute of waiting.');
    console.error(`   The page ended at ${page.url()}`);
    console.error(`   titled "${await page.title().catch(() => '—')}"`);
    console.error(`   and the application called ${seenEndpoints.size} endpoints; a complete `
      + 'start-up calls about eighteen.');
    if (await page.locator('input[type=password]').count() > 0) {
      console.error('\n   There is still a password box on the page, so the sign-in did not take —');
      console.error('   check the account, and whether it must change its password.');
    }
    await page.screenshot({ path: 'mango-anywhere-signin.png', fullPage: true }).catch(() => undefined);
    console.error('\n   A screenshot of where it stopped: mango-anywhere-signin.png');
    process.exit(1);
  }

  // ------------------------------------------------------------------ read

  /**
   * Point the service session at a company.
   *
   * Signing in settles the company for the estate module; the service keeps its
   * own, and this is what the front end calls to change it. Reading a second
   * company without it returns the first one's figures under the second one's
   * name, which is the worst available outcome — plausible, labelled, wrong.
   */
  const switchCompany = async (code) => {
    const answer = await ask(`${service}/anywhere/center/Maincomp?maincode=${encodeURIComponent(code)}`);
    if (answer.status !== 200) {
      console.error(`   could not switch to ${code}: ${answer.status}`);
      return false;
    }
    return true;
  };

  /** One request, made from inside the page: its origin, its cookies, its token. */
  const ask = (url) => page.evaluate(async ([target, token]) => {
    try {
      const response = await fetch(target, {
        headers: { 'x-mango-auth': token, accept: 'application/json, text/plain, */*' },
        credentials: 'include',
      });
      return { status: response.status, text: (await response.text()).slice(0, 2_000_000) };
    } catch (err) {
      return { status: 0, text: String(err) };
    }
  }, [url, authToken]);

  const unwrap = (answer, label) => {
    if (answer.status !== 200) {
      console.log(`   ${label.padEnd(28)} ${answer.status}`);
      return null;
    }
    let body;
    try {
      body = JSON.parse(answer.text);
    } catch {
      console.log(`   ${label.padEnd(28)} answered something that is not JSON`);
      return null;
    }
    if (body?.success === false) {
      console.log(`   ${label.padEnd(28)} refused: ${body.error ?? 'no reason given'}`);
      return null;
    }
    return body && typeof body === 'object' && 'success' in body ? body.data : body;
  };

  /** Read every endpoint for one company and map the answers. */
  const readCompany = async (code) => {
    const fill = (value) => String(value)
      .replace('{date}', reportDate)
      .replace('{company}', code);

    const bundle = {};
    for (const [key, label, endpoint, params] of READS) {
      const query = Object.entries(params)
        .map(([name, value]) => `${name}=${encodeURIComponent(fill(value))}`)
        .join('&');

      const payload = unwrap(await ask(`${service}/${endpoint}${query ? `?${query}` : ''}`), label);
      if (payload === null) continue;

      // A grid wrapper where a list was expected is the shape the estate module
      // answers with too; unwrapping it here keeps the mapper reading one thing.
      bundle[key] = Array.isArray(payload) ? payload
        : Array.isArray(payload?.data) ? payload.data
          : payload && typeof payload === 'object' ? [payload] : [];
      console.log(`   ${label.padEnd(28)} ${shapeOf(payload)}`);
    }

    const read = Object.keys(bundle).length;
    console.log(`   ${String(read).padStart(2)} of ${READS.length} answered`);

    const { mapAnywhereBundle } = await import('../src/lib/sources/anywhere/map.ts');
    return { bundle, read, mapped: mapAnywhereBundle(bundle, { reportDate, maincode: code, flipBankSign }) };
  };

  /** Print one company's position. */
  const report = (code, mapped) => {
    console.log(bold(`\n── ${code}`));
    const line = (label, value) => console.log(`   ${label.padEnd(26)} ${money(value).padStart(18)}`);

    // Only the balances. total_amt is this period's billing rather than a
    // history, so a line called "invoiced" would be claiming more than it knows.
    line('owed by customers', mapped.totals.receivableOutstanding);
    line('owed to suppliers', mapped.totals.payableOutstanding);
    line('billed this period, in', mapped.totals.receivable);
    line('billed this period, out', mapped.totals.payable);
    line('in the bank', mapped.totals.cash);
    if (mapped.totals.guarantees > 0) line('held as guarantees', mapped.totals.guarantees);
    if (flipBankSign) console.log('   (bank balances read as the negative of what Mango sends)');

    console.log(`\n   ${mapped.counts.customers} customers · ${mapped.counts.vendors} suppliers · `
      + `${mapped.counts.bankAccounts} bank accounts`);

    if (mapped.ageing.receivable.length > 0) {
      console.log('\n   receivable ageing:');
      for (const band of mapped.ageing.receivable) {
        console.log(`     ${band.band.padEnd(10)} ${money(band.amount).padStart(18)}`);
      }
    }

    const months = [...mapped.collectedByMonth.entries()].sort().slice(-6);
    if (months.length > 0) {
      console.log('\n   collected by month (cash moved, not revenue raised):');
      for (const [month, amount] of months) {
        console.log(`     ${month}    ${money(amount).padStart(18)}`);
      }
    }

    // Errors first: a figure that cannot be true should not be read after a
    // dozen notes about columns.
    const ordered = [...mapped.issues].sort((a, b) =>
      (a.severity === 'error' ? 0 : a.severity === 'warning' ? 1 : 2)
      - (b.severity === 'error' ? 0 : b.severity === 'warning' ? 1 : 2));
    for (const issue of ordered) console.log(`\n   ${issue.severity}: ${issue.message}`);
  };

  /**
   * Which companies to read.
   *
   * `--all-companies` asks Mango which ones the account can open rather than
   * being told, because the answer is the authority on it — and an account that
   * has lost a company should shrink the run rather than fail one of them.
   */
  let targets = [maincode];

  if (allCompanies) {
    const payload = unwrap(
      await ask(`${service}/api/public/LoginCompaniesByUserID?userid=${encodeURIComponent(user)}`),
      'companies',
    );
    const rows = Array.isArray(payload) ? payload : payload?.data;

    if (!Array.isArray(rows) || rows.length === 0) {
      console.error('\n   Could not find out which companies this account can open.');
      process.exit(1);
    }

    targets = rows
      .map((row) => String(row.maincode ?? '').trim().toUpperCase())
      .filter(Boolean);

    console.log(bold(`\n── ${targets.length} companies this account can open`));
    for (const row of rows) {
      console.log(`   ${String(row.maincode ?? '').padEnd(6)} ${row.mainname ?? row.compname ?? ''}`);
    }
  }

  const results = [];
  for (const code of targets) {
    console.log(bold(`\n── Reading ${code}`));
    if (targets.length > 1 && !(await switchCompany(code))) continue;

    const { bundle, read, mapped } = await readCompany(code);
    if (read === 0) {
      console.error(`   nothing answered for ${code}; skipping it rather than writing an empty position`);
      continue;
    }
    report(code, mapped);
    results.push({ code, bundle, mapped });
  }

  if (results.length === 0) {
    console.error('\n   Nothing answered for any company. The token went past, so the session is');
    console.error('   signed in and not pointed at a company.');
    process.exit(1);
  }

  if (savePath) {
    fs.mkdirSync(path.dirname(path.resolve(savePath)), { recursive: true });
    fs.writeFileSync(savePath, JSON.stringify({ reportDate, companies: results.map(
      ({ code, bundle }) => ({ maincode: code, bundle })) }, null, 1), 'utf8');
    console.log(`\n   written to ${savePath}`);
  }

  if (dryRun) console.log(bold('\n   --dry-run: nothing was written.\n'));

  // --------------------------------------------------------------- persist

  if (!dryRun) {
    const companies = await import('../src/lib/db/repositories/companies.ts');
    const imports = await import('../src/lib/db/repositories/imports.ts');
    const snapshots = await import('../src/lib/db/repositories/snapshots.ts');
    const { indexSourceRefs } = await import('../src/lib/calc/aggregate.ts');
    const { mergeDatasets } = await import('../src/lib/types.ts');

    const known = companies.listAllCompanies();

    /**
     * Which company here each Mango company is.
     *
     * Not guessed from the names. The two systems spell the same company
     * differently — "มารีน่า โกลเด้น เบย์ วิกตอเรีย" here against "มาริน่า
     * โกลเด้น เบย์ วิคทอเรีย" there — and a near-match that picks the wrong
     * company files one subsidiary's balances under another. So the mapping is
     * given, and a company without one is skipped and named.
     */
    const mapping = new Map();
    for (const pair of companyMap) {
      const [from, to] = pair.split('=').map((part) => part.trim());
      if (from && to) mapping.set(from.toUpperCase(), to);
    }
    if (companyCode && targets.length === 1) mapping.set(targets[0], companyCode);

    const unmapped = results.filter(({ code }) => !mapping.has(code)).map(({ code }) => code);
    if (unmapped.length > 0) {
      console.error(`\n   No company here is named for ${unmapped.join(', ')}.`);
      console.error('   Say which, and nothing is guessed:');
      console.error(`     --map ${unmapped.map((code) => `${code}=CODE`).join(',')}`);
      console.error(`\n   The companies here are: ${known.map((c) => c.companyCode).join(', ')}`);
      if (unmapped.length === results.length) process.exit(1);
    }

    /**
     * Mango is the source for these three, and the workbooks stay the source
     * for the rest.
     *
     * Replacing a snapshot retires the whole of it, and the whole of it is more
     * than receivables, payables and bank — the general ledger, the cash flow
     * and the BOQ arrive from uploaded files and would go with it. So the
     * records this pull does not own are read out of the current snapshot and
     * carried forward, and only the three kinds Mango is authoritative for are
     * replaced.
     *
     * Writing alongside instead is the double count the reconciliation rules
     * exist to catch: the same balances twice, once from each source.
     */
    const OWNED = ['receivable', 'payable', 'bank'];

    let written = 0;
    for (const { code, bundle, mapped } of results) {
      const target = mapping.get(code);
      if (!target) continue;

      const company = known.find((c) => c.companyCode === target);
      if (!company) {
        console.error(`\n   ${code} → ${target}, and there is no company here with that code.`);
        continue;
      }

      console.log(bold(`\n── ${code} → ${company.displayName}`));

      const current = snapshots.getCurrentSnapshot(company.id);
      let carried = null;

      if (current) {
        const existing = snapshots.loadDataset(company.id, current.id);
        carried = { ...existing.data };
        for (const kind of OWNED) carried[kind] = [];

        const superseded = OWNED
          .map((kind) => `${existing.data[kind]?.length ?? 0} ${kind}`)
          .join(', ');
        const kept = Object.entries(carried)
          .filter(([, rows]) => Array.isArray(rows) && rows.length > 0)
          .map(([kind, rows]) => `${rows.length} ${kind}`)
          .join(', ');

        console.log(`   superseded from the workbooks: ${superseded}`);
        console.log(`   carried forward unchanged:     ${kept || 'nothing'}`);
      } else {
        console.log('   first import for this company');
      }

      const combined = carried ? mergeDatasets(carried, mapped.data) : mapped.data;
      indexSourceRefs(combined);

      const payload = JSON.stringify({ maincode: code, reportDate, bundle });
      const file = {
        fileName: `mango-anywhere-${code}-${reportDate}.json`,
        originalName: `Mango Anywhere ${code} — ${reportDate}`,
        containerFile: null,
        filePath: `mango://${service}/anywhereAPI/Dashboard`,
        // The hash of what Mango answered, so an identical pull is recognised
        // as the duplicate it is rather than filed twice.
        hash: createHash('sha256').update(payload).digest('hex'),
        size: Buffer.byteLength(payload),
        fileType: 'json',
        project: { projectId: null, projectCode: null, projectName: null, matchedAlias: null, matchedIn: 'api', confidence: 1 },
        reportDate,
        reportType: 'receivable',
        reportTypeLabel: `Mango Anywhere — ${code}`,
        sheetCount: 1,
        sheets: [],
        data: combined,
        rowCount: mapped.data.receivable.length + mapped.data.payable.length + mapped.data.bank.length,
        issues: mapped.issues,
        status: 'parsed',
        error: null,
      };

      const duplicates = imports.findDuplicates(company.id, [{
        fileName: file.fileName, hash: file.hash, reportDate,
        projectId: null, reportType: 'receivable',
      }]);

      if (duplicates.length > 0 && !has('force')) {
        console.log(`   identical to the pull imported on ${duplicates[0].importedAt.slice(0, 10)}; `
          + 'skipped. --force to import it again.');
        continue;
      }

      const outcome = imports.persistImport({
        companyId: company.id,
        reportDate,
        label: `Mango Anywhere ${code} ${reportDate}`,
        userId: null,
        files: [file],
        issues: [],
        mode: 'replace',
      });

      console.log(`   import ${outcome.importId}`);
      console.log(`   ${mapped.counts.customers} customers · ${mapped.counts.vendors} suppliers · `
        + `${mapped.counts.bankAccounts} bank accounts written`);
      written += 1;
    }

    console.log(bold(`\n   ${written} of ${results.length} companies written.\n`));
  }
} finally {
  await context.close();
  await browser.close();
}
