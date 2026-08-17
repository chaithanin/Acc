import type { RawCell, RawSheet, RawWorkbook } from '@/lib/excel/types';
import type { Project } from '@/lib/types';

/** Builds a RawSheet from a plain grid, the way the worker would produce it. */
export function makeSheet(
  name: string,
  grid: (string | number | null | RawCell)[][],
  options: { index?: number; originRow?: number; originCol?: number } = {},
): RawSheet {
  const rows = grid.map((row) =>
    row.map((value): RawCell | null => {
      if (value === null || value === '') return null;
      if (typeof value === 'object') return value;
      if (typeof value === 'number') return { v: value, t: 'n' };
      return { v: value, t: 's' };
    }),
  );

  const colCount = grid.reduce((max, row) => Math.max(max, row.length), 0);

  return {
    name,
    index: options.index ?? 0,
    ref: `A1:${String.fromCharCode(64 + Math.max(1, colCount))}${grid.length}`,
    originRow: options.originRow ?? 0,
    originCol: options.originCol ?? 0,
    rowCount: grid.length,
    colCount,
    rows: rows.map((row) => (row.every((c) => c === null) ? [] : row)),
    truncated: false,
  };
}

export function makeWorkbook(fileName: string, sheets: RawSheet[]): RawWorkbook {
  return { fileName, sheetCount: sheets.length, sheets, warnings: [] };
}

export function formulaCell(value: number, formula: string): RawCell {
  return { v: value, t: 'n', f: formula };
}

export function errorCell(text = '#REF!'): RawCell {
  return { v: text, t: 'e', w: text };
}

export const TEST_PROJECTS: Project[] = [
  {
    id: 'p-hamonia',
    code: 'HAMONIA',
    name: 'Hamonia',
    company: 'Global Top Group',
    companyId: null,
    sortOrder: 10,
    active: true,
    aliases: ['Hamonia', 'Harmonia', 'SUN9', 'Sun 9', 'Sun09', 'The Sun Light Residence 9'],
  },
  {
    id: 'p-marina',
    code: 'MARINA',
    name: 'Marina Golden Bay',
    company: 'Global Top Group',
    companyId: null,
    sortOrder: 20,
    active: true,
    aliases: ['Marina Golden Bay', 'Victoria', 'VTR', 'Marina Golden Bay Victoria'],
  },
  {
    id: 'p-chtn',
    code: 'CHTN',
    name: 'Chaithanin',
    company: 'Chaithanin',
    companyId: null,
    sortOrder: 30,
    active: true,
    aliases: ['Chaithanin', 'CHTN', 'Olympus'],
  },
  {
    id: 'p-gtg',
    code: 'GTG',
    name: 'Global Top Group',
    company: 'Global Top Group',
    companyId: null,
    sortOrder: 40,
    active: true,
    aliases: ['Global Top Group', 'GTG', 'Rental'],
  },
];
