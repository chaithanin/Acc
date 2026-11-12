import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

/**
 * The glass redesign's legibility, as arithmetic.
 *
 * The sheets in this app are translucent, so what is behind a card changes from
 * place to place, and every contrast figure that was validated against a plain
 * surface (docs/DESIGN.md) is only true if the sheet is opaque enough. Nothing
 * stops somebody lowering `--surface` from 0.9 to 0.62 because it looks more
 * like glass; this is what stops them. The values are read out of globals.css,
 * not restated here, so the test follows the stylesheet rather than a copy.
 */

const CSS = readFileSync(path.resolve(import.meta.dirname, '../src/app/globals.css'), 'utf8');

type Tokens = Map<string, string>;

/** The declarations of the first block that opens with `selector {`, balanced. */
function block(selector: string): string {
  const at = CSS.indexOf(`${selector} {`);
  assert.ok(at >= 0, `no block for ${selector}`);
  let depth = 0;
  for (let i = CSS.indexOf('{', at); i < CSS.length; i++) {
    if (CSS[i] === '{') depth++;
    if (CSS[i] === '}' && --depth === 0) return CSS.slice(CSS.indexOf('{', at) + 1, i);
  }
  throw new Error(`unbalanced block for ${selector}`);
}

function tokens(body: string): Tokens {
  const out: Tokens = new Map();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1]!, m[2]!.trim());
  return out;
}

const LIGHT = tokens(block(':root'));
const DARK_ATTR = tokens(block(":root[data-theme='dark']"));
// The dark block as the OS preference sees it: nested in a media query, so it is
// found by its own selector.
const DARK_MEDIA = tokens(block(":root:not([data-theme='light'])"));

/** A theme's token, falling back to light where dark does not restate it. */
const pick = (theme: Tokens, name: string): string => {
  const v = theme.get(name) ?? LIGHT.get(name);
  assert.ok(v, `${name} is not defined`);
  return v;
};

type RGBA = [number, number, number, number];

function colour(value: string): RGBA {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  assert.ok(rgba, `cannot read colour ${value}`);
  return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] === undefined ? 1 : Number(rgba[4])];
}

type RGB = [number, number, number];

const over = (fg: RGBA, bg: RGB, scale = 1): RGB => {
  const a = fg[3] * scale;
  return [0, 1, 2].map((i) => fg[i]! * a + bg[i]! * (1 - a)) as RGB;
};

const linear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: RGB) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Every backdrop a card can sit over: the bare canvas, each pool at full
 * strength, and the pairs of pools that overlap. The two top pools overlapping
 * is the worst for dark text and the least bad for light text; all are tried.
 */
function undersides(theme: Tokens): Map<string, RGB> {
  const plane = colour(pick(theme, '--plane'));
  const paper: RGB = [plane[0], plane[1], plane[2]];
  const pool = [1, 2, 3, 4].map((n) => colour(pick(theme, `--pool-${n}`)));
  const out = new Map<string, RGB>([['canvas', paper]]);
  pool.forEach((p, i) => out.set(`pool ${i + 1}`, over(p, paper)));
  out.set('pools 1+2', over(pool[0]!, out.get('pool 2')!));
  out.set('pools 3+4', over(pool[2]!, out.get('pool 4')!));
  return out;
}

/** The worst contrast of `fg` over `sheet` across every backdrop. */
function worst(theme: Tokens, fg: string, sheet: string | null, scrim = 1): { ratio: number; over: string } {
  const fgRGBA = colour(pick(theme, fg));
  let min = { ratio: Infinity, over: '' };
  for (const [name, under] of undersides(theme)) {
    const behind = under.map((c) => c * scrim) as RGB;
    const surface = sheet ? over(colour(pick(theme, sheet)), behind) : behind;
    const text: RGB = [fgRGBA[0], fgRGBA[1], fgRGBA[2]];
    const ratio = contrast(text, surface);
    if (ratio < min.ratio) min = { ratio, over: name };
  }
  return min;
}

const THEMES: [string, Tokens][] = [
  ['light', LIGHT],
  ['dark', DARK_ATTR],
];

describe('the dark theme is declared twice, and the copies must not drift', () => {
  /**
   * The OS preference and the in-app toggle each need the dark values, and CSS
   * cannot share one block between a media query and an attribute selector, so
   * they are written out twice. A value changed in only one means the toggle
   * and the operating system disagree about what dark looks like.
   */
  it('holds exactly the same tokens in the media query and the attribute block', () => {
    assert.deepEqual([...DARK_MEDIA].sort(), [...DARK_ATTR].sort());
  });

  it('defines every token dark restyles in light too, so nothing is dark-only', () => {
    for (const name of DARK_ATTR.keys()) {
      if (name === '--blur' || name === '--blur-card') continue;
      assert.ok(LIGHT.has(name), `${name} exists in dark but not in light`);
    }
  });
});

describe('text on a data card keeps 4.5:1 over the worst point of the aurora', () => {
  const TEXT = [
    '--ink',
    '--ink-secondary',
    '--ink-muted',
    '--accent',
    '--delta-up',
    '--delta-down',
    '--good-ink',
    '--warning-ink',
    '--critical-ink',
  ];
  for (const [name, theme] of THEMES) {
    for (const fg of TEXT) {
      it(`${name}: ${fg}`, () => {
        const { ratio, over: at } = worst(theme, fg, '--surface');
        assert.ok(ratio >= 4.5, `${fg} is ${ratio.toFixed(2)}:1 over ${at} (needs 4.5)`);
      });
    }
  }
});

describe('chart marks on a data card keep 3:1', () => {
  const MARKS = [
    '--series-1',
    '--series-2',
    '--series-3',
    '--status-good',
    '--status-critical',
    '--income',
    '--expense',
    '--cash',
  ];
  for (const [name, theme] of THEMES) {
    for (const fg of MARKS) {
      /**
       * series-3 in light is the one recorded exception: 2.74:1 on a plain
       * surface when it was validated, with the obligation met by a data table
       * beside every chart (docs/DESIGN.md). On glass it is 2.66. The floor is
       * set just under that so it cannot get worse unnoticed.
       */
      const floor = name === 'light' && fg === '--series-3' ? 2.6 : 3;
      it(`${name}: ${fg} >= ${floor}`, () => {
        const { ratio, over: at } = worst(theme, fg, '--surface');
        assert.ok(ratio >= floor, `${fg} is ${ratio.toFixed(2)}:1 over ${at} (needs ${floor})`);
      });
    }
  }
});

describe('text with no sheet behind it', () => {
  /**
   * The page heading and its description sit straight on the aurora. Muted ink
   * and the accent are not guaranteed there — in light they are 3.34 and 3.13 —
   * which is why headings use ink and ink-secondary only.
   */
  for (const [name, theme] of THEMES) {
    for (const fg of ['--ink', '--ink-secondary']) {
      it(`${name}: ${fg} on the bare aurora`, () => {
        const { ratio, over: at } = worst(theme, fg, null);
        assert.ok(ratio >= 4.5, `${fg} is ${ratio.toFixed(2)}:1 over ${at} (needs 4.5)`);
      });
    }
  }
});

describe('floating chrome and overlays', () => {
  for (const [name, theme] of THEMES) {
    for (const fg of ['--sidebar-ink', '--sidebar-ink-muted']) {
      it(`${name}: ${fg} on the translucent sidebar`, () => {
        const { ratio, over: at } = worst(theme, fg, '--glass-hi');
        assert.ok(ratio >= 4.5, `${fg} is ${ratio.toFixed(2)}:1 over ${at} (needs 4.5)`);
      });
    }

    /**
     * An open drawer sits over a black/40 scrim, which greys whatever the glass
     * is over. On the 64% chrome tier muted text there is 4.2:1; the drawer is
     * an overlay and takes the near-solid tier.
     */
    it(`${name}: muted text on the open drawer, over its scrim`, () => {
      const { ratio, over: at } = worst(theme, '--sidebar-ink-muted', '--pop', 0.6);
      assert.ok(ratio >= 4.5, `${ratio.toFixed(2)}:1 over ${at} (needs 4.5)`);
    });
  }
});

describe('digits', () => {
  /**
   * Urbanist has no tabular figures, so a column of amounts set in it does not
   * line up. The face behind digits is declared for digits only, and must stay
   * that way: if its range grew to cover letters the whole UI would quietly
   * change typeface.
   */
  it('the figures face covers digits and separators, and no letters', () => {
    const face = CSS.match(/@font-face\s*\{[^}]*'GTG Figures'[^}]*\}/s)?.[0];
    assert.ok(face, 'no @font-face for GTG Figures');
    const range = face.match(/unicode-range:\s*([^;]+);/)?.[1];
    assert.ok(range, 'GTG Figures has no unicode-range, so it would claim every character');
    const codes = range.split(',').map((r) => r.trim().replace(/^U\+/, ''));
    for (const r of codes) {
      const [lo, hi = lo] = r.split('-').map((h) => parseInt(h, 16));
      assert.ok(
        !(lo! <= 0x7a && hi! >= 0x41),
        `GTG Figures range ${r} reaches the letters`,
      );
    }
    assert.ok(codes.includes('0030-0039'), 'digits 0-9 are not covered');
  });

  it('is first in the font stack, or the digits would never reach it', () => {
    const sans = CSS.match(/--font-sans:\s*([^;]+);/s)?.[1] ?? '';
    assert.equal(sans.trim().split(',')[0]!.trim(), "'GTG Figures'");
  });

  it('every figure is tabular unless it opts out', () => {
    assert.match(block('body'), /font-variant-numeric:\s*tabular-nums/);
  });
});
