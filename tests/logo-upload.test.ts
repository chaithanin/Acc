import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_LOGO_BYTES, toLogoDataUri } from '@/lib/companies/logo-upload';

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (extra = 16) => new Uint8Array([...PNG_HEADER, ...new Array(extra).fill(0)]);

describe('logo upload', () => {
  it('encodes a PNG as a data URI', () => {
    const result = toLogoDataUri(png(), 'image/png', 'marina.png');
    assert.match(result.dataUri, /^data:image\/png;base64,/);
    assert.equal(result.type, 'image/png');
  });

  it('accepts an SVG, which is text rather than magic numbers', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    assert.match(toLogoDataUri(svg, 'image/svg+xml', 'mark.svg').dataUri, /^data:image\/svg\+xml/);
  });

  it('rejects a file whose bytes do not match what it claims to be', () => {
    // A renamed .txt reports image/png, and would reach the company chooser as
    // a broken image if only the declared type were trusted.
    const notAPng = new TextEncoder().encode('this is not a png');
    assert.throws(() => toLogoDataUri(notAPng, 'image/png', 'logo.png'), /does not look like a png/);
  });

  it('rejects a format a browser will not render inline', () => {
    assert.throws(() => toLogoDataUri(png(), 'application/pdf', 'logo.pdf'), /PNG, JPEG/);
  });

  it('rejects a file over the size limit', () => {
    const huge = new Uint8Array(MAX_LOGO_BYTES + 1);
    huge.set(PNG_HEADER);
    assert.throws(() => toLogoDataUri(huge, 'image/png', 'huge.png'), /The limit is/);
  });

  it('rejects an empty file', () => {
    assert.throws(() => toLogoDataUri(new Uint8Array(), 'image/png', 'empty.png'), /is empty/);
  });
});
