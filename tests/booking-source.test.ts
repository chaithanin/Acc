import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BookingError,
  checkUnits,
  credentialsFromEnv,
} from '@/lib/sources/booking/client';
import { compareSaleValue, mapBookingUnits, priceFor } from '@/lib/sources/booking/map';
import type { BookingUnit } from '@/lib/sources/booking/types';
import { bookingAgencies, bookingUnits } from './fixtures/booking-api';

const run = (projectIdByName?: Map<string, string>) =>
  mapBookingUnits(bookingUnits, bookingAgencies, { reportDate: '2026-09-11', projectIdByName });

const byProject = (name: string) => {
  const row = run().inventory.find((r) => r.project === name);
  assert.ok(row, `no inventory for ${name}`);
  return row!;
};

/**
 * The single most expensive misreading available in this API, and the reason
 * the guide puts a warning box around it: the word Booked means sold in one
 * field and not-yet-paid in the other.
 */
describe('the word Booked', () => {
  it('does not count a unit whose code is BOOKED as sold', () => {
    const marina = byProject('MARINA GOLDEN BAY VICTORIA');
    // 601 is SOLD. 602 has status "Waiting Payment" and code BOOKED.
    assert.equal(marina.sold, 1, 'a unit waiting for payment was counted as a sale');
  });

  it('counts a unit whose display status reads Booked but whose code is SOLD', () => {
    const loveit = byProject('Project LOVEIT');
    assert.equal(loveit.sold, 2);
  });

  it('keeps the waiting-for-payment unit in the pipeline rather than losing it', () => {
    const marina = byProject('MARINA GOLDEN BAY VICTORIA');
    // 602 BOOKED + 701 RESERVED.
    assert.equal(marina.pipeline, 2);
  });

  it('every unit on the market is sold, pipeline or available and nothing else', () => {
    for (const row of run().inventory) {
      assert.equal(row.sold + row.pipeline + row.available, row.sellable,
        `${row.project} does not add up`);
    }
  });
});

/**
 * Foreign ownership is capped at 49% of the area, so a unit is priced once per
 * buyer type. Reading one column for all of them is wrong in the direction
 * that flatters nobody: it understates wherever the foreign price is higher.
 */
describe('the three prices', () => {
  const at = (unitCode: string): BookingUnit =>
    bookingUnits.find((u) => u.unit === unitCode)!;

  it('prices a foreign-quota unit at the foreign price', () => {
    // LOVEIT A101 is FQ: 1,080,000 rather than the 1,000,000 Thai price.
    assert.equal(priceFor(at('A101')), 1_080_000);
  });

  it('prices a Thai-quota unit at the Thai price', () => {
    assert.equal(priceFor(at('A102')), 1_200_000);
  });

  it('prices a Thai-individual unit at its own column, not the company one', () => {
    // 701 is TQ at 3,050,000 where the company price is 3,100,000.
    assert.equal(priceFor(at('701')), 3_050_000);
  });

  it('values a unit with no buyer yet at the list price rather than the highest', () => {
    // 702 has no quota; tc is the published list price.
    assert.equal(priceFor(at('702')), 3_200_000);
  });

  it('reports no price rather than zero when a unit carries none', () => {
    assert.equal(priceFor(at('703')), null);
  });

  it('sums LOVEIT at the prices its quotas imply', () => {
    // 1,080,000 (FQ) + 1,200,000 (TC) + 1,300,000 (available, list).
    assert.equal(byProject('Project LOVEIT').saleValue, 3_580_000);
    // Sold value is the two sold units only.
    assert.equal(byProject('Project LOVEIT').soldValue, 2_280_000);
  });
});

describe('what a project expects to sell for', () => {
  it('leaves out a unit blocked from sale', () => {
    const marina = byProject('MARINA GOLDEN BAY VICTORIA');
    // 2,990,000 + 3,240,000 + 3,050,000 + 3,200,000. 703 has no price and
    // 801 is blocked at 9,000,000 — counting it would inflate by a third.
    assert.equal(marina.saleValue, 12_480_000);
    assert.equal(marina.offMarket, 1);
  });

  it('keeps a blocked unit out of the sellable count as well', () => {
    assert.equal(byProject('MARINA GOLDEN BAY VICTORIA').sellable, 5);
  });

  it('says how much it could not value, rather than reporting a short total quietly', () => {
    const issue = run().issues.find((i) => i.code === 'BOOKING_UNPRICED_UNIT');
    assert.ok(issue, 'a unit had no price and nothing said so');
    assert.match(issue!.message, /^1 unit on the market carries no price/);
    assert.match(issue!.message, /adds nothing .* short by its value\.$/,
      'the singular warning does not read as a sentence');
  });
});

/**
 * Booking and Mango both know what a project expects to sell for and reach it
 * by different routes. A gap means one of them is behind, which is a question
 * for a person rather than something to resolve by picking a favourite.
 */
describe('disagreeing with Mango', () => {
  it('reports a gap instead of choosing a winner', () => {
    const gaps = compareSaleValue(
      new Map([['LOVEIT', 3_580_000]]),
      new Map([['LOVEIT', 3_000_000]]),
    );
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].difference, 580_000);
    assert.ok(gaps[0].share > 0.16 && gaps[0].share < 0.17);
  });

  it('stays quiet about a rounding-sized difference', () => {
    const gaps = compareSaleValue(
      new Map([['LOVEIT', 3_000_010]]),
      new Map([['LOVEIT', 3_000_000]]),
    );
    assert.deepEqual(gaps, []);
  });

  it('says nothing about a project only one of them knows', () => {
    const gaps = compareSaleValue(new Map([['NEW', 1_000_000]]), new Map());
    assert.deepEqual(gaps, []);
  });
});

describe('failing usefully', () => {
  it('refuses a key that is still the example', () => {
    for (const key of ['…', '<key>', 'changeme']) {
      assert.throws(
        () => credentialsFromEnv({ BOOKING_API_KEY: key } as unknown as NodeJS.ProcessEnv),
        (err: unknown) => err instanceof BookingError,
        `${JSON.stringify(key)} was accepted as a key`,
      );
    }
  });

  it('says a key is the wrong shape before the API says it is unauthorised', () => {
    assert.throws(
      () => credentialsFromEnv({ BOOKING_API_KEY: 'sk_live_something_else' } as unknown as NodeJS.ProcessEnv),
      (err: unknown) => err instanceof BookingError && /bk_live_/.test((err as Error).message),
    );
  });

  it('accepts a real-looking key and defaults the base URL', () => {
    const creds = credentialsFromEnv({
      BOOKING_API_KEY: `bk_live_${'a'.repeat(43)}`,
    } as unknown as NodeJS.ProcessEnv);
    assert.match(creds.baseUrl, /booking\.chaithanin\.com\/api\/integration\/v1$/);
  });

  it('notices when every unit came back without a price', () => {
    const stripped = bookingUnits.map((u) => ({ ...u, price: { tc: null, tq: null, fq: null } }));
    const findings = checkUnits(stripped);
    assert.ok(findings.some((f) => /no unit carries a price/i.test(f.detail)));
  });

  it('notices an empty answer rather than reporting a company with no units', () => {
    assert.ok(checkUnits([]).some((f) => f.level === 'empty'));
  });
});

describe('placing it against the projects here', () => {
  it('matches a project by name when one is known', () => {
    const result = run(new Map([['Project LOVEIT', 'proj-loveit']]));
    assert.equal(result.inventory.find((r) => r.project === 'Project LOVEIT')?.projectId, 'proj-loveit');
  });

  it('names the projects it could not place, and keeps them', () => {
    const result = run(new Map([['Project LOVEIT', 'proj-loveit']]));
    const issue = result.issues.find((i) => i.code === 'BOOKING_UNMATCHED_PROJECT');
    assert.ok(issue, 'an unmatched project was dropped without a word');
    assert.match(issue!.message, /MARINA GOLDEN BAY VICTORIA/);
    assert.equal(result.inventory.length, 2, 'the unmatched project was dropped');
  });
});

/**
 * Following the pages.
 *
 * The guide caps a page at 500 and the projects here run to 702 units, so a
 * client that reads page one and stops reports a project two-thirds its real
 * size — with no error anywhere, because every request succeeded. This runs
 * the real client against a real server to prove it walks to the end.
 */
describe('paging', () => {
  const serve = async (
    handler: (url: URL) => { status?: number; headers?: Record<string, string>; body: unknown },
  ) => {
    const http = await import('node:http');
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, 'http://127.0.0.1');
      const { status = 200, headers = {}, body } = handler(url);
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    return { base: `http://127.0.0.1:${port}`, close: () => server.close() };
  };

  const key = `bk_live_${'a'.repeat(43)}`;

  it('walks every page rather than reporting the first one as the answer', async () => {
    const all = Array.from({ length: 702 }, (_, i) => ({
      project: 'BIG', unit: String(i + 1), statusCode: 'AVAILABLE',
      price: { tc: 1_000_000, tq: 1_000_000, fq: 1_000_000 }, quota: null,
    }));

    let requests = 0;
    const { base, close } = await serve((url) => {
      if (url.pathname.endsWith('/me')) {
        return { body: { ok: true, key: { id: 'k', name: 'K', scopes: ['read:units'] } } };
      }
      requests += 1;
      const limit = Number(url.searchParams.get('limit'));
      const page = Number(url.searchParams.get('page'));
      return {
        body: {
          ok: true, page, limit, total: all.length,
          pages: Math.ceil(all.length / limit),
          data: all.slice((page - 1) * limit, page * limit),
        },
      };
    });

    try {
      const { BookingClient } = await import('@/lib/sources/booking/client');
      const client = new BookingClient({ baseUrl: base, apiKey: key });
      const units = await client.units({}, 200);

      assert.equal(units.length, 702, 'the pull stopped short of the last page');
      assert.equal(requests, 4, '702 units at 200 a page is four requests');
      assert.equal(new Set(units.map((u) => u.unit)).size, 702, 'a page was fetched twice');
    } finally {
      close();
    }
  });

  it('waits the time a 429 asks for instead of hammering', async () => {
    let attempts = 0;
    const { base, close } = await serve((url) => {
      if (url.pathname.endsWith('/me')) {
        return { body: { ok: true, key: { id: 'k', name: 'K', scopes: ['read:units'] } } };
      }
      attempts += 1;
      if (attempts === 1) {
        return { status: 429, headers: { 'retry-after': '1' }, body: { ok: false, error: 'slow down' } };
      }
      return { body: { ok: true, page: 1, limit: 500, total: 0, pages: 1, data: [] } };
    });

    try {
      const { BookingClient } = await import('@/lib/sources/booking/client');
      const client = new BookingClient({ baseUrl: base, apiKey: key });

      const started = Date.now();
      await client.units();
      const waited = Date.now() - started;

      assert.equal(attempts, 2, 'the retry did not happen');
      assert.ok(waited >= 950, `retried after ${waited}ms, before the second it was asked to wait`);
    } finally {
      close();
    }
  });
});
