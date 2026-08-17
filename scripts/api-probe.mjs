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

const results = [];

for (const shape of SHAPES) {
  for (const style of AUTH_STYLES) {
    // The no-token control is only worth running once per shape.
    results.push(await probe(shape, style));
  }
}

report(results);

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

/** Keeps the credential out of terminal scrollback and pasted output. */
function mask(text) {
  if (!token) return text;
  const tail = token.slice(-4);
  return text.split(token).join(`***${tail}`);
}

function report(rows) {
  console.log(`\nProbed ${mask(url)}  (${rows.length} attempts)\n`);

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

  const accepted = rows.filter((r) => r.status >= 200 && r.status < 300);
  const authFailed = rows.filter((r) => r.status === 401 || r.status === 403);

  console.log('\n--- Reading this ---');

  // A proxy standing between you and the API answers every attempt the same
  // way, credential or not. Reporting that as "unauthorised" would send you to
  // ask for a new token when the network is what is actually refusing.
  const control = rows.find((r) => r.auth === 'none (control)' && r.shape === 'POST {}');
  const sameWithoutToken =
    control && rows.every((r) => r.status === control.status && r.body === control.body);
  const proxyWorded = rows.some((r) => /allowlist|egress|proxy|blocked by|forbidden by policy/i.test(r.body));

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
