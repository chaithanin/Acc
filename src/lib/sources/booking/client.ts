import {
  REQUIRED_UNIT_FIELDS,
  type BookingAgencySale,
  type BookingEventPage,
  type BookingKey,
  type BookingPage,
  type BookingProject,
  type BookingUnit,
} from './types';

/**
 * Reading the Chaithanin Booking API.
 *
 * This is the opposite of the Mango connector in every way that matters: a
 * published read-only API, versioned, with a bearer key, documented scopes,
 * pagination and a rate limit it will tell you about. So this client is short,
 * and what it spends its length on is the three things the guide warns will go
 * wrong in practice.
 *
 * A key is scoped. Asking for `/agencies/sales` with a key that was issued for
 * units answers 403, and at three in the morning that reads like an outage. So
 * `preflight()` asks `/me` first and says which scope is missing before any
 * data call is made.
 *
 * A list is paged, and the page size caps at 500. Fetching page 1 and calling
 * it the answer is how a 702-unit project becomes a 100-unit project in a
 * report, so every list here follows `pages` to the end.
 *
 * A rate limit is real. On 429 the API sends `Retry-After`; retrying sooner
 * extends the limit rather than shortening the wait, so this waits the stated
 * time and no less.
 */

export interface BookingCredentials {
  baseUrl: string;
  apiKey: string;
}

export class BookingError extends Error {
  readonly status?: number;
  readonly detail?: unknown;

  constructor(message: string, status?: number, detail?: unknown) {
    super(message);
    this.name = 'BookingError';
    this.status = status;
    this.detail = detail;
  }
}

const DEFAULT_BASE = 'https://booking.chaithanin.com/api/integration/v1';

/** Reads the key from the environment, or says exactly what is wrong with it. */
export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): BookingCredentials {
  const key = env.BOOKING_API_KEY?.trim();
  if (!key) {
    throw new BookingError(
      'BOOKING_API_KEY is not set. Ask the Booking administrator for a key scoped to this '
      + 'system — one system, one key, so it can be revoked on its own.',
    );
  }

  // The same trap the Mango credentials check exists for: an example copied
  // whole. The guide writes the key as bk_live_… and the ellipsis travels.
  if (/^<.*>$|^(your|xxx+|changeme|placeholder)/i.test(key) || /^[…．.\-_*·•]+$/.test(key)) {
    throw new BookingError(
      'BOOKING_API_KEY still holds the placeholder from the instructions. Put the real key in.',
    );
  }

  // Shape is documented: bk_live_ and 43 random characters. Worth saying now
  // rather than as a 401 later, which reads as "the key was revoked".
  if (!key.startsWith('bk_live_')) {
    throw new BookingError(
      `BOOKING_API_KEY does not look like a Booking key — they begin with "bk_live_". `
      + 'Check that the right value was pasted.',
    );
  }

  return {
    baseUrl: (env.BOOKING_API_URL?.trim() || DEFAULT_BASE).replace(/\/+$/, ''),
    apiKey: key,
  };
}

export class BookingClient {
  private readonly credentials: BookingCredentials;
  private readonly timeoutMs: number;
  /** Filled by preflight(), so a scope failure can be explained rather than guessed at. */
  private scopes: string[] | null = null;

  constructor(credentials: BookingCredentials, timeoutMs = 60_000) {
    this.credentials = credentials;
    this.timeoutMs = timeoutMs;
  }

  private async request(path: string, params: Record<string, unknown> = {}, tries = 3): Promise<unknown> {
    const url = new URL(this.credentials.baseUrl + path);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: {
          authorization: `Bearer ${this.credentials.apiKey}`,
          accept: 'application/json',
          'user-agent': 'GTG-Financial/1.0 (+acc.chaithanin.com)',
        },
        signal: controller.signal,
      });
    } catch (err) {
      throw new BookingError(
        `Could not reach ${this.credentials.baseUrl}. Check the address, and check whether `
        + 'outbound access to it is allowed from this machine.',
        undefined,
        err,
      );
    } finally {
      clearTimeout(timer);
    }

    // Wait the time it asked for. Retrying sooner lengthens the limit.
    if (response.status === 429 && tries > 0) {
      const wait = Number(response.headers.get('retry-after') ?? 5);
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, wait) * 1000));
      return this.request(path, params, tries - 1);
    }

    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    if (!response.ok) throw this.explain(path, response.status, body, text);

    if (body && typeof body === 'object' && (body as { ok?: boolean }).ok === false) {
      throw new BookingError(`${path} answered ok:false — ${text.slice(0, 200)}`, response.status, body);
    }

    return body;
  }

  /**
   * Turns a status code into the sentence that sends the reader to the right
   * place. The guide is explicit about which of these are worth retrying —
   * only 429 and 5xx are — so the message says so rather than leaving a
   * scheduler to hammer a 401 every five minutes.
   */
  private explain(path: string, status: number, body: unknown, text: string): BookingError {
    const stated = (body as { error?: string } | null)?.error;
    const tail = stated ? ` — ${stated}` : text ? ` — ${text.slice(0, 200)}` : '';

    if (status === 401) {
      return new BookingError(
        `${path} answered 401${tail}. The key is missing, wrong, or has been revoked. This will not `
        + 'come right on a retry — check the key, then ask the Booking administrator.',
        status, body,
      );
    }
    if (status === 403) {
      return new BookingError(
        `${path} answered 403${tail}. The key is valid but was not given the scope this endpoint `
        + `needs${this.scopes ? ` — it holds: ${this.scopes.join(', ')}` : ''}. Ask for the scope to be added.`,
        status, body,
      );
    }
    if (status === 400) {
      return new BookingError(
        `${path} answered 400${tail}. A parameter is malformed — a date that is not ISO 8601 is the `
        + 'usual one. Retrying sends the same wrong request.',
        status, body,
      );
    }
    if (status === 404) {
      return new BookingError(`${path} answered 404${tail}. No such project or unit.`, status, body);
    }
    if (status === 429) {
      return new BookingError(
        `${path} answered 429${tail} and kept doing so. The limit is 600 requests a minute; pull `
        + 'less often, or with updatedSince so there is less to pull.',
        status, body,
      );
    }
    return new BookingError(`${path} answered ${status}${tail}.`, status, body);
  }

  /**
   * Asks who this key is before asking it for anything.
   *
   * Fails fast and in the right direction: a missing scope is a 403 on the
   * endpoint that needs it, which looks like the endpoint is broken. Here it
   * is a sentence naming the scope to ask for.
   */
  async preflight(required: string[] = []): Promise<BookingKey> {
    const body = await this.request('/me') as { key?: BookingKey };
    const key = body?.key;
    if (!key) throw new BookingError('/me did not describe the key. The API may have changed.');

    this.scopes = key.scopes ?? [];
    const missing = required.filter((scope) => !this.scopes!.includes(scope));
    if (missing.length > 0) {
      throw new BookingError(
        `The key "${key.name}" does not carry ${missing.join(', ')}. It holds `
        + `${this.scopes!.join(', ') || 'nothing'}. Ask the Booking administrator to add the missing scope.`,
      );
    }
    return key;
  }

  /** Whether preflight saw a scope. Used to skip an optional pull rather than fail it. */
  has(scope: string): boolean {
    return this.scopes?.includes(scope) ?? false;
  }

  async health(): Promise<{ ok: boolean; version?: string; time?: string }> {
    return await this.request('/health') as { ok: boolean; version?: string; time?: string };
  }

  async projects(): Promise<BookingProject[]> {
    const body = await this.request('/projects') as { data?: BookingProject[] };
    return body?.data ?? [];
  }

  /**
   * Every unit matching the filter, following the pages to the end.
   *
   * `pages` is trusted for the count but the loop also stops on an empty page,
   * so a total that shifts mid-pull — somebody selling a unit while this runs
   * — ends the loop rather than spinning on it.
   */
  async units(filter: Record<string, unknown> = {}, pageSize = 500): Promise<BookingUnit[]> {
    const out: BookingUnit[] = [];
    let page = 1;
    let pages = 1;

    do {
      const body = await this.request('/units', { ...filter, page, limit: pageSize }) as BookingPage<BookingUnit>;
      const rows = body?.data ?? [];
      out.push(...rows);
      pages = body?.pages ?? 1;
      if (rows.length === 0) break;
      page += 1;
    } while (page <= pages);

    return out;
  }

  /**
   * Events from a cursor, or from a date the first time.
   *
   * The cursor is the point of this: asking by timestamp every round either
   * repeats or loses whatever happened in the same second as the last one.
   * Returns the next cursor so the caller can store it.
   */
  async events(from: { cursor?: string | null; since?: string | null }, pageSize = 500): Promise<{
    events: BookingEventPage['data'];
    nextCursor: string | null;
  }> {
    const events: BookingEventPage['data'] = [];
    let cursor = from.cursor ?? null;

    for (;;) {
      const params = cursor ? { cursor } : { since: from.since ?? undefined };
      const body = await this.request('/events', { ...params, limit: pageSize }) as BookingEventPage;
      events.push(...(body?.data ?? []));
      cursor = body?.nextCursor ?? cursor;
      if (!body?.hasMore) break;
    }

    return { events, nextCursor: cursor };
  }

  async agencySales(params: { since?: string; project?: string; agency?: string } = {}): Promise<BookingAgencySale[]> {
    const body = await this.request('/agencies/sales', params) as { data?: BookingAgencySale[] };
    return body?.data ?? [];
  }
}

export interface BookingSchemaFinding {
  level: 'missing_field' | 'empty';
  detail: string;
}

/**
 * What the units came back carrying.
 *
 * The Booking API is documented and versioned, so this is a lighter check than
 * Mango's — but a published contract is still a promise rather than a
 * guarantee, and a price that arrives as undefined becomes a project with a
 * sale value of zero, which reads as a project nobody is selling.
 */
export function checkUnits(units: BookingUnit[]): BookingSchemaFinding[] {
  const findings: BookingSchemaFinding[] = [];
  if (units.length === 0) {
    findings.push({ level: 'empty', detail: 'No units came back. Either the filter matched nothing, or this key sees nothing.' });
    return findings;
  }

  const present = new Set(Object.keys(units[0] as unknown as Record<string, unknown>));
  for (const field of REQUIRED_UNIT_FIELDS) {
    if (!present.has(field)) {
      findings.push({
        level: 'missing_field',
        detail: `A unit no longer carries "${field}". Anything derived from it would read as zero or blank.`,
      });
    }
  }

  const priced = units.filter((u) => u.price && (u.price.tc || u.price.tq || u.price.fq)).length;
  if (priced === 0) {
    findings.push({
      level: 'missing_field',
      detail: 'No unit carries a price in any quota. A sale value built on this would be zero throughout.',
    });
  }

  return findings;
}
