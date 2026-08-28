/**
 * Seed data for the project registry — the six operating companies.
 *
 * This is only the STARTING POINT. Projects and aliases live in the
 * `projects` / `project_aliases` tables and are edited at runtime from
 * Settings → Projects. Nothing in the engine may branch on a project name
 * (requirement 2) — detection asks the registry, never a literal.
 *
 * Thai aliases matter as much as the English ones: the accounting system
 * prints the legal entity name in Thai at the top of every GL report, and
 * that is often the only place the company is identified.
 *
 * Spelling variants are deliberate. "มาริน่า" and "มารีน่า" are both in
 * circulation, as are "ไชยธนินทร์" and "ไชยนินทร์"; each must resolve.
 */

export interface DefaultProject {
  code: string;
  name: string;
  /** Registered legal entity, shown in the Company filter. */
  company: string | null;
  sortOrder: number;
  aliases: string[];
}

/**
 * The legal names below are the ones the group supplied for the 2026 audit.
 *
 * They differ from the spellings this file previously carried — มารีน่า for
 * มาริน่า, วิกตอเรีย for วิคทอเรีย, เจนีวา for เจนิวา — and in one case name a
 * different entity: เอสอาร์ where this said เอลย่า. Every previous spelling is
 * kept as an alias, so a workbook exported by a system that still uses the old
 * one is recognised exactly as before. A dashboard used for management
 * reporting should carry the registered name; the importer should recognise
 * whatever the file happens to say.
 */
export const DEFAULT_PROJECTS: DefaultProject[] = [
  {
    code: 'HAMONIA',
    name: 'Hamonia',
    company: 'บริษัท เดอะ ซัน ไลท์ เรสซิเด้นซ์ 9 จำกัด',
    sortOrder: 10,
    aliases: [
      'Hamonia',
      'Harmonia',
      'SUN9',
      'Sun 9',
      'Sun09',
      'Sun 09',
      'SUN-9',
      'The Sun Light Residence 9',
      'Sunlight Residence 9',
      'FN Sun',
      'DATA_SUN9',
      'WIP Sun09',
      'Report Sun 09',
      'BOQ Hamonia',
      'เดอะ ซัน ไลท์ เรสซิเด้นซ์ 9',
      'ซัน ไลท์ เรสซิเด้นซ์ 9',
      'เดอะซันไลท์เรสซิเด้นซ์ 9',
      'ฮาโมเนีย',
      'ซันไลท์',
      'HCG',
    ],
  },
  {
    code: 'MARINA_VTR',
    name: 'Marina Golden Bay Victoria',
    company: 'บริษัท มารีน่า โกลเด้น เบย์ วิกตอเรีย จำกัด',
    sortOrder: 20,
    aliases: [
      'Marina Golden Bay Victoria',
      'Marina Golden Bay',
      'Marina',
      'Victoria',
      'VTR',
      'DATA_VTR',
      'FN VTR',
      'VTR WIP',
      'Report VTR',
      'MGB-VTR',
      'มาริน่า โกลเด้น เบย์ วิคทอเรีย',
      'มารีน่า โกลเด้น เบย์ วิคทอเรีย',
      'มาริน่าโกลเด้นเบย์วิคทอเรีย',
      'วิคทอเรีย',
      'มารีน่า',
    ],
  },
  {
    code: 'MARINA_ELYA',
    name: 'Marina Golden Bay Elya',
    company: 'บริษัท มารีน่า โกลเด้น เบย์ เอสอาร์ จำกัด',
    sortOrder: 21,
    aliases: [
      'Marina Golden Bay Elya',
      'Elya',
      'MGB-ELY',
      'ELY',
      'มาริน่า โกลเด้น เบย์ เอลย่า',
      'มารีน่า โกลเด้น เบย์ เอลย่า',
      'มาริน่าโกลเด้นเบย์เอลย่า',
      'เอลย่า',
      // The group's 2026 list names this entity เอสอาร์, where this file has
      // always said เอลย่า. Both are recognised until somebody confirms which
      // is on the certificate: refusing to read a file because the name moved
      // would be worse than reading it under either.
      'Marina Golden Bay SR',
      'MGB-SR',
      'มารีน่า โกลเด้น เบย์ เอสอาร์',
      'มาริน่า โกลเด้น เบย์ เอสอาร์',
      'เอสอาร์',
    ],
  },
  {
    code: 'MARINA_GENEVA',
    name: 'Marina Golden Bay Geneva',
    company: 'บริษัท มารีน่า โกลเด้น เบย์ เจนีวา จำกัด',
    sortOrder: 22,
    aliases: [
      'Marina Golden Bay Geneva',
      'Geneva',
      'MGB-GEN',
      'GEN',
      'มาริน่า โกลเด้น เบย์ เจนิวา',
      'มารีน่า โกลเด้น เบย์ เจนิวา',
      'มาริน่าโกลเด้นเบย์เจนิวา',
      'มารีน่า โกลเด้น เบย์ เจนีวา',
      'เจนีวา',
      'เจนิวา',
    ],
  },
  {
    code: 'CHTN',
    name: 'Chaithanin',
    company: 'บริษัท ไชยธนินทร์ จำกัด',
    sortOrder: 30,
    aliases: [
      'Chaithanin',
      'CHTN',
      'CTN',
      'Olympus',
      'OLP',
      'DATA_CHTN',
      'FN CTN',
      'ไชยธนินทร์',
      'ไชยนินทร์',
      'ไชยธนินท์',
      'โอลิมปัส',
    ],
  },
  {
    code: 'GTG',
    name: 'Global Top Group',
    company: 'บริษัท โกลบอล ท็อป กรุ๊ป จำกัด',
    sortOrder: 40,
    aliases: [
      'Global Top Group',
      'GTG',
      'Rental',
      'Global Top',
      'โกลบอล ท็อป กรุ๊ป',
      'โกลบอลท็อปกรุ๊ป',
      'โกลบอล ท๊อป กรุ๊ป',
      'ค่าเช่า',
    ],
  },
];
