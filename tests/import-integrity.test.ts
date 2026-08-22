import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import * as XLSX from 'xlsx';

import { extractExcelFromZip, ZipExtractionError } from '@/lib/excel/zip';
import { expandUploads, hashBuffer } from '@/lib/import/pipeline';

/**
 * Import integrity.
 *
 * What an archive is allowed to expand into, and whether two files that happen
 * to share a name can still be told apart afterwards — the file name is the key
 * that ties a record's source cell back to the file row it came from.
 */

let dir: string;

/** A minimal but genuine workbook, so the Excel-file check is satisfied. */
function workbookBytes(): Uint8Array {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['A'], [1]]), 'Sheet1');
  return new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
}

function writeZip(name: string, entries: Record<string, Uint8Array>): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.from(zipSync(entries)));
  return file;
}

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtg-zip-'));
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('archive limits', () => {
  it('refuses an entry that expands out of all proportion', async () => {
    // A zip bomb: a few kilobytes on disk, gigabytes once inflated. The point
    // of the check is that it happens BEFORE inflation — after it, the process
    // is already out of memory and no limit can help.
    const bomb = writeZip('bomb.zip', {
      'huge.xlsx': strToU8('0'.repeat(64 * 1024 * 1024)),
    });

    await assert.rejects(
      () => extractExcelFromZip(bomb, path.join(dir, 'out-bomb')),
      (err: Error) => err instanceof ZipExtractionError && /fold|limit/i.test(err.message),
    );
  });

  it('accepts an ordinary archive', async () => {
    const ok = writeZip('ok.zip', { 'report.xlsx': workbookBytes() });
    const { files } = await extractExcelFromZip(ok, path.join(dir, 'out-ok'));

    assert.equal(files.length, 1);
    assert.equal(files[0].fileName, 'report.xlsx');
  });

  it('skips what is not a workbook without failing the archive', async () => {
    const mixed = writeZip('mixed.zip', {
      'report.xlsx': workbookBytes(),
      'notes.txt': strToU8('nothing to see'),
      '__MACOSX/._report.xlsx': strToU8('cruft'),
    });

    const { files, skipped } = await extractExcelFromZip(mixed, path.join(dir, 'out-mixed'));

    assert.deepEqual(files.map((f) => f.fileName), ['report.xlsx']);
    assert.deepEqual(skipped, ['notes.txt']);
  });
});

describe('file identity', () => {
  it('keeps two files of the same name apart', async () => {
    // Two folders in one archive, each with its own Report.xlsx. Sharing a name
    // meant sharing a row in import_files, so one file's cells were recorded
    // against the other file entirely.
    const zip = writeZip('two.zip', {
      'marina/Report.xlsx': workbookBytes(),
      'hamonia/Report.xlsx': workbookBytes(),
    });

    const bytes = fs.readFileSync(zip);
    const { files } = await expandUploads(
      [{ filePath: zip, fileName: 'two.zip', size: bytes.length, hash: hashBuffer(bytes) }],
      path.join(dir, 'expand'),
    );

    assert.equal(files.length, 2);
    assert.equal(new Set(files.map((f) => f.fileName)).size, 2, 'names collided');

    // The first keeps the plain name; the second says where it came from.
    assert.equal(files[0].fileName, 'Report.xlsx');
    assert.match(files[1].fileName, /hamonia/);
  });

  it('keeps two uploads of the same name apart', async () => {
    const bytes = workbookBytes();
    const a = path.join(dir, 'a.xlsx');
    const b = path.join(dir, 'b.xlsx');
    fs.writeFileSync(a, bytes);
    fs.writeFileSync(b, bytes);

    const { files } = await expandUploads([
      { filePath: a, fileName: 'Report.xlsx', size: bytes.length, hash: hashBuffer(bytes) },
      { filePath: b, fileName: 'Report.xlsx', size: bytes.length, hash: hashBuffer(bytes) },
    ]);

    assert.equal(new Set(files.map((f) => f.fileName)).size, 2, 'names collided');
  });
});
