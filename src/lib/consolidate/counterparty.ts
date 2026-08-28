import { normalizeKey } from '@/lib/detect/normalize-text';

/**
 * Recognising another group company on the other side of a transaction.
 *
 * A management fee charged by Global Top Group to Sun Light Residence 9 is an
 * expense in one set of books and income in the other. Both are correct, and
 * adding the two together produces a group that appears to have earned money
 * from itself. Elimination is only possible if something says which
 * transactions those are, and until this existed nothing did.
 *
 * Matching is on the name as written in the file, against every name the group
 * knows a company by: its legal name, its display name, its code, and the
 * aliases its projects are recognised under. Thai company names arrive with
 * บริษัท and จำกัด wrapped around them and with spacing and vowel
 * transliteration varying between systems, so the comparison is on the
 * normalised key rather than the raw text.
 */

export interface GroupCompany {
  id: string;
  companyCode: string;
  legalName: string;
  displayName: string;
  aliases: string[];
}

/** Words that appear in every Thai company name and identify none of them. */
const NOISE = [
  'บริษัท', 'จำกัด', 'มหาชน', 'หจก', 'ห้างหุ้นส่วนจำกัด',
  'company', 'limited', 'ltd', 'co', 'plc', 'public',
];

function strip(text: string): string {
  let out = normalizeKey(text);
  for (const word of NOISE) out = out.split(normalizeKey(word)).join('');
  return out.replace(/\s+/g, '');
}

export class CounterpartyResolver {
  /** Normalised name → company id, longest key first. */
  private readonly entries: [string, string][];

  /** Keys short enough to appear inside unrelated text are kept out. */
  private static readonly MIN_KEY = 4;

  constructor(companies: GroupCompany[]) {
    const byKey = new Map<string, string>();

    for (const company of companies) {
      for (const name of [company.legalName, company.displayName, company.companyCode, ...company.aliases]) {
        if (!name) continue;
        const key = strip(name);
        // A one- or two-letter key would match half the ledger.
        if (key.length < CounterpartyResolver.MIN_KEY) continue;
        // First writer wins, so a company's own name beats another's alias.
        if (!byKey.has(key)) byKey.set(key, company.id);
      }
    }

    // Longest first, so "marinagoldenbayvictoria" is preferred over
    // "marinagoldenbay" when a name contains both.
    this.entries = [...byKey.entries()].sort((a, b) => b[0].length - a[0].length);
  }

  /**
   * The group company this name refers to, or null.
   *
   * `self` is the company whose books are being read: a row naming its own
   * company is not an intercompany transaction, it is a bookkeeping label, and
   * marking it would eliminate the company's own trade against itself.
   */
  resolve(name: string | null | undefined, self: string | null): string | null {
    if (!name) return null;

    const key = strip(name);
    if (key.length < CounterpartyResolver.MIN_KEY) return null;

    for (const [candidate, id] of this.entries) {
      if (key === candidate || key.includes(candidate)) {
        return id === self ? null : id;
      }
    }

    return null;
  }

  get size(): number {
    return this.entries.length;
  }
}
