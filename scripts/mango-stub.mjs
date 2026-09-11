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
const MAINCODE = process.env.STUB_MAINCODE ?? 'MG1';
// The live deployment is the Vue page; STUB_LEGACY=1 serves the older
// ASP.NET form instead, so the fallback path stays exercised too.
const LEGACY = process.env.STUB_LEGACY === '1';
const TOKEN = 'stub-anti-forgery-token';
const SESSION = 'stub-session-id';
// Mango sets part of the session on the redirect after the post, not on the
// post itself — a client that lets fetch follow redirects loses this one.
const REDIRECT_COOKIE = 'mg_re_auth';

const json = (res, body, status = 200) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname.replace(/^\/production\.re/, '');
  // Deliberately the cookie set on the redirect rather than on the post: a
  // client that drops it gets the login page from every data endpoint, which
  // is exactly what happens against the real service.
  const cookies = req.headers.cookie ?? '';
  const signedIn = LEGACY
    ? cookies.includes(`MangoAuth=${SESSION}`)
    : cookies.includes(`${REDIRECT_COOKIE}=${SESSION}`);

  // --- the login page
  if (path === '/Authentication/Login' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });

    if (LEGACY) {
      res.end(`<!doctype html><html><body>
        <form method="post" action="/production.re/Authentication/Login">
          <input type="hidden" name="__RequestVerificationToken" value="${TOKEN}">
          <input type="text" name="UserName" value="">
          <input type="password" name="Password" value="">
          <button type="submit">Sign in</button>
        </form></body></html>`);
      return;
    }

    // The Vue page: no usable form, an AJAX post to login_do, and the company
    // list printed into the page for the picker.
    const companies = JSON.stringify([
      { maincode: 'MG1', compname: 'บริษัท ไชยธนินทร์ จำกัด' },
      { maincode: 'MG2', compname: 'Second Company' },
    ]);
    res.end(`<!doctype html><html><body><div id="app"></div><script>
      new Vue({
        data: {
          formData: { userid: '', userpass: '', maincode: '' },
          compData: JSON.parse(\`${companies}\`)
        },
        methods: { login() { $_post(this.formData, 'authentication/login_do', this.done); } }
      });
    </script></body></html>`);
    return;
  }

  // --- the Vue login: JSON in, envelope out
  if (path === '/authentication/login_do' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let sent;
      try {
        sent = JSON.parse(raw);
      } catch {
        sent = Object.fromEntries(new URLSearchParams(raw));
      }

      if (sent.maincode !== MAINCODE) {
        return json(res, { success: false, error: 'ไม่พบบริษัทนี้', error_type: 'maincode' });
      }
      if (sent.userid !== USER || sent.userpass !== PASS) {
        return json(res, { success: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', error_type: 'credential' });
      }

      // Part of the session here, the rest on the redirect below.
      res.writeHead(302, {
        'set-cookie': [
          `ASP.NET_SessionId=${SESSION}; Path=/; HttpOnly`,
          're_module=re; Path=/',
        ],
        location: '/production.re/',
        'content-type': 'application/json',
      });
      return res.end(JSON.stringify({ success: true, error: null, expire_hours: 8 }));
    });
    return;
  }

  // --- the hop after login, which carries the cookie the session needs
  if (path === '/' || path === '') {
    const head = { 'content-type': 'text/html' };
    if ((req.headers.cookie ?? '').includes(`ASP.NET_SessionId=${SESSION}`)) {
      head['set-cookie'] = `${REDIRECT_COOKIE}=${SESSION}; Path=/; HttpOnly`;
    }
    res.writeHead(200, head);
    return res.end('<html><body>Mango</body></html>');
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
    // The live service wraps the rows in a grid envelope inside the usual
    // envelope — two layers, not one. Answering a bare list here is how this
    // stub used to pass while the real pull crashed.
    return json(res, {
      success: true, error: null,
      data: { total: 2, data: [
        { maincode: 'MG1', pre_event2: 'HAMONIA', name: 'Hamonia', proj_type: 'condo', total_units: 3, sold_units: 3, active: 'Y' },
        { maincode: 'MG1', pre_event2: 'MARINA_VTR', name: 'Marina Golden Bay Victoria', proj_type: 'condo', total_units: 4, sold_units: 2, active: 'Y' },
      ] },
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
