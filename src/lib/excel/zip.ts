import { unzip, type Unzipped } from 'fflate';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isExcelFile } from './read';

/**
 * ZIP expansion into a temporary directory.
 *
 * The archive itself is never modified, and extraction is bounded so a zip
 * bomb cannot fill the disk. Extracted files are cleaned up by the caller.
 */

/** Refuse archives that would expand beyond this. */
const MAX_TOTAL_UNCOMPRESSED = 1024 * 1024 * 1024; // 1 GB
const MAX_ENTRIES = 500;

export interface ExtractedFile {
  /** Path on disk of the extracted copy. */
  filePath: string;
  /** Entry name as recorded in the archive. */
  entryName: string;
  /** Base file name, without directories. */
  fileName: string;
  size: number;
}

export class ZipExtractionError extends Error {}

export async function extractExcelFromZip(
  zipPath: string,
  destDir: string,
): Promise<{ files: ExtractedFile[]; skipped: string[] }> {
  const buffer = await fs.readFile(zipPath);

  const entries = await new Promise<Unzipped>((resolve, reject) => {
    unzip(new Uint8Array(buffer), (err, data) => {
      if (err) reject(new ZipExtractionError(`The archive could not be opened: ${err.message}`));
      else resolve(data);
    });
  });

  const names = Object.keys(entries);
  if (names.length > MAX_ENTRIES) {
    throw new ZipExtractionError(
      `The archive contains ${names.length} entries, above the ${MAX_ENTRIES} limit.`,
    );
  }

  await fs.mkdir(destDir, { recursive: true });

  const files: ExtractedFile[] = [];
  const skipped: string[] = [];
  let totalBytes = 0;

  for (const entryName of names) {
    const data = entries[entryName];

    // Directory entries carry no data.
    if (entryName.endsWith('/') || data.length === 0) continue;

    const baseName = path.basename(entryName);

    // Mac archive cruft and hidden files are noise, not reports.
    if (baseName.startsWith('.') || entryName.includes('__MACOSX/')) continue;

    if (!isExcelFile(baseName)) {
      skipped.push(entryName);
      continue;
    }

    totalBytes += data.length;
    if (totalBytes > MAX_TOTAL_UNCOMPRESSED) {
      throw new ZipExtractionError('The archive expands beyond the 1 GB extraction limit.');
    }

    // Flatten to a safe name — an entry name from an untrusted archive must
    // never be able to escape the destination directory.
    const safeName = `${files.length}-${baseName.replace(/[^\w.\-฀-๿]/g, '_')}`;
    const filePath = path.join(destDir, safeName);

    await fs.writeFile(filePath, data);
    files.push({ filePath, entryName, fileName: baseName, size: data.length });
  }

  return { files, skipped };
}

/** Best-effort cleanup of a temporary extraction directory. */
export async function cleanupDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // A leftover temp directory is not worth failing an import over.
  }
}
