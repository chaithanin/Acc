/**
 * Excel parsing worker.
 *
 * Runs in an isolated worker thread on purpose:
 *
 *  1. Untrusted workbooks are parsed by SheetJS, which on the npm-published
 *     version carries known prototype-pollution and ReDoS advisories. A worker
 *     runs in its own V8 isolate with its own Object.prototype, so pollution
 *     cannot reach the server's realm, and the parent applies a hard timeout +
 *     terminate() so a pathological file cannot wedge the request thread.
 *  2. Large workbooks are CPU-bound. Parsing off the main thread keeps the
 *     Next.js server responsive (requirement 31).
 *
 * The worker only ever READS the file — originals are never written to.
 */
import { readFile } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';
import * as XLSX from 'xlsx';

/** Hard caps so one malicious/huge workbook cannot exhaust memory. */
const MAX_ROWS_PER_SHEET = 20000;
const MAX_COLS_PER_SHEET = 512;
const MAX_SHEETS = 200;

/**
 * SheetJS returns Date objects when cellDates is on and may return values whose
 * keys came straight out of the file. Everything crossing the thread boundary is
 * reduced to plain JSON-safe primitives built on null-prototype objects.
 */
function safeCell(cell) {
  if (!cell || typeof cell !== 'object') return null;

  let value = cell.v;
  let type = typeof cell.t === 'string' ? cell.t : 's';

  if (value instanceof Date) {
    value = Number.isNaN(value.getTime()) ? null : value.toISOString();
    type = 'd';
  } else if (typeof value === 'bigint') {
    value = Number(value);
  } else if (value !== null && value !== undefined && typeof value === 'object') {
    // Rich-text runs and anything else exotic collapse to their display string.
    value = typeof cell.w === 'string' ? cell.w : String(value);
    type = 's';
  }

  if (value === undefined) value = null;

  const out = Object.create(null);
  out.v = value;
  out.t = type;
  if (typeof cell.f === 'string' && cell.f.length > 0) out.f = cell.f.slice(0, 2000);
  if (typeof cell.w === 'string' && cell.w.length > 0) out.w = cell.w.slice(0, 500);
  if (typeof cell.z === 'string' && cell.z.length > 0) out.z = cell.z.slice(0, 120);
  return out;
}

async function run() {
  const { filePath, fileName } = workerData;
  const buffer = await readFile(filePath);

  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    cellFormula: true,
    cellNF: true,
    cellText: true,
    // Never let SheetJS evaluate or follow anything from the file.
    bookVBA: false,
    dense: false,
  });

  const warnings = [];
  const sheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];

  if (sheetNames.length > MAX_SHEETS) {
    warnings.push({
      code: 'SHEET_LIMIT',
      message: `Workbook has ${sheetNames.length} sheets; only the first ${MAX_SHEETS} were read.`,
      sheet: null,
    });
  }

  const sheets = [];

  for (const [index, name] of sheetNames.slice(0, MAX_SHEETS).entries()) {
    const ws = workbook.Sheets[name];
    if (!ws || !ws['!ref']) {
      sheets.push({ name, index, ref: null, rowCount: 0, colCount: 0, rows: [], truncated: false });
      continue;
    }

    const range = XLSX.utils.decode_range(ws['!ref']);
    const rawRowCount = range.e.r - range.s.r + 1;
    const rawColCount = range.e.c - range.s.c + 1;

    const rowCount = Math.min(rawRowCount, MAX_ROWS_PER_SHEET);
    const colCount = Math.min(rawColCount, MAX_COLS_PER_SHEET);
    const truncated = rowCount < rawRowCount || colCount < rawColCount;

    if (truncated) {
      warnings.push({
        code: 'SHEET_TRUNCATED',
        message: `Sheet "${name}" is ${rawRowCount}x${rawColCount}; read ${rowCount}x${colCount}.`,
        sheet: name,
      });
    }

    const rows = [];
    for (let r = 0; r < rowCount; r += 1) {
      const row = new Array(colCount).fill(null);
      let hasValue = false;
      for (let c = 0; c < colCount; c += 1) {
        const addr = XLSX.utils.encode_cell({ r: range.s.r + r, c: range.s.c + c });
        const cell = safeCell(ws[addr]);
        if (cell) {
          row[c] = cell;
          hasValue = true;
        }
      }
      // Keep blank rows in place so row numbers still line up with the file.
      rows.push(hasValue ? row : []);
    }

    sheets.push({
      name: String(name),
      index,
      ref: ws['!ref'],
      // Excel is 1-based and the used range may not start at A1; the parent needs
      // both to translate array indices back into real cell addresses.
      originRow: range.s.r,
      originCol: range.s.c,
      rowCount,
      colCount,
      rows,
      truncated,
    });
  }

  parentPort.postMessage({
    ok: true,
    workbook: {
      fileName,
      sheetCount: sheetNames.length,
      sheets,
      warnings,
    },
  });
}

run().catch((err) => {
  parentPort.postMessage({
    ok: false,
    error: { message: err?.message ?? String(err), name: err?.name ?? 'Error' },
  });
});
