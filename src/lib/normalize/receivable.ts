import type { IncomeCategory } from '@/config/field-synonyms';
import { columnOf, scoreHeader } from '@/lib/detect/header-detector';
import { makeSourceRef, parseNumeric } from '@/lib/excel/cells';
import type { ReceivableRecord } from '@/lib/types';
import {
  dataRows,
  detectIncomeCategory,
  headerTextAt,
  rowFingerprint,
  type NormalizeContext,
} from './context';

/**
 * Customer receivable / reservation / down-payment sheets.
 *
 * Two layouts are supported and both come from the header map, not positions:
 *
 *   A. Long form — one row per receivable, with a category column.
 *   B. Wide form — one row per customer, with a COLUMN per category
 *      ("Reservation | Contract | Down Payment | Transfer Fee"). Detected by
 *      finding category words in the header row itself.
 */
export function normalizeReceivable(ctx: NormalizeContext): ReceivableRecord[] {
  const wide = detectWideCategoryColumns(ctx);
  return wide.length > 0 ? normalizeWide(ctx, wide) : normalizeLong(ctx);
}

type AmountRole = 'contractual' | 'receive' | 'accrue';

interface CategoryColumn {
  category: IncomeCategory;
  role: AmountRole;
  columnIndex: number;
  header: string;
}

/** Category columns grouped so each category keeps its own contractual/receive/accrue. */
type CategoryGroups = Map<IncomeCategory, Partial<Record<AmountRole, CategoryColumn>>>;

/**
 * Finds header cells that name an income category — that is what marks a wide
 * layout. A header may also name its role ("Reservation Received"), which is
 * how per-category received and outstanding columns are picked up.
 */
function detectWideCategoryColumns(ctx: NormalizeContext): CategoryColumn[] {
  const { sheet, detection } = ctx;
  if (detection.headerRow === null) return [];

  const found: CategoryColumn[] = [];

  for (let c = 0; c < sheet.colCount; c += 1) {
    const header = headerTextAt(sheet, detection.headerRow, c);
    if (!header) continue;
    const category = detectIncomeCategory([header]);
    if (!category) continue;
    found.push({ category, role: roleOfHeader(header), columnIndex: c, header });
  }

  // A single category word in a header is more likely a label or a title than
  // a wide layout, so require at least two before switching modes.
  return found.length >= 2 ? found : [];
}

/**
 * Reads the amount role out of a header that already names a category.
 * "Reservation" alone means the contractual amount for that category.
 */
function roleOfHeader(header: string): AmountRole {
  const ranked = scoreHeader(header);
  for (const candidate of ranked) {
    if (candidate.score < 0.4) break;
    if (candidate.field === 'receive_amount') return 'receive';
    if (candidate.field === 'accrue_amount') return 'accrue';
    if (candidate.field === 'contractual_amount') return 'contractual';
  }
  return 'contractual';
}

function groupByCategory(columns: CategoryColumn[]): CategoryGroups {
  const groups: CategoryGroups = new Map();
  for (const col of columns) {
    const entry = groups.get(col.category) ?? {};
    // First column of a given role wins; later duplicates are ignored rather
    // than silently overwriting an earlier, better-placed column.
    if (!entry[col.role]) entry[col.role] = col;
    groups.set(col.category, entry);
  }
  return groups;
}

function normalizeLong(ctx: NormalizeContext): ReceivableRecord[] {
  const records: ReceivableRecord[] = [];
  const seen = new Map<string, number>();

  for (const row of dataRows(ctx)) {
    if (row.isTotalRow()) continue;

    const contractual = row.num('contractual_amount');
    const receive = row.num('receive_amount');
    const accrue = row.num('accrue_amount');
    const amount = row.num('amount');

    // A row with no money on it is a spacer or a note.
    if (contractual === null && receive === null && accrue === null && amount === null) continue;

    const labels = row.labelTexts();
    const category = detectIncomeCategory(labels) ?? 'contract';
    const project = row.project();

    const contractualAmount = contractual ?? amount ?? 0;
    const receiveAmount = receive ?? 0;

    const record: ReceivableRecord = {
      kind: 'receivable',
      sourceRef: row.ref('contractual_amount'),
      projectId: project.id,
      projectLabel: project.label,
      category,
      customer: row.text('customer'),
      unit: row.text('unit'),
      contractualAmount,
      receiveAmount,
      // Stated value if present; otherwise fall back to the derived figure so
      // reconciliation compares like with like.
      accrueAmount: accrue ?? contractualAmount - receiveAmount,
      dueDate: row.date('due_date'),
    };

    flagDuplicate(ctx, seen, row.rowIndex, [
      record.category,
      record.customer,
      record.unit,
      record.contractualAmount,
      record.receiveAmount,
    ]);

    records.push(record);
  }

  return records;
}

function normalizeWide(ctx: NormalizeContext, categoryColumns: CategoryColumn[]): ReceivableRecord[] {
  const records: ReceivableRecord[] = [];
  const groups = groupByCategory(categoryColumns);

  // A row-level received column can only exist once, so it cannot be split
  // across categories without inventing an allocation. It is reported instead.
  const sharedReceiveCol = columnOf(ctx.detection.columns, 'receive_amount');
  let warnedSharedReceive = false;

  for (const row of dataRows(ctx)) {
    if (row.isTotalRow()) continue;

    const project = row.project();
    const customer = row.text('customer');
    const unit = row.text('unit');
    const dueDate = row.date('due_date');

    for (const [category, roles] of groups) {
      const contractualCol = roles.contractual;
      const receiveCol = roles.receive;
      const accrueCol = roles.accrue;

      const contractual = contractualCol ? readAmount(ctx, row.rowIndex, contractualCol.columnIndex) : null;
      const receive = receiveCol ? readAmount(ctx, row.rowIndex, receiveCol.columnIndex) : null;
      const accrue = accrueCol ? readAmount(ctx, row.rowIndex, accrueCol.columnIndex) : null;

      if (contractual === null && receive === null && accrue === null) continue;
      if (contractual === 0 && !receive && !accrue) continue;

      const contractualAmount = contractual ?? (receive ?? 0) + (accrue ?? 0);
      const receiveAmount = receive ?? 0;

      if (receiveCol === undefined && sharedReceiveCol !== null && !warnedSharedReceive) {
        warnedSharedReceive = true;
        ctx.addIssue({
          severity: 'warning',
          code: 'RECEIVED_NOT_ATTRIBUTABLE',
          message:
            'This sheet lists one received-amount column for several category columns. ' +
            'Received amounts were left unattributed rather than split by guesswork — ' +
            'map the columns manually if a per-category split is needed.',
          source: makeSourceRef(ctx.fileName, ctx.sheet, ctx.detection.headerRow, sharedReceiveCol),
        });
      }

      records.push({
        kind: 'receivable',
        sourceRef: makeSourceRef(
          ctx.fileName,
          ctx.sheet,
          row.rowIndex,
          (contractualCol ?? receiveCol ?? accrueCol)!.columnIndex,
        ),
        projectId: project.id,
        projectLabel: project.label,
        category,
        customer,
        unit,
        contractualAmount,
        receiveAmount,
        accrueAmount: accrue ?? contractualAmount - receiveAmount,
        dueDate,
      });
    }
  }

  return records;
}

/** Reads one arbitrary cell as an amount, recording a warning for bad values. */
function readAmount(ctx: NormalizeContext, row: number, col: number): number | null {
  const cell = ctx.sheet.rows[row]?.[col] ?? null;
  if (!cell) return null;

  if (cell.t === 'e') {
    ctx.addIssue({
      severity: 'warning',
      code: 'FORMULA_ERROR',
      message: 'Excel error value in a receivable category column',
      source: makeSourceRef(ctx.fileName, ctx.sheet, row, col),
    });
    return null;
  }

  const parsed = parseNumeric(cell);
  if (parsed.issue === 'text-in-numeric') {
    ctx.addIssue({
      severity: 'warning',
      code: 'TEXT_IN_NUMERIC',
      message: `Expected an amount but found "${parsed.raw}"`,
      source: makeSourceRef(ctx.fileName, ctx.sheet, row, col),
    });
    return null;
  }
  return parsed.value;
}

function flagDuplicate(
  ctx: NormalizeContext,
  seen: Map<string, number>,
  rowIndex: number,
  parts: (string | number | null)[],
) {
  const key = rowFingerprint(parts);
  // An all-blank fingerprint carries no identity, so it cannot be a duplicate.
  if (key.replace(/\|/g, '') === '') return;

  const first = seen.get(key);
  if (first !== undefined) {
    ctx.addIssue({
      severity: 'warning',
      code: 'DUPLICATE_ROW',
      message: `This row is identical to row ${first + 1 + ctx.sheet.originRow}; both were imported and may double-count.`,
      source: makeSourceRef(ctx.fileName, ctx.sheet, rowIndex, null),
    });
    return;
  }
  seen.set(key, rowIndex);
}
