import http from 'node:http';

/**
 * A stand-in for Mango RE, for testing the pull without touching live data.
 *
 * It answers the four things the client asks for, in the shape the September
 * 2026 survey recorded: a login form with an anti-forgery token to echo back,
 * an auth check, the project list, and All_Transaction_Data. The point is to
 * exercise the real client — form parsing, cookies, the envelope, the schema
 * check — rather than to pretend the data is real.
 *
 *   node --import ./scripts/register-ts.mjs scripts/mango-stub.mjs [port]
 */

const { mangoFixture } = await import('../tests/fixtures/mango-bundle.ts');

const PORT = Number(process.argv[2] ?? 4310);
const USER = process.env.STUB_USER ?? 'svc.dashboard';
const PASS = process.env.STUB_PASS ?? 'stub-password';
const TOKEN = 'stub-anti-forgery-token';
const SESSION = 'stub-session-id';

const json = (res, body, status = 200) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname.replace(/^\/production\.re/, '');
  const signedIn = (req.headers.cookie ?? '').includes(`MangoAuth=${SESSION}`);

  // --- the login form, with a token that has to come back
  if (path === '/Authentication/Login' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body>
      <form method="post" action="/production.re/Authentication/Login">
        <input type="hidden" name="__RequestVerificationToken" value="${TOKEN}">
        <input type="text" name="UserName" value="">
        <input type="password" name="Password" value="">
        <button type="submit">Sign in</button>
      </form></body></html>`);
    return;
  }

  if (path === '/Authentication/Login' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const form = new URLSearchParams(body);
      const ok = form.get('UserName') === USER
        && form.get('Password') === PASS
        && form.get('__RequestVerificationToken') === TOKEN;

      if (!ok) {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><body><form>Sign in failed</form></body></html>');
        return;
      }

      res.writeHead(302, {
        'set-cookie': `MangoAuth=${SESSION}; Path=/; HttpOnly`,
        location: '/production.re/',
      });
      res.end();
    });
    return;
  }

  // --- everything below needs the session
  if (!signedIn) {
    res.writeHead(302, { location: '/production.re/Authentication/Login' });
    res.end();
    return;
  }

  if (path === '/api/public/AuthStatus') return json(res, { success: true, error: null, data: { user: USER } });

  if (path === '/RE_Master_data/projectmodal3') {
    return json(res, {
      success: true, error: null,
      data: [
        { maincode: 'MG1', pre_event2: 'HAMONIA', name: 'Hamonia', proj_type: 'condo', total_units: 3, sold_units: 3, active: 'Y' },
        { maincode: 'MG1', pre_event2: 'MARINA_VTR', name: 'Marina Golden Bay Victoria', proj_type: 'condo', total_units: 4, sold_units: 2, active: 'Y' },
      ],
    });
  }

  if (path === '/re/reportx/All_Transaction_Data') {
    const wanted = (url.searchParams.get('pre_event2_arr') ?? '').split(',').filter(Boolean);
    const bundle = mangoFixture();

    if (wanted.length > 0) {
      const keep = new Set(wanted);
      const docs = new Set(
        (bundle.transaction ?? []).filter((t) => keep.has(String(t.pre_event2))).map((t) => t.docno),
      );
      bundle.transaction = (bundle.transaction ?? []).filter((t) => keep.has(String(t.pre_event2)));
      bundle.transaction_detail = (bundle.transaction_detail ?? []).filter((d) => docs.has(d.docno));
      bundle.pricelist = (bundle.pricelist ?? []).filter((p) => keep.has(String(p.pre_event2)));
      bundle.sale_target = (bundle.sale_target ?? []).filter((s) => keep.has(String(s.pre_event2)));
    }

    return json(res, { success: true, error: null, data: bundle });
  }

  // Mango answers an unknown action with an error inside a 200, not a 404.
  return json(res, { success: false, error: `No action for ${path}`, data: null });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`mango-stub listening on http://127.0.0.1:${PORT}/production.re\n`);
});
