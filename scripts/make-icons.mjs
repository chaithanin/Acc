/**
 * Regenerates every app icon from the one master logo.
 *
 * Run by hand after changing public/brand/logo.png, not during the build:
 *
 *   node scripts/make-icons.mjs
 *
 * sharp is not a declared dependency — it arrives under Next — so the build
 * must never need it. The outputs are committed for the same reason: a
 * deployment that cannot draw its own icons still has them.
 *
 * The master is stored trimmed and transparent. Each derived icon makes its
 * own decision about background, because the surfaces differ:
 *
 *   any       transparent. The browser composites it against its own chrome.
 *   maskable  opaque, and small. Android crops this to a circle or squircle,
 *             so the artwork has to fit inside the inner circle of 80% of the
 *             canvas or the platform cuts the corners of the chart off.
 *   apple     opaque. iOS composites transparency against black, which would
 *             turn the white gaps in the artwork into holes.
 *   favicon   transparent and as large as it fits. At 16px this reads as a
 *             blue-and-green gesture rather than a legible chart; that is a
 *             limit of the artwork at that size, not of the conversion.
 *
 * It also writes public/brand/logo.png, the mark as the interface draws it.
 * That one is a plain <img>: next/image would hand the request to Next's
 * optimiser, and sharp is an optional dependency that the traced standalone
 * build is not guaranteed to carry, so a fixed-size logo is not worth making
 * the sign-in page depend on it.
 */
import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
// The design source, deliberately outside public/: it is far larger than any
// icon drawn from it and nothing should serve it to a browser.
const MASTER = path.join(ROOT, 'assets/brand/logo.png');
const ICONS = path.join(ROOT, 'public/icons');
const BRAND = path.join(ROOT, 'public/brand');

/**
 * Widest the logo is ever drawn in the interface (64px tall on the sign-in
 * page), times three, so it stays sharp on the densest screens without
 * shipping the master's half a megabyte to do it.
 */
const DISPLAY_WIDTH = 320;

/**
 * A palette is five times smaller here than full colour and, checked side by
 * side at twice display size, indistinguishable: the artwork is flat shapes
 * with short gradients, which is what a palette handles well. Worth it for
 * the 512px icons a phone downloads at install time.
 */
const PNG = { compressionLevel: 9, palette: true };

/** White, matching the surface the artwork was drawn against. */
const OPAQUE_BG = { r: 255, g: 255, b: 255, alpha: 1 };
const CLEAR_BG = { r: 0, g: 0, b: 0, alpha: 0 };

/**
 * Draws the logo centred on a square canvas, scaled so its longest side is
 * `coverage` of the canvas.
 */
async function square(size, coverage, background) {
  const logo = sharp(MASTER);
  const { width, height } = await logo.metadata();
  const scale = (size * coverage) / Math.max(width, height);

  const resized = await sharp(MASTER)
    .resize(Math.round(width * scale), Math.round(height * scale), {
      fit: 'inside',
      kernel: 'lanczos3',
    })
    .toBuffer();

  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: resized, gravity: 'centre' }])
    .png(PNG)
    .toBuffer();
}

/**
 * The largest coverage whose rectangle still fits inside the maskable safe
 * zone — the inner circle of 80% of the canvas. Derived rather than guessed,
 * because it depends on the artwork's aspect ratio: a squarer logo has to be
 * smaller to fit the same circle.
 */
async function maskableCoverage() {
  const { width, height } = await sharp(MASTER).metadata();
  const longest = Math.max(width, height);
  const diagonal = Math.hypot(width, height);
  return (0.8 * longest) / diagonal;
}

async function main() {
  await mkdir(ICONS, { recursive: true });
  await mkdir(BRAND, { recursive: true });

  const safe = await maskableCoverage();
  const written = [];

  const write = async (name, buffer) => {
    await writeFile(path.join(ICONS, name), buffer);
    written.push(`${name}  ${(buffer.length / 1024).toFixed(1)} kB`);
  };

  for (const size of [192, 512]) {
    await write(`icon-${size}.png`, await square(size, 0.88, CLEAR_BG));
    await write(`maskable-${size}.png`, await square(size, safe, OPAQUE_BG));
  }

  await write('apple-touch-icon.png', await square(180, 0.8, OPAQUE_BG));

  const display = await sharp(MASTER)
    .resize({ width: DISPLAY_WIDTH, kernel: 'lanczos3' })
    .png(PNG)
    .toBuffer();
  await writeFile(path.join(BRAND, 'logo.png'), display);
  const shown = await sharp(display).metadata();
  written.push(
    `../brand/logo.png  ${shown.width}x${shown.height}  ${(display.length / 1024).toFixed(1)} kB`,
  );

  // One .ico holding 16, 32 and 48, assembled by hand: sharp writes PNG, not
  // ICO, and pulling in an encoder for three images is not worth a dependency.
  const members = await Promise.all(
    [16, 32, 48].map(async (size) => ({ size, png: await square(size, 0.94, CLEAR_BG) })),
  );
  await writeFile(path.join(ROOT, 'public/favicon.ico'), ico(members));
  written.push('../favicon.ico  (16, 32, 48)');

  console.log(`Safe-zone coverage for this artwork: ${(safe * 100).toFixed(1)}%\n`);
  for (const line of written) console.log(`  ${line}`);
}

/** Packs PNG members into an ICO directory. */
function ico(members) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(members.length, 4);

  let offset = 6 + members.length * 16;
  const entries = [];
  for (const { size, png } of members) {
    const entry = Buffer.alloc(16);
    // 0 means 256 in an ICO directory; these are all smaller, but the rule is
    // worth honouring in case a larger member is ever added.
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette size: none, this is a PNG member
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...members.map((m) => m.png)]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
