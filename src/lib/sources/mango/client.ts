import { BUNDLE_TABLES, type MangoBundle, type MangoProject } from './types';

/**
 * Reading Mango RE.
 *
 * Mango is ASP.NET MVC with a Vue front end, and every screen already fetches
 * its data from a JSON endpoint. Those endpoints are what this reads — there
 * is no need to drive a browser and export spreadsheets.
 *
 * Two things to know about them. They are internal endpoints with no published
 * contract, so an upgrade can rename a column without warning; the schema check
 * below reports that rather than letting a silently-empty field become a
 * silently-wrong figure. And every response is filtered by the permissions of
 * the account that logged in, so a pull is only as complete as that account's
 * project rights — which is why the result says how many projects it saw.
 *
 * Credentials come from the environment and are never written anywhere. The
 * account should be a service account: Mango keeps an audit log of every menu
 * a user opens, and a person's own login would fill it with machine traffic.
 */

export interface MangoCredentials {
  baseUrl: string;
  username: string;
  password: string;
  /**
   * The company being signed in to — MG1 is Chaithanin Co., Ltd.
   *
   * Mango is multi-company and the login carries this alongside the username.
   * Without it the sign-in fails exactly as a wrong password does.
   */
  maincode: string;
}

export class MangoError extends Error {
  readonly detail?: unknown;

  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = 'MangoError';
    this.detail = detail;
  }
}

/** Reads credentials from the environment, or says exactly which is missing. */
export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): MangoCredentials {
  const missing = ['MANGO_BASE_URL', 'MANGO_USER', 'MANGO_PASS'].filter((k) => !env[k]?.trim());
  if (missing.length > 0) {
    throw new MangoError(
      `Mango credentials are not set: ${missing.join(', ')}. `
      + 'Use a service account with rights to every project, not a person’s own login.',
    );
  }

  // A pasted template is the ordinary way this goes wrong, and it otherwise
  // fails several steps later as a rejected sign-in — which sends whoever is
  // running it to reset a password that was never the problem.
  //
  // The ellipsis is here because documentation writes it: an instruction that
  // reads MANGO_USER=… gets copied whole, ellipsis and all, and that is a
  // value somebody chose to type rather than a credential they hold.
  const PLACEHOLDER = /^<.*>$|^(your|xxx+|changeme|placeholder)|^[…．.\-_*·•]+$/i;
  const placeholders = ['MANGO_BASE_URL', 'MANGO_USER', 'MANGO_PASS']
    .filter((k) => PLACEHOLDER.test(env[k]!.trim()));
  if (placeholders.length > 0) {
    throw new MangoError(
      `These still hold the placeholder from the instructions: ${placeholders.join(', ')}. `
      + 'Put the real service-account details in before running.',
    );
  }

  return {
    baseUrl: env.MANGO_BASE_URL!.trim().replace(/\/+$/, ''),
    username: env.MANGO_USER!.trim(),
    password: env.MANGO_PASS!,
    maincode: (env.MANGO_MAINCODE?.trim() || 'MG1').toUpperCase(),
  };
}

export interface MangoCompany {
  code: string;
  name?: string;
}

/**
 * The companies this Mango serves, read out of the login page.
 *
 * The page ships its own company list to populate the picker, which makes a
 * wrong `maincode` catchable before any credentials are sent — and turns
 * "sign-in failed" into "this Mango has no company MG9, it has MG1..MG6".
 *
 * The list is embedded as a JSON string inside a template literal, so this
 * looks for that and gives up quietly rather than guessing: an unreadable
 * list means the check is skipped, never that the login is refused.
 */
export function companiesFrom(html: string): MangoCompany[] {
  const block = html.match(/compData\s*:\s*JSON\.parse\(\s*`([\s\S]*?)`\s*\)/)
    ?? html.match(/compData\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
  if (!block) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(block[1]!);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: MangoCompany[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const code = String(record.maincode ?? record.code ?? record.value ?? '').trim();
    if (!code) continue;
    const name = record.compname ?? record.name ?? record.text ?? record.description;
    out.push({ code: code.toUpperCase(), name: name ? String(name).trim() : undefined });
  }
  return out;
}

/**
 * A cookie jar just large enough for one session.
 *
 * Mango authenticates with a form post and a session cookie; fetch does not
 * keep cookies, so they are kept here rather than pulling in a dependency for
 * the handful of pairs involved.
 */
class CookieJar {
  private readonly jar = new Map<string, string>();

  absorb(response: Response): void {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const eq = pair?.indexOf('=') ?? -1;
      if (eq > 0) this.jar.set(pair!.slice(0, eq).trim(), pair!.slice(eq + 1).trim());
    }
  }

  header(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  get size(): number {
    return this.jar.size;
  }
}

export class MangoClient {
  private readonly jar = new CookieJar();
  private authenticated = false;

  private readonly credentials: MangoCredentials;
  private readonly timeoutMs: number;

  constructor(credentials: MangoCredentials, timeoutMs = 120_000) {
    this.credentials = credentials;
    this.timeoutMs = timeoutMs;
  }

  private url(path: string): string {
    return `${this.credentials.baseUrl}/${path.replace(/^\/+/, '')}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      // Mango's controllers answer JSON to an XHR and HTML to anything else.
      'x-requested-with': 'XMLHttpRequest',
      accept: 'application/json, text/plain, */*',
      'user-agent': 'GTG-Financial/1.0 (+acc.chaithanin.com)',
      ...(this.jar.size > 0 ? { cookie: this.jar.header() } : {}),
      ...extra,
    };
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal, redirect: 'manual' });
      this.jar.absorb(response);
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Signs in.
   *
   * There are two Mango login pages in the wild and they take entirely
   * different posts, which is the single thing most likely to make this fail
   * against a live deployment.
   *
   * The current one is Vue. It renders no useful form and sends its own AJAX
   * post of JSON to `authentication/login_do`, carrying a third field beyond
   * the username and password: `maincode`, the company being signed in to.
   * Omit it and the sign-in fails in a way that reads exactly like a wrong
   * password. Older deployments are ASP.NET forms with an anti-forgery token
   * to echo back, so the page is asked which it is rather than assumed.
   *
   * Cookies are the other half. A session is several cookies, not one, and
   * some of them are set on the 302 that follows the post rather than on the
   * post itself — so the redirect chain is walked by hand, collecting cookies
   * at every hop. Letting fetch follow redirects loses them, and the failure
   * appears later as a data endpoint answering HTML.
   */
  async login(): Promise<this> {
    const loginUrl = this.url('Authentication/Login');

    let page: Response;
    try {
      page = await this.request(loginUrl, { headers: this.headers({ accept: 'text/html' }) });
    } catch (err) {
      throw new MangoError(
        `Could not reach ${this.credentials.baseUrl}. `
        + 'Check the address, and check whether outbound access to it is allowed from this machine.',
        err,
      );
    }

    // Mango serves the login page to anyone — that is the point of a login
    // page. A refusal here is almost never Mango: it is something between this
    // machine and Mango saying no. Saying "the form moved" instead would send
    // whoever is on call hunting through endpoints that are perfectly fine.
    if (!page.ok) {
      throw new MangoError(
        `${loginUrl} answered ${page.status} before any credentials were sent. `
        + 'The login page is public, so this is a network or proxy refusal rather than a rejected '
        + 'sign-in — check that outbound access to this host is allowed.',
      );
    }

    const html = await page.text();

    // The company list is printed into the page, so a wrong maincode can be
    // caught here by name rather than arriving as a failed sign-in.
    const companies = companiesFrom(html);
    if (companies.length > 0 && !companies.some((c) => c.code === this.credentials.maincode)) {
      throw new MangoError(
        `This Mango serves no company "${this.credentials.maincode}". It offers: `
        + `${companies.map((c) => `${c.code}${c.name ? ` (${c.name})` : ''}`).join(', ')}. `
        + 'Set MANGO_MAINCODE to the right one.',
      );
    }

    if (/login_do/i.test(html)) await this.loginDo(loginUrl);
    else await this.loginForm(html, loginUrl);

    if (!(await this.isAuthenticated())) {
      throw new MangoError(
        'Signed in but Mango still reports no session. Check the credentials, '
        + 'and check whether the account is locked or needs a password change.',
      );
    }

    this.authenticated = true;
    return this;
  }

  /**
   * The Vue login: JSON to `authentication/login_do`.
   *
   * It answers the same `{success, error}` envelope everything else does, so a
   * rejected sign-in says why. If the deployment wants form encoding instead —
   * some builds do — the post is repeated that way rather than reported as a
   * failure, since the difference is not something an operator can act on.
   */
  private async loginDo(referer: string): Promise<void> {
    const url = this.url('authentication/login_do');
    const payload = {
      userid: this.credentials.username,
      userpass: this.credentials.password,
      maincode: this.credentials.maincode,
    };

    const post = (contentType: string, body: string) => this.request(url, {
      method: 'POST',
      headers: this.headers({ 'content-type': contentType, referer, accept: 'application/json' }),
      body,
    });

    // The envelope has to be read off this response before the redirect chain
    // is walked — a body can only be read once, and following first throws the
    // answer away.
    let response = await post('application/json', JSON.stringify(payload));
    let body = await this.envelope(response);

    // A redirect is an answer in itself: this build signs in and sends you on
    // rather than replying in JSON.
    const redirected = response.status >= 300 && response.status < 400;

    if (body === null && !redirected) {
      response = await post(
        'application/x-www-form-urlencoded',
        new URLSearchParams(payload).toString(),
      );
      body = await this.envelope(response);
      if (body === null && !(response.status >= 300 && response.status < 400)) {
        throw new MangoError(
          'authentication/login_do answered neither JSON nor a redirect. Either this is not a Mango '
          + 'login page, or something answered in its place.',
        );
      }
    }

    if (body?.success === false) {
      const detail = [body.error, body.error_type].filter(Boolean).join(' — ');
      throw new MangoError(
        `Mango refused the sign-in${detail ? `: ${detail}` : '.'} `
        + `The account is "${this.credentials.username}" against company ${this.credentials.maincode}.`,
      );
    }

    // Now the redirects, for the cookies they set on the way.
    await this.follow(response);
  }

  /** Reads an envelope out of a response, or null if it did not answer JSON. */
  private async envelope(
    response: Response,
  ): Promise<{ success?: boolean; error?: string; error_type?: string } | null> {
    const text = await response.text();
    if (!text.trim()) return null;
    try {
      const body = JSON.parse(text) as Record<string, unknown>;
      return body && typeof body === 'object' ? body : null;
    } catch {
      return null;
    }
  }

  /**
   * The older ASP.NET form.
   *
   * Field names are read from the form rather than hard-coded: Mango renames
   * them between builds, and an anti-forgery token has to be echoed back.
   */
  private async loginForm(html: string, loginUrl: string): Promise<void> {
    const form = html.match(/<form\b[\s\S]*?<\/form>/i)?.[0];
    if (!form) {
      throw new MangoError(
        'This login page is neither the Vue one nor an ASP.NET form. Either the page has been '
        + 'restructured, or something returned a page of its own in Mango\u2019s place.',
      );
    }

    const fields = new Map<string, string>();
    let userField: string | null = null;
    let passField: string | null = null;

    for (const tag of form.match(/<input\b[^>]*>/gi) ?? []) {
      const name = tag.match(/name="([^"]+)"/i)?.[1];
      if (!name) continue;
      const type = (tag.match(/type="([^"]+)"/i)?.[1] ?? 'text').toLowerCase();
      fields.set(name, tag.match(/value="([^"]*)"/i)?.[1] ?? '');

      if (type === 'password') passField = name;
      else if ((type === 'text' || type === 'email') && !userField) userField = name;
    }

    if (!userField || !passField) {
      throw new MangoError(
        `Could not tell which login fields are which. The form offered: ${[...fields.keys()].join(', ')}`,
      );
    }

    fields.set(userField, this.credentials.username);
    fields.set(passField, this.credentials.password);
    // Harmless where the form has no company field, and necessary where it does.
    if (!fields.has('maincode')) fields.set('maincode', this.credentials.maincode);

    const action = form.match(/action="([^"]*)"/i)?.[1] || 'Authentication/Login';
    const postUrl = action.startsWith('http')
      ? action
      : action.startsWith('/')
        ? new URL(action, this.credentials.baseUrl).toString()
        : this.url(action);

    const submitted = await this.follow(await this.request(postUrl, {
      method: 'POST',
      headers: this.headers({
        'content-type': 'application/x-www-form-urlencoded',
        referer: loginUrl,
        accept: 'text/html',
      }),
      body: new URLSearchParams([...fields]).toString(),
    }));
    await submitted.text();
  }

  /**
   * Walks a redirect chain by hand, keeping the cookies set along the way.
   *
   * This is not a detail. Mango sets part of the session on the 302 after a
   * successful post, and `redirect: "follow"` drops those — leaving a client
   * that believes it signed in and is then answered with the login page by
   * every endpoint it asks.
   */
  private async follow(response: Response, hops = 5): Promise<Response> {
    let current = response;

    for (let hop = 0; hop < hops; hop += 1) {
      if (current.status < 300 || current.status >= 400) return current;
      const location = current.headers.get('location');
      if (!location) return current;

      const next = new URL(location, current.url || this.credentials.baseUrl).toString();
      // Drain unless the caller already read it — reading twice throws, and
      // leaving it undrained holds the socket open.
      if (!current.bodyUsed) await current.text().catch(() => undefined);
      current = await this.request(next, { headers: this.headers({ accept: 'text/html' }) });
    }

    return current;
  }


  async isAuthenticated(): Promise<boolean> {
    try {
      const response = await this.request(this.url('api/public/AuthStatus'), {
        headers: this.headers(),
      });
      if (response.status >= 300 && response.status < 400) return false;
      if (!response.ok) return false;
      const body = await response.text();
      // A signed-out request is answered with the login page, not with JSON.
      return !/login/i.test(response.headers.get('location') ?? '') && !/<form/i.test(body);
    } catch {
      return false;
    }
  }

  /** Calls an endpoint and unwraps Mango's `{success, error, data}` envelope. */
  async get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    if (!this.authenticated) {
      throw new MangoError('Call login() before reading anything.');
    }

    const url = new URL(this.url(path));
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

    const response = await this.request(url.toString(), { headers: this.headers() });

    if (response.status >= 300 && response.status < 400) {
      throw new MangoError(
        `${path} redirected to ${response.headers.get('location')} — the session has probably lapsed.`,
      );
    }
    if (!response.ok) {
      throw new MangoError(`${path} answered ${response.status}.`);
    }

    const text = await response.text();
    if (!(response.headers.get('content-type') ?? '').includes('json')) {
      throw new MangoError(
        `${path} did not answer JSON. Either the session lapsed or this account cannot see it.`,
      );
    }

    const body = JSON.parse(text) as unknown;
    if (body && typeof body === 'object' && 'success' in body) {
      const envelope = body as { success: boolean; error: string | null; data: T };
      if (!envelope.success) throw new MangoError(`${path} failed: ${envelope.error}`, envelope.error);
      return envelope.data;
    }

    return body as T;
  }

  /** Projects this account may see. The code in `pre_event2` filters everything else. */
  projects(take = 200, search = ''): Promise<MangoProject[]> {
    return this.get<MangoProject[]>('RE_Master_data/projectmodal3', {
      skip: 0,
      take,
      show_unit: 'false',
      show_project: 'true',
      check_rights: 'true',
      re_only: 'true',
      show_close: 'false',
      search_text: search,
    });
  }

  /**
   * The whole sales ledger in one call: bookings, contracts, transfers,
   * receipts, asking prices and monthly targets.
   */
  allTransactionData(projects: string[] = []): Promise<MangoBundle> {
    return this.get<MangoBundle>('re/reportx/All_Transaction_Data', {
      pre_event2_arr: projects.join(','),
    });
  }
}

export interface SchemaFinding {
  table: string;
  level: 'missing_table' | 'empty_table' | 'missing_column';
  detail: string;
}

/**
 * What changed since the survey.
 *
 * These are undocumented internal endpoints, so a column that disappears in an
 * upgrade would otherwise arrive as an undefined that coerces to zero — a
 * silently wrong figure rather than a loud failure. This compares what came
 * back against what September 2026 found, and the caller decides what to do.
 */
const EXPECTED_COLUMNS: Record<string, string[]> = {
  transaction: ['docno', 'pre_event2', 'pre_event', 'customer_name', 'netamount', 'book_status', 'contract_status', 'transfer_status', 'cancel_status'],
  transaction_detail: ['docno', 'rcptno', 'rcptdate', 'amount'],
  pricelist: ['pre_event', 'asking_price'],
  sale_target: ['year', 'month'],
  status_loan: ['docno', 'status'],
};

export function checkBundleSchema(bundle: MangoBundle): SchemaFinding[] {
  const findings: SchemaFinding[] = [];

  for (const table of BUNDLE_TABLES) {
    const rows = bundle[table];

    if (!Array.isArray(rows)) {
      findings.push({
        table,
        level: 'missing_table',
        detail: `Mango returned no "${table}" list. The endpoint may have been restructured.`,
      });
      continue;
    }

    if (rows.length === 0) {
      findings.push({
        table,
        level: 'empty_table',
        detail: `"${table}" came back empty — either there is genuinely nothing, or this account has no rights to it.`,
      });
      continue;
    }

    const present = new Set(Object.keys(rows[0] as Record<string, unknown>));
    for (const column of EXPECTED_COLUMNS[table] ?? []) {
      if (!present.has(column)) {
        findings.push({
          table,
          level: 'missing_column',
          detail: `"${table}" no longer carries "${column}". Any figure derived from it would read as zero.`,
        });
      }
    }
  }

  return findings;
}
