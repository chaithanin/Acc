/**
 * Text normalisation shared by every detector.
 *
 * Excel labels are written by humans across many files, so matching has to
 * survive casing, spacing, punctuation, zero-width characters and the Thai
 * script that makes naive comparison fail.
 */

/** Zero-width and bidi control characters that Excel copy/paste drags in. */
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g;
/** Non-breaking / ideographic spaces normalised to a plain space. */
const ODD_SPACES = /[\u00a0\u1680\u2000-\u200a\u3000]/g;
/** Thai block, used to switch matching strategy for space-less scripts. */
const THAI = /[\u0e00-\u0e7f]/;

/** Lowercase, collapse whitespace, strip zero-width and NBSP characters. */
export function normalizeText(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input)
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(ODD_SPACES, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Aggressive key form: normalised, then all separators and punctuation removed.
 * "The Sun Light Residence 9" and "sun-light residence9" collapse to the same key.
 */
export function normalizeKey(input: unknown): string {
  return normalizeText(input).replace(/[\s_\-./\\(),:;'"|#*&+]/g, '');
}

/** Tokens for word-boundary matching, so "VTR" never matches inside "CONVTREPORT". */
export function tokenize(input: unknown): string[] {
  return normalizeText(input)
    .split(/[^a-z0-9\u0e00-\u0e7f]+/)
    .filter((t) => t.length > 0);
}

/**
 * Whether `needle` appears in `haystack` as a standalone token sequence.
 * Thai is written without spaces, so Thai needles fall back to containment.
 */
export function containsPhrase(haystack: string, needle: string): boolean {
  const h = normalizeText(haystack);
  const n = normalizeText(needle);
  if (!h || !n) return false;

  if (THAI.test(n)) return h.includes(n);

  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s_\\-.]*');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(h);
}

/** Case/space-insensitive containment used for loose header sniffing. */
export function keyContains(haystack: string, needle: string): boolean {
  const h = normalizeKey(haystack);
  const n = normalizeKey(needle);
  return !!h && !!n && h.includes(n);
}

export function isThai(input: string): boolean {
  return THAI.test(input);
}
