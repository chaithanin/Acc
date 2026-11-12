import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import manifest from '@/app/manifest';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(ROOT, 'public', p.replace(/^\//, '')));

/**
 * Reads a PNG's header rather than decoding it, so the suite stays free of an
 * image library. Transparency in a palette PNG lives in a tRNS chunk; without
 * one every pixel is opaque.
 */
function png(bytes: Buffer) {
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG', 'not a PNG');

  const chunks: string[] = [];
  for (let offset = 8; offset < bytes.length - 8; ) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    chunks.push(type);
    if (type === 'IEND') break;
    offset += 12 + length;
  }

  const colourType = bytes[25];
  const hasAlphaChannel = colourType === 4 || colourType === 6;
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    transparent: hasAlphaChannel || chunks.includes('tRNS'),
  };
}

/**
 * The manifest can declare an icon that was never generated, and nothing
 * fails: the browser quietly drops it, and if it drops them all the install
 * option disappears with no error anywhere. So every entry is checked against
 * the file on disk, at the size it claims to be.
 */
describe('the icons the manifest promises', () => {
  const icons = manifest().icons ?? [];

  it('declares both sizes, in both purposes', () => {
    const declared = icons.map((icon) => `${icon.purpose} ${icon.sizes}`).sort();
    assert.deepEqual(declared, [
      'any 192x192',
      'any 512x512',
      'maskable 192x192',
      'maskable 512x512',
    ]);
  });

  for (const icon of icons) {
    it(`serves ${icon.src} as a square ${icon.sizes}`, () => {
      const { width, height } = png(read(String(icon.src)));
      assert.equal(`${width}x${height}`, icon.sizes);
      assert.equal(width, height, 'a non-square icon is letterboxed by the platform');
    });
  }

  /**
   * A maskable icon is cropped to whatever shape the platform likes and the
   * remainder fills the tile edge to edge. Leave it transparent and the part
   * outside the artwork is filled by the platform — black on most Android
   * launchers — which puts a dark wedge around a logo drawn for white.
   */
  it('gives every maskable icon an opaque background', () => {
    const maskable = icons.filter((icon) => icon.purpose === 'maskable');
    assert.ok(maskable.length > 0);
    for (const icon of maskable) {
      assert.equal(png(read(String(icon.src))).transparent, false, `${icon.src} is transparent`);
    }
  });

  /** The opposite rule: the browser composites these against chrome it knows the colour of. */
  it('leaves the plain icons transparent', () => {
    for (const icon of icons.filter((i) => i.purpose === 'any')) {
      assert.equal(png(read(String(icon.src))).transparent, true, `${icon.src} is opaque`);
    }
  });

  /** iOS composites transparency against black, so this one cannot have any. */
  it('gives iOS an opaque 180px icon of its own', () => {
    const apple = png(read('/icons/apple-touch-icon.png'));
    assert.deepEqual([apple.width, apple.height], [180, 180]);
    assert.equal(apple.transparent, false);
  });

  it('ships a favicon and the logo the interface draws', () => {
    assert.ok(read('/favicon.ico').length > 0);
    assert.equal(png(read('/brand/logo.png')).width, 320);
  });
});

/** Values a browser refuses to install without, or installs wrongly without. */
describe('the manifest itself', () => {
  const m = manifest();

  it('is installable as a standalone app at the root', () => {
    assert.equal(m.display, 'standalone');
    assert.equal(m.start_url, '/');
    assert.equal(m.scope, '/');
    assert.ok(m.name && m.short_name);
    // Twelve characters is roughly what a home screen shows before truncating.
    assert.ok(String(m.short_name).length <= 12, 'short_name will be cut off');
  });

  it('keeps a stable id, so a later change of start_url is the same app', () => {
    assert.equal(m.id, '/');
  });
});

/**
 * The service worker's one dangerous mistake would be remembering something.
 * Every page here is rendered for one signed-in user and full of one company's
 * figures; a cached page is served to whoever opens the app next on a shared
 * machine, showing last week's balances as current.
 *
 * Rather than read the source for reassuring words, the worker is loaded and
 * its fetch handler driven with real Requests, so the test fails if the
 * behaviour changes however the code is rewritten.
 */
describe('what the service worker will and will not keep', () => {
  const ORIGIN = 'https://acc.example.com';

  /**
   * The request and response are plain objects rather than the real classes.
   * `new Request(url, { mode: 'navigate' })` is forbidden to page code, and a
   * Response built in Node reports `type: 'default'` where a same-origin one
   * in a browser reports `'basic'` — so the real classes cannot express the
   * two cases this is here to check. The worker reads only these fields.
   */
  type FakeRequest = { url: string; method: string; mode: string };

  function load() {
    const source = readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8');
    const listeners = new Map<string, (event: unknown) => void>();
    const put: string[] = [];

    const cache = {
      addAll: async () => undefined,
      put: async (request: FakeRequest) => void put.push(new URL(request.url).pathname),
      keys: async () => [],
    };
    const caches = {
      open: async () => cache,
      match: async () => undefined,
      keys: async () => [],
      delete: async () => true,
    };
    const self = {
      addEventListener: (type: string, fn: (event: unknown) => void) => void listeners.set(type, fn),
      location: { origin: ORIGIN },
      clients: { claim: async () => undefined },
    };
    const fetched: string[] = [];
    const fetch = async (request: FakeRequest) => {
      fetched.push(new URL(request.url).pathname);
      // What a browser reports for a same-origin response.
      return { ok: true, type: 'basic', clone: () => ({ body: 'ok' }) };
    };

    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('self', 'caches', 'fetch', source)(self, caches, fetch);
    return { listeners, put, fetched };
  }

  /** Runs one request through the worker and reports whether it intervened. */
  async function handle(url: string, { method = 'GET', mode = 'cors' } = {}) {
    const { listeners, put, fetched } = load();
    const request: FakeRequest = { url, method, mode };

    let responded: Promise<unknown> | null = null;
    listeners.get('fetch')!({
      request,
      respondWith: (r: Promise<unknown>) => void (responded = r),
    });
    if (responded) await responded;

    return { intercepted: responded !== null, cached: put, fetched };
  }

  it('does not touch an API call', async () => {
    const result = await handle(`${ORIGIN}/api/snapshots`);
    assert.equal(result.intercepted, false);
    assert.deepEqual(result.cached, []);
  });

  it('does not touch anything that is not a plain read', async () => {
    const result = await handle(`${ORIGIN}/import`, { method: 'POST' });
    assert.equal(result.intercepted, false);
  });

  it('does not touch another origin', async () => {
    const result = await handle('https://mango.example.com/anything');
    assert.equal(result.intercepted, false);
  });

  it('answers a page from the network and keeps no copy of it', async () => {
    // Navigations are the ones carrying the figures.
    const result = await handle(`${ORIGIN}/receivable`, { mode: 'navigate' });
    assert.equal(result.intercepted, true);
    assert.deepEqual(result.fetched, ['/receivable'], 'the page did not come from the network');
    assert.deepEqual(result.cached, [], 'a page was written to the cache');
  });

  it('keeps build output, which is addressed by content hash', async () => {
    const result = await handle(`${ORIGIN}/_next/static/chunks/main-abc123.js`);
    assert.equal(result.intercepted, true);
    assert.deepEqual(result.cached, ['/_next/static/chunks/main-abc123.js']);
  });

  it('keeps the icons, which are nobody in particular', async () => {
    const result = await handle(`${ORIGIN}/icons/icon-512.png`);
    assert.deepEqual(result.cached, ['/icons/icon-512.png']);
  });

  it('precaches enough for the offline page to draw itself', async () => {
    const source = readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8');
    for (const asset of ['/offline.html', '/icons/icon-192.png']) {
      assert.ok(source.includes(asset), `${asset} is not precached`);
    }
    const offline = readFileSync(path.join(ROOT, 'public/offline.html'), 'utf8');
    // Anything it references that is not precached would be a broken image on
    // the one page that is shown when nothing can be fetched.
    const referenced = [...offline.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(referenced, ['/icons/icon-192.png']);
  });
});
