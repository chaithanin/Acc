/**
 * Turning an uploaded logo into something a company row can hold.
 *
 * Stored as a data URI in the company's own row rather than as a file on disk.
 * A file would need a writable path that survives a deploy, a route to serve
 * it, and its own backup story; the database already has all three, and six
 * logos are not what will make it large.
 */

/** Formats a browser renders inline and that a logo is plausibly in. */
export const ALLOWED_LOGO_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
] as const;

/**
 * Cap on the stored logo.
 *
 * It is read on the company chooser, so every byte is paid for on the screen
 * people see first. A mark that needs more than this is a photograph.
 */
export const MAX_LOGO_BYTES = 512 * 1024;

export interface LogoResult {
  dataUri: string;
  bytes: number;
  type: string;
}

export function describeLogoLimits(): string {
  return `PNG, JPEG, WebP or SVG, up to ${Math.round(MAX_LOGO_BYTES / 1024)} KB.`;
}

/**
 * Validates and encodes an uploaded logo.
 *
 * Throws with a message meant to be read, because every rejection here is
 * something the person uploading can act on — a wrong format or an oversized
 * file, not an internal failure.
 */
export function toLogoDataUri(bytes: Uint8Array, type: string, fileName: string): LogoResult {
  const declared = type.trim().toLowerCase();

  if (bytes.byteLength === 0) {
    throw new Error(`${fileName} is empty.`);
  }

  if (bytes.byteLength > MAX_LOGO_BYTES) {
    throw new Error(
      `${fileName} is ${Math.round(bytes.byteLength / 1024)} KB. The limit is ` +
        `${Math.round(MAX_LOGO_BYTES / 1024)} KB.`,
    );
  }

  if (!(ALLOWED_LOGO_TYPES as readonly string[]).includes(declared)) {
    throw new Error(`${fileName} is ${declared || 'of an unknown type'}. ${describeLogoLimits()}`);
  }

  // The declared type is checked against the bytes. A browser reports whatever
  // the extension suggests, and a mark that renders as a broken image on the
  // company chooser is worth catching while someone is still looking at it.
  if (!looksLike(declared, bytes)) {
    throw new Error(`${fileName} does not look like a ${declared.replace('image/', '')} file.`);
  }

  return {
    dataUri: `data:${declared};base64,${Buffer.from(bytes).toString('base64')}`,
    bytes: bytes.byteLength,
    type: declared,
  };
}

/** Magic numbers for the raster formats; SVG is text, so it is sniffed. */
function looksLike(type: string, bytes: Uint8Array): boolean {
  const starts = (...signature: number[]) => signature.every((byte, i) => bytes[i] === byte);

  switch (type) {
    case 'image/png':
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/jpeg':
      return starts(0xff, 0xd8, 0xff);
    case 'image/webp':
      return (
        starts(0x52, 0x49, 0x46, 0x46) &&
        [0x57, 0x45, 0x42, 0x50].every((b, i) => bytes[8 + i] === b)
      );
    case 'image/svg+xml': {
      const head = Buffer.from(bytes.subarray(0, 512)).toString('utf8').trimStart().toLowerCase();
      return head.startsWith('<?xml') || head.startsWith('<svg') || head.startsWith('<!doctype svg');
    }
    default:
      return false;
  }
}
