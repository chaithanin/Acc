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
  };
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
   * Signs in through the same form a person uses.
   *
   * The field names are read from the form rather than hard-coded: Mango
   * renames them between builds, and an anti-forgery token has to be echoed
   * back. Hard-coding them is how this breaks on an upgrade with a login
   * failure that looks like a wrong password.
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

    const form = html.match(/<form\b[\s\S]*?<\/form>/i)?.[0];
    if (!form) {
      throw new MangoError(
        'Reached Authentication/Login but found no form on it. Either the page has been '
        + 'restructured, or something returned a page of its own in Mango’s place.',
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

    const action = form.match(/action="([^"]*)"/i)?.[1] || 'Authentication/Login';
    const postUrl = action.startsWith('http')
      ? action
      : action.startsWith('/')
        ? new URL(action, this.credentials.baseUrl).toString()
        : this.url(action);

    const submitted = await this.request(postUrl, {
      method: 'POST',
      headers: this.headers({
        'content-type': 'application/x-www-form-urlencoded',
        referer: loginUrl,
        accept: 'text/html',
      }),
      body: new URLSearchParams([...fields]).toString(),
    });
    await submitted.text();

    if (!(await this.isAuthenticated())) {
      throw new MangoError(
        'Signed in but Mango still reports no session. Check the credentials, '
        + 'and check whether the account is locked or needs a password change.',
      );
    }

    this.authenticated = true;
    return this;
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
