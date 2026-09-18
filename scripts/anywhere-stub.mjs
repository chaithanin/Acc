/**
 * A stand-in for Mango Anywhere, for exercising the browser-borne pull.
 *
 * Three applications on one origin, as the real one is: a front end that
 * serves a sign-in page and then a shell, a service that refuses everything
 * without an `x-mango-auth` header, and a token that only the shell's own
 * JavaScript knows. That last part is the whole point — it is what makes a
 * script signing in by itself insufficient, and what the pull works around by
 * running the front end and taking the token off its traffic.
 *
 *   node scripts/anywhere-stub.mjs         # port 4380
 *
 *   MANGO_ANYWHERE_URL=http://127.0.0.1:4380/production.anywhere \
 *   MANGO_SERVICE_URL=http://127.0.0.1:4380/production.service \
 *   MANGO_USER=svc.dashboard MANGO_PASS=stub-password \
 *     npm run anywhere:pull -- --dry-run
 */

import http from 'node:http';

/**
 * The answers come from the same fixture the tests use, so the stub and the
 * tests cannot drift into disagreeing about what Mango returns. Its columns are
 * the ones a live answer carried, not a guess at them.
 */
const { anywhereFixture } = await import('../tests/fixtures/anywhere-bundle.ts');
const FIXTURE = anywhereFixture();

/** Mango wraps some lists in a grid envelope and returns others bare. */
const grid = (rows) => ({ total: rows.length, data: rows });
const PORT = 4380, USER = 'svc.dashboard', PASS = 'stub-password';
const SESSION = 'sess-1', TOKEN = 'ab12cd34ef56ab78cd90ef12ab34cd56ef78ab90.9a26';
const json = (r, b, s = 200) => { r.writeHead(s, {'content-type':'application/json; charset=utf-8'}); r.end(JSON.stringify(b)); };

http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const app = (u.pathname.match(/^\/(production\.[a-z]+)/) || [])[1] || '';
  const p = u.pathname.replace(/^\/production\.[a-z]+\/?/, '');
  const signed = (req.headers.cookie ?? '').includes(`sid=${SESSION}`);

  if (app === 'production.anywhere' && p === 'login_do' && req.method === 'POST') {
    let raw = ''; req.on('data', c => raw += c);
    req.on('end', () => {
      const sent = JSON.parse(raw);
      if (sent.userid !== USER || sent.userpass !== PASS) return json(res, { success: false, error: 'bad' });
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': `sid=${SESSION}; Path=/` });
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  if (app === 'production.anywhere') {
    if (!signed) {
      // the sign-in page, as a Vue app would render it
      res.writeHead(200, {'content-type':'text/html; charset=utf-8'});
      return res.end(`<!doctype html><html><body><h3>Sign in</h3>
        <form id=f onsubmit="return go(event)">
          <select id=comp><option value="MG1">MG1</option><option value="MG2">MG2</option></select>
          <input type="text" id=u placeholder="user">
          <input type="password" id=p placeholder="pass">
          <button type=submit>Sign in</button>
        </form>
        <script>
        async function go(e){ e.preventDefault();
          const r = await fetch('/production.anywhere/login_do', {method:'POST',
            headers:{'content-type':'application/json'},
            body: JSON.stringify({userid:u.value,userpass:p.value,maincode:comp.value})});
          if ((await r.json()).success) location.reload();
          return false; }
        </script></body></html>`);
    }
    // signed in: the shell, whose own JS authenticates and then fetches
    res.writeHead(200, {'content-type':'text/html; charset=utf-8'});
    return res.end(`<!doctype html><html><body><div id=app>loading…</div><script>
      const T = ${JSON.stringify(TOKEN)};
      (async () => {
        // the start-up the application performs, carrying its token
        for (const path of ['anywhere/api/LayoutModuleConfig','anywhere/center/Maincomp?maincode=MG1','API/UserOnline/UserAuthentication']) {
          await fetch('/production.service/' + path, { headers: { 'x-mango-auth': T } });
        }
        await fetch('/production.service/anywhereAPI/Dashboard/viewArRead?type=MONTH', { headers: { 'x-mango-auth': T } });
        document.getElementById('app').textContent = 'ready';
      })();
    </script></body></html>`);
  }

  if (app === 'production.anywhere' || p === 'login_do') { /* handled above */ }

  if (u.pathname === '/production.anywhere/login_do' && req.method === 'POST') { /* unreachable */ }

  if (app === 'production.service') {
    if (req.headers['x-mango-auth'] !== TOKEN) {
      res.writeHead(403, {'content-type':'text/html'});
      return res.end('<html>Forbidden</html>');
    }
    if (p === 'anywhereAPI/Dashboard/balanceArReadList')
      return json(res, { success: true, data: grid(FIXTURE.arBalances) });
    if (p === 'anywhereAPI/Dashboard/balanceApReadList')
      return json(res, { success: true, data: grid(FIXTURE.apBalances) });
    if (p === 'anywhereAPI/Dashboard/viewArRead')
      return json(res, { success: true, data: grid(FIXTURE.arByMonth) });
    if (p === 'anywhereAPI/Dashboard/viewApRead')
      return json(res, { success: true, data: grid(FIXTURE.apByMonth) });
    // Returned bare, not wrapped — as the live answers are.
    if (p === 'anywhereAPI/Dashboard/BarchartArRead')
      return json(res, { success: true, data: FIXTURE.arAgeing });
    if (p === 'anywhereAPI/Dashboard/BarchartAPRead')
      return json(res, { success: true, data: FIXTURE.apAgeing });
    if (p === 'anywhereAPI/Dashboard/yearDetailARRead')
      return json(res, { success: true, data: grid(FIXTURE.arYear) });
    if (p === 'anywhereAPI/Dashboard/yearDetailAPRead')
      return json(res, { success: true, data: grid(FIXTURE.apYear) });
    if (p === 'anywhereAPI/Dashboard/view_bank_all_v2') {
      const guarantee = u.searchParams.get('bank_guarantee') === 'Y';
      return json(res, { success: true, data: guarantee ? FIXTURE.bankGuarantees : FIXTURE.bankAccounts });
    }
    return json(res, { success: true, data: {} });
  }
  res.writeHead(404, {'content-type':'text/html'}); res.end('<html>404</html>');
}).listen(PORT, '127.0.0.1', () => console.log('up'));
