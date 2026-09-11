import http from 'node:http';

/**
 * A stand-in for the Booking API, for exercising the client without a key.
 *
 * It answers in the shape the integration guide documents, including the parts
 * that are easy to get wrong and therefore worth testing against: scoped keys
 * that 403 on the wrong endpoint, real pagination, and a 429 with a
 * Retry-After on demand.
 *
 *   node --import ./scripts/register-ts.mjs scripts/booking-stub.mjs [port]
 *
 * Env:
 *   STUB_KEY      the key it accepts       (default: bk_live_<43 a's>)
 *   STUB_SCOPES   comma-separated scopes   (default: projects, units, agencies)
 *   STUB_429      answer 429 this many times before succeeding (default: 0)
 */

const { bookingProjects, bookingUnits, bookingAgencies, bookingEvents } =
  await import('../tests/fixtures/booking-api.ts');

const PORT = Number(process.argv[2] ?? 4320);
const KEY = process.env.STUB_KEY ?? `bk_live_${'a'.repeat(43)}`;
const SCOPES = (process.env.STUB_SCOPES ?? 'read:projects,read:units,read:agencies')
  .split(',').map((s) => s.trim()).filter(Boolean);
let remaining429 = Number(process.env.STUB_429 ?? 0);

const json = (res, body, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ version: 'v1', ...body }));
};

const needs = (res, scope) => {
  if (SCOPES.includes(scope)) return false;
  json(res, { ok: false, error: `this key does not carry ${scope}`, required: [scope] }, 403);
  return true;
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname.replace(/^\/api\/integration\/v1/, '');
  const q = url.searchParams;

  // --- health: the one endpoint that needs no key
  if (path === '/health') {
    return json(res, { ok: true, source: 'booking-stub', time: new Date().toISOString() });
  }

  const header = req.headers.authorization ?? '';
  const presented = header.replace(/^Bearer\s+/i, '') || req.headers['x-api-key'];
  if (presented !== KEY) {
    return json(res, { ok: false, error: 'invalid or revoked key' }, 401);
  }

  // --- the rate limit, on demand, so the client's backoff can be exercised
  if (remaining429 > 0 && path !== '/me') {
    remaining429 -= 1;
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
    return res.end(JSON.stringify({ ok: false, error: 'rate limited' }));
  }

  if (path === '/me') {
    return json(res, { ok: true, key: { id: 'stub', name: 'Stub Key', scopes: SCOPES } });
  }

  if (path === '/projects') {
    if (needs(res, 'read:projects')) return undefined;
    return json(res, { ok: true, data: bookingProjects });
  }

  if (path === '/units') {
    if (needs(res, 'read:units')) return undefined;

    let rows = bookingUnits;
    if (q.get('project')) rows = rows.filter((u) => u.project === q.get('project'));
    if (q.get('statusCode')) rows = rows.filter((u) => u.statusCode === q.get('statusCode'));
    if (q.get('updatedSince')) {
      const since = Date.parse(q.get('updatedSince'));
      if (Number.isNaN(since)) {
        return json(res, { ok: false, error: 'updatedSince must be ISO 8601' }, 400);
      }
      rows = rows.filter((u) => Date.parse(u.updatedAt ?? 0) >= since);
    }

    // Real paging, deliberately with a small default so the client's
    // follow-the-pages loop is actually tested rather than fitting in one.
    const limit = Math.min(Number(q.get('limit') ?? 100) || 100, 500);
    const page = Math.max(1, Number(q.get('page') ?? 1) || 1);
    const pages = Math.max(1, Math.ceil(rows.length / limit));
    const slice = rows.slice((page - 1) * limit, page * limit);

    return json(res, { ok: true, page, limit, total: rows.length, pages, data: slice });
  }

  if (path === '/agencies/sales') {
    if (needs(res, 'read:agencies')) return undefined;
    return json(res, { ok: true, count: bookingAgencies.length, data: bookingAgencies });
  }

  if (path === '/events') {
    if (needs(res, 'read:events')) return undefined;
    const after = q.get('cursor');
    const start = after ? bookingEvents.findIndex((e) => e.id === after) + 1 : 0;
    const slice = bookingEvents.slice(start);
    return json(res, {
      ok: true, count: slice.length, hasMore: false,
      nextCursor: slice.at(-1)?.id ?? after ?? null, data: slice,
    });
  }

  return json(res, { ok: false, error: `no such endpoint: ${path}` }, 404);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`booking stub on http://127.0.0.1:${PORT}/api/integration/v1`);
  console.log(`  key    ${KEY}`);
  console.log(`  scopes ${SCOPES.join(', ') || '(none)'}`);
});
