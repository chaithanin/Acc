#!/usr/bin/env node
/**
 * Probe an external finance API so its request shape can be learned before any
 * adapter is written against it.
 *
 * The Allkons endpoint is an "adapter" URL, which is a generic entry point
 * rather than a documented resource: the payload it wants and the header it
 * expects the credential in are both unknown from the URL alone. Rather than
 * guess one combination and report a failure that only means "guessed wrong",
 * this tries the plausible combinations and prints what each one answered, so
 * one run tells you which is right.
 *
 * Usage
 *   node scripts/api-probe.mjs --url <url> --token <token>
 *   ALLKONS_API_URL=... ALLKONS_API_TOKEN=... node scripts/api-probe.mjs
 *
 * The token is read from the environment or the command line and is never
 * written to a file, never echoed, and masked in everything printed. Do not
 * put it in a committed file.
 */

/**
 * Printed on every run. Probing is iterative — the script is corrected as the
 * target reveals how it behaves — so a report has to say which version
 * produced it, or an old checkout's output gets read as a new result.
 */
const VERSION = 3;

const args = parseArgs(process.argv.slice(2));

const url = args.url ?? process.env.ALLKONS_API_URL;
const token = args.token ?? process.env.ALLKONS_API_TOKEN;
const timeoutMs = Number(args.timeout ?? 20000);
const bodyMax = Number(args['body-chars'] ?? 600);

if (!url || !token) {
  console.error('Usage: node scripts/api-probe.mjs --url <url> --token <token>');
  console.error('   or: ALLKONS_API_URL=... ALLKONS_API_TOKEN=... node scripts/api-probe.mjs');
  process.exit(2);
}

/** Where an API might expect the credential. Named so the report is readable. */
const AUTH_STYLES = [
  { name: 'Authorization: Bearer', headers: (t) => ({ Authorization: `Bearer ${t}` }) },
  { name: 'Authorization: raw', headers: (t) => ({ Authorization: t }) },
  { name: 'x-api-key', headers: (t) => ({ 'x-api-key': t }) },
  { name: 'api-key', headers: (t) => ({ 'api-key': t }) },
  { name: 'token', headers: (t) => ({ token: t }) },
  { name: 'access-token', headers: (t) => ({ 'access-token': t }) },
  { name: 'query ?token=', headers: () => ({}), query: (t) => ({ token: t }) },
  { name: 'query ?apiKey=', headers: () => ({}), query: (t) => ({ apiKey: t }) },
  { name: 'none (control)', headers: () => ({}), noToken: true },
];

/**
 * Request shapes. The empty POST is the control: a well-built API answers it
 * with a validation error naming the fields it wanted, which is more useful
 * than any successful guess.
 */
const SHAPES = [
  { name: 'GET', method: 'GET' },
  { name: 'POST {}', method: 'POST', body: {} },
  { name: 'POST {service}', method: 'POST', body: { service: '', method: '', data: {} } },
];

if (args.discover) {
  await discover();
} else {
  const results = [];
  for (const shape of SHAPES) {
    for (const style of AUTH_STYLES) {
      results.push(await probe(shape, style));
    }
  }
  report(results);
}

/**
 * Finds what routes the service actually has.
 *
 * Used when the given URL turns out not to be a route: rather than guess
 * endpoint names one at a time, this walks the path upwards and asks for the
 * documentation routes that API frameworks expose by default. One of those, if
 * it is reachable, names every endpoint and its payload — which is the whole
 * question answered in a single request.
 */
async function discover() {
  const base = new URL(url);
  const segments = base.pathname.split('/').filter(Boolean);

  // Every ancestor of the given path, longest first.
  const ancestors = [];
  for (let i = segments.length; i >= 0; i -= 1) {
    ancestors.push(`/${segments.slice(0, i).join('/')}`.replace(/\/+$/, '') || '/');
  }

  const DOC_ROUTES = [
    'v3/api-docs',
    'v2/api-docs',
    'api-docs',
    'openapi.json',
    'swagger.json',
    'swagger-ui/index.html',
    'swagger-ui.html',
    'docs',
    'health',
    'actuator/health',
  ];

  /**
   * Names an API service is likely to route under. A guessed name is only
   * worth trying because the fingerprint below makes a wrong guess cheap to
   * recognise — without it, a soft-404 host answers every guess with 200 and
   * the whole list reads as a hit.
   */
  const GUESSES = [
    'adapter', 'adapters', 'v1', 'v2', 'service', 'services', 'list', 'query',
    'auth', 'login', 'token', 'oauth/token', 'authenticate',
    'project', 'projects', 'company', 'companies', 'organization',
    'invoice', 'invoices', 'billing', 'payment', 'payments',
    'ledger', 'gl', 'account', 'accounts', 'journal',
    'budget', 'boq', 'contract', 'contracts', 'vendor', 'vendors',
    'report', 'reports', 'master', 'masterdata', 'data', 'export',
    'receivable', 'payable', 'cashflow', 'expense', 'income',
  ];

  console.log(`\nprobe v${VERSION} — mapping ${base.host}\n`);

  /**
   * A host that answers unknown paths with 200 makes "did this route exist?"
   * unanswerable from one response. So each prefix is asked for a path that
   * cannot exist, and its reply becomes that prefix's signature for "missing".
   * Anything matching the signature is absent however it is labelled; anything
   * differing is real. This replaces guessing at error wording, which is what
   * let a Next.js catch-all page read as nine separate routes.
   */
  const signatures = new Map();
  for (const ancestor of ancestors) {
    const target = new URL(base);
    target.pathname = joinPath(ancestor, 'zz-probe-no-such-route-4718');
    const r = await fetchPath(target);
    signatures.set(ancestor, r);
    console.log(
      `  signature ${ancestor.padEnd(30)} ${r.networkError ? r.body : `${r.status} ${r.contentType.split(';')[0]} ${r.bytes}B`}`,
    );
  }

  const candidates = [];
  for (const ancestor of ancestors) candidates.push({ pathname: ancestor, prefix: parentOf(ancestor, ancestors) });
  for (const ancestor of ancestors) {
    if (ancestor === '/') continue; // the site root is a website, not the API
    for (const route of [...DOC_ROUTES, ...GUESSES]) {
      candidates.push({ pathname: joinPath(ancestor, route), prefix: ancestor });
    }
  }

  console.log(`\n  ${candidates.length} paths to check\n`);

  const found = [];
  for (const { pathname, prefix } of candidates) {
    const target = new URL(base);
    target.pathname = pathname;
    const r = await fetchPath(target);
    if (r.networkError) {
      console.log(`  —    ${pathname}  ${r.body}`);
      continue;
    }

    const signature = signatures.get(prefix);
    const missing = saysNotFound(r) || matchesSignature(r, signature);
    // Only the hits are printed. A wall of misses is what buried the real
    // finding last time.
    if (!missing) {
      console.log(`  ${String(r.status).padEnd(4)} ${pathname.padEnd(44)} ${r.contentType.split(';')[0]} ${r.bytes}B`);
      found.push({ pathname, ...r });
    }
  }

  // Paths that cannot exist must not all answer identically; when they do,
  // something other than the service is answering for it.
  const sigs = [...signatures.values()].filter((r) => !r.networkError);
  if (sigs.length > 1 && sigs.every((r) => r.status === sigs[0].status && r.body === sigs[0].body) && !found.length) {
    console.log(`\nEvery path answered identically (${sigs[0].status}), including ones that cannot exist.`);
    console.log('That is not the service replying — something in between is answering for it:');
    console.log(`  ${sigs[0].body}`);
    console.log('Nothing about the real routes has been learned. Run this from a machine with');
    console.log('direct outbound HTTPS.');
    return;
  }

  if (!found.length) {
    console.log('\nNo route answered with anything but a "not found" page. The service is up but');
    console.log('none of these paths exist on it, and it publishes no documentation route.');
    console.log('The endpoint URL needs to come from whoever issued the credential — including');
    console.log('whether SIT is served on this host at all.');
    return;
  }

  console.log('\n--- Routes that exist ---');
  for (const r of found) {
    console.log(`\n[${r.status}] ${r.pathname}  (${r.contentType.split(';')[0]}, ${r.bytes} bytes)`);
    console.log(`  ${r.body.slice(0, 400) || '(empty body)'}`);

    // Asked per route rather than once, since which methods are allowed is the
    // difference between "send a GET" and "send a POST with a payload".
    const target = new URL(base);
    target.pathname = r.pathname;
    const options = await fetchPath(target, 'OPTIONS');
    if (options.allow) console.log(`  Methods accepted: ${options.allow}`);
    if (r.server) console.log(`  Served by: ${r.server}`);

    // An OpenAPI document is the jackpot: it lists every endpoint and the shape
    // of each payload, so it is worth unpacking rather than printing raw.
    const spec = tryParseSpec(r.raw);
    if (spec) {
      const paths = Object.keys(spec.paths ?? {});
      console.log(`\n  This is an API specification: ${spec.info?.title ?? 'untitled'} — ${paths.length} endpoints`);
      for (const p of paths.slice(0, 60)) {
        const methods = Object.keys(spec.paths[p]).join(', ').toUpperCase();
        console.log(`    ${methods.padEnd(18)} ${p}`);
      }
      if (paths.length > 60) console.log(`    … and ${paths.length - 60} more`);
    }
  }
}

function joinPath(prefix, route) {
  return `${prefix === '/' ? '' : prefix}/${route}`;
}

/** The nearest enclosing prefix that has a signature of its own. */
function parentOf(pathname, ancestors) {
  return ancestors.find((a) => a !== pathname && (pathname === '/' || pathname.startsWith(`${a === '/' ? '' : a}/`))) ?? '/';
}

/**
 * Whether a response is the same "nothing here" reply the prefix gives for a
 * path that cannot exist.
 *
 * Compared on the opening of the body rather than the whole of it, because a
 * catch-all page usually echoes the requested path back into itself and so is
 * never byte-identical between two misses.
 */
function matchesSignature(r, signature) {
  if (!signature || signature.networkError) return false;
  if (r.status !== signature.status) return false;
  if (r.body.slice(0, 160) === signature.body.slice(0, 160)) return true;
  // A same-shaped page of near-identical length is the same page: only the
  // echoed path differs.
  return (
    r.contentType === signature.contentType &&
    Math.abs(r.bytes - signature.bytes) <= 80 &&
    r.contentType.includes('html')
  );
}

async function fetchPath(target, method = 'GET') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(target, {
      method,
      headers: {
        Accept: 'application/json, */*',
        'User-Agent': 'gtg-dashboard-probe/1',
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
      redirect: 'manual',
    });
    const text = await res.text();
    return {
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      // A route that exists but rejects the method answers with the list of
      // methods it does accept, which is the request shape stated outright.
      allow: res.headers.get('allow') ?? '',
      server: res.headers.get('server') ?? '',
      ms: Date.now() - started,
      body: mask(text.replace(/\s+/g, ' ').trim().slice(0, bodyMax)),
      raw: text,
      bytes: text.length,
    };
  } catch (err) {
    return { status: 0, contentType: '', ms: Date.now() - started, body: mask(describeNetworkError(err)), raw: '', bytes: 0, networkError: true };
  } finally {
    clearTimeout(timer);
  }
}

function tryParseSpec(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && parsed.paths ? parsed : null;
  } catch {
    return null;
  }
}

async function probe(shape, style) {
  const target = new URL(url);
  for (const [k, v] of Object.entries(style.query?.(token) ?? {})) {
    target.searchParams.set(k, v);
  }

  const headers = {
    Accept: 'application/json, */*',
    'User-Agent': 'gtg-dashboard-probe/1',
    ...(style.noToken ? {} : style.headers(token)),
  };
  if (shape.body !== undefined) headers['Content-Type'] = 'application/json';

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(target, {
      method: shape.method,
      headers,
      body: shape.body === undefined ? undefined : JSON.stringify(shape.body),
      signal: controller.signal,
      redirect: 'manual',
    });

    const text = await res.text();
    return {
      shape: shape.name,
      auth: style.name,
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      ms: Date.now() - started,
      body: mask(text.replace(/\s+/g, ' ').trim().slice(0, bodyMax)),
      bytes: text.length,
    };
  } catch (err) {
    return {
      shape: shape.name,
      auth: style.name,
      status: 0,
      contentType: '',
      ms: Date.now() - started,
      body: mask(describeNetworkError(err)),
      bytes: 0,
      networkError: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A transport failure is not an API answer, and confusing the two sends you
 * debugging the wrong system — so it is labelled as what it is.
 */
function describeNetworkError(err) {
  const cause = err?.cause;
  const code = cause?.code ?? err?.code ?? '';
  if (err?.name === 'AbortError') return `NETWORK: no answer within ${timeoutMs}ms`;
  if (code === 'ENOTFOUND') return 'NETWORK: host does not resolve from this machine';
  if (code === 'ECONNREFUSED') return 'NETWORK: connection refused';
  if (String(err?.message ?? '').includes('certificate')) {
    return `NETWORK: TLS rejected (${cause?.message ?? err.message}) — often a proxy in the way`;
  }
  return `NETWORK: ${code || err?.message || 'unknown transport failure'}`;
}

/**
 * Whether a response is an error page for a route that does not exist.
 *
 * Checked on the body rather than the status because gateways routinely serve
 * their "not found" page with a 200.
 */
function saysNotFound(r) {
  if (!r || r.networkError) return false;
  if (r.status === 404) return true;
  // Kept tight: only a short body that is essentially the words themselves, so
  // a real payload that happens to contain "not found" in a message field is
  // not mistaken for a missing route.
  return r.bytes < 2000 && /^\W*(404|not found|404 not found)\b/i.test(r.body);
}

/** Keeps the credential out of terminal scrollback and pasted output. */
function mask(text) {
  if (!token) return text;
  const tail = token.slice(-4);
  return text.split(token).join(`***${tail}`);
}

function report(rows) {
  console.log(`\nprobe v${VERSION} — probed ${mask(url)}  (${rows.length} attempts)\n`);

  const width = { shape: 16, auth: 22 };
  const header = `${'SHAPE'.padEnd(width.shape)}${'AUTH'.padEnd(width.auth)}${'STATUS'.padEnd(8)}TYPE`;
  console.log(header);
  console.log('-'.repeat(header.length + 20));

  for (const r of rows) {
    const status = r.networkError ? '—' : String(r.status);
    console.log(
      `${r.shape.padEnd(width.shape)}${r.auth.padEnd(width.auth)}${status.padEnd(8)}${r.contentType.split(';')[0]}`,
    );
  }

  const network = rows.filter((r) => r.networkError);
  if (network.length === rows.length) {
    console.log('\nNothing reached the server. This machine cannot open the connection:');
    console.log(`  ${network[0].body}`);
    console.log('Run this from a machine with direct outbound HTTPS — the deployment VM will do.');
    return;
  }

  console.log('\n--- Answers ---');
  // Identical answers are collapsed, because twenty copies of the same
  // rejection hides the one attempt that behaved differently.
  const seen = new Map();
  for (const r of rows) {
    const key = `${r.status}|${r.body}`;
    if (!seen.has(key)) seen.set(key, { ...r, attempts: [] });
    seen.get(key).attempts.push(`${r.shape} + ${r.auth}`);
  }

  for (const r of seen.values()) {
    console.log(`\n[${r.networkError ? 'network' : r.status}] ${r.attempts.join(', ')}`);
    console.log(`  ${r.body || '(empty body)'}`);
  }

  // A 2xx is not by itself an acceptance. A gateway that serves an error page
  // for an unknown path often serves it with status 200, so a body that says
  // "not found" outranks the status line — otherwise every unknown path reads
  // as a success and the report sends you off writing an adapter for a route
  // that does not exist.
  const accepted = rows.filter((r) => r.status >= 200 && r.status < 300 && !saysNotFound(r));
  const authFailed = rows.filter((r) => r.status === 401 || r.status === 403);

  console.log('\n--- Reading this ---');

  // An intermediary — or a route that never reaches the API — answers every
  // attempt the same way, credential or not. Reporting that as an
  // authorisation verdict would send you to ask for a new token when the
  // token was never looked at.
  const control = rows.find((r) => r.auth === 'none (control)' && r.shape === 'POST {}');
  const sameWithoutToken =
    control && rows.every((r) => r.status === control.status && r.body === control.body);
  const proxyWorded = rows.some((r) => /allowlist|egress|proxy|blocked by|forbidden by policy/i.test(r.body));

  if (sameWithoutToken && saysNotFound(control)) {
    console.log('The server answered, but this path is not a route on it. Every attempt got the');
    console.log(`same "not found" page — including the one sending no credential — so the token`);
    console.log('was never evaluated and nothing here says whether it is valid.');
    if (control.status >= 200 && control.status < 300) {
      console.log(`\nNote the status was ${control.status}, not 404: the gateway serves its error page`);
      console.log('with a success code, so only the body tells you the route is missing.');
    }
    console.log('\nFind the real route:');
    console.log(`  node scripts/api-probe.mjs --url ${mask(url)} --token <token> --discover`);
    console.log('That walks the path upwards and tries the usual API-documentation routes, which');
    console.log('name every endpoint this service has if any of them are exposed.');
    return;
  }

  if (!accepted.length && (proxyWorded || (sameWithoutToken && authFailed.length === rows.length))) {
    console.log('This is not the API answering. Every attempt got the same reply, including the');
    console.log('one that sent no credential at all, so the reply does not depend on the token —');
    console.log('something between this machine and the API is refusing to pass the request on.');
    console.log('Nothing here says whether the token or the payload is right; that is still');
    console.log('unknown. Run this again from a machine with direct outbound HTTPS, or allow');
    console.log(`${new URL(url).host} in the network egress settings of this environment.`);
    return;
  }

  if (accepted.length) {
    console.log(`Accepted by: ${accepted.map((r) => `${r.shape} + ${r.auth}`).join(', ')}`);
    console.log('Use that combination. If the body is an error describing missing fields, the');
    console.log('credential is right and only the payload is still unknown.');
  } else if (authFailed.length === rows.length) {
    console.log('Every attempt was rejected as unauthorised. Either the token is not valid for');
    console.log('this environment, or it belongs somewhere none of these styles put it.');
  } else {
    console.log('No attempt was accepted. Compare the bodies above: the most specific error');
    console.log('(one that names a field or a service) is the closest to the right shape.');
  }
  console.log('\nPaste this whole report back — the exact wording of the errors is what says');
  console.log('which payload the adapter wants.');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = 'true';
    }
  }
  return out;
}
