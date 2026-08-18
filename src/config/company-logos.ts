/**
 * Which logo belongs to which company.
 *
 * Matched on the company's own name rather than fixed to an id, because the
 * rule the business gave is about names: every company whose name begins
 * "บริษัท มาริน่า โกลเด้น เบย์" carries the Marina mark, whichever project it
 * holds. A Marina company added next year picks up the right logo with no
 * code change, which is the same reason project names are never hard-coded.
 *
 * Longest prefix wins, so a more specific rule can be added above a general
 * one later without reordering anything by hand.
 */

export interface CompanyLogoRule {
  /** Start of the company name, or its code. Compared case-insensitively. */
  match: string;
  /** Path under public/. */
  logo: string;
}

export const COMPANY_LOGO_RULES: CompanyLogoRule[] = [
  // All three Marina companies — Victoria, Elya, Geneva — share one mark.
  { match: 'บริษัท มาริน่า โกลเด้น เบย์', logo: '/logos/marina-golden-bay.png' },
  { match: 'MARINA', logo: '/logos/marina-golden-bay.png' },

  // The Sun Light Residence 9 is the company behind Harmonia City Garden.
  { match: 'บริษัท เดอะ ซัน ไลท์ เรสซิเด้นซ์', logo: '/logos/harmonia.png' },
  { match: 'HAMONIA', logo: '/logos/harmonia.png' },

  { match: 'บริษัท ไชยธนินทร์', logo: '/logos/chaithanin.png' },
  { match: 'CHTN', logo: '/logos/chaithanin.png' },

  { match: 'บริษัท โกลบอล ท็อป กรุ๊ป', logo: '/logos/global-top-group.png' },
  { match: 'GTG', logo: '/logos/global-top-group.png' },
];

/** The logo for a company, or null when no rule covers it. */
export function logoFor(company: { displayName: string; legalName: string; companyCode: string }):
  | string
  | null {
  const candidates = [company.displayName, company.legalName, company.companyCode].map((v) =>
    v.trim().toLowerCase(),
  );

  const matches = COMPANY_LOGO_RULES.filter((rule) => {
    const needle = rule.match.trim().toLowerCase();
    return candidates.some((c) => c.startsWith(needle));
  });

  if (matches.length === 0) return null;

  // Longest match wins: "บริษัท มาริน่า โกลเด้น เบย์" beats a bare "MARINA".
  return matches.reduce((best, rule) => (rule.match.length > best.match.length ? rule : best))
    .logo;
}
