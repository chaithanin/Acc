import { unzip, type Unzipped } from 'fflate';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isExcelFile } from './read';

/**
 * ZIP expansion into a temporary directory.
 *
 * The archive itself is never modified, and extraction is bounded so a zip
 * bomb cannot fill the disk or the heap. Extracted files are cleaned up by the
 * caller.
 *
 * The bounds are applied in the FILTER, which runs before an entry is
 * inflated. Checking sizes after `unzip` returned was checking them after the
 * damage: a 40 KB archive holding a 4 GB run of zeros was fully decompressed
 * into memory first, and the process died before reaching the limit that was
 * supposed to stop it.
 */

/** Refuse archives that would expand beyond this in total. */
const MAX_TOTAL_UNCOMPRESSED = 1024 * 1024 * 1024; // 1 GB
/** No single workbook in an archive may exceed this. */
const MAX_ENTRY_UNCOMPRESSED = 200 * 1024 * 1024;
const MAX_ENTRIES = 500;
/**
 * Highest tolerated expansion factor for one entry.
 *
 * A real workbook is XML and compresses perhaps 20:1. A thousandfold is not a
 * spreadsheet; it is a run of one repeated byte.
 */
const MAX_RATIO = 500;

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

  const skipped: string[] = [];
  let entriesSeen = 0;
  let plannedBytes = 0;
  let rejection: string | null = null;

  /**
   * Decides, from the central directory alone, whether an entry is inflated.
   *
   * Returning false costs nothing — the entry is never decompressed. The first
   * refusal is remembered and rethrown afterwards, because throwing from
   * inside fflate's callback would surface as an unrelated parse error.
   */
  // fflate's names read backwards: `size` is the COMPRESSED size and
  // `originalSize` the uncompressed one. Aliased here so the checks below say
  // what they mean.
  const filter = (file: { name: string; size: number; originalSize: number }): boolean => {
    const compressed = file.size;
    const uncompressed = file.originalSize;

    if (rejection) return false;

    const entryName = file.name;
    if (entryName.endsWith('/')) return false;

    const baseName = path.basename(entryName);
    // Mac archive cruft and hidden files are noise, not reports.
    if (baseName.startsWith('.') || entryName.includes('__MACOSX/')) return false;

    entriesSeen += 1;
    if (entriesSeen > MAX_ENTRIES) {
      rejection = `The archive contains more than ${MAX_ENTRIES} entries.`;
      return false;
    }

    if (!isExcelFile(baseName)) {
      skipped.push(entryName);
      return false;
    }

    // Both sizes come from the archive's own directory and can lie, so they
    // are a cheap first gate; the bytes that actually arrive are checked again
    // below.
    if (uncompressed > MAX_ENTRY_UNCOMPRESSED) {
      rejection = `"${baseName}" expands to ${Math.round(uncompressed / 1024 / 1024)} MB, above the ${
        MAX_ENTRY_UNCOMPRESSED / 1024 / 1024
      } MB limit for one file.`;
      return false;
    }

    if (compressed > 0 && uncompressed / compressed > MAX_RATIO) {
      rejection = `"${baseName}" claims to expand ${Math.round(
        uncompressed / compressed,
      )}-fold, which is not a spreadsheet.`;
      return false;
    }

    plannedBytes += uncompressed;
    if (plannedBytes > MAX_TOTAL_UNCOMPRESSED) {
      rejection = 'The archive expands beyond the 1 GB extraction limit.';
      return false;
    }

    return true;
  };

  const entries = await new Promise<Unzipped>((resolve, reject) => {
    unzip(new Uint8Array(buffer), { filter }, (err, data) => {
      if (err) reject(new ZipExtractionError(`The archive could not be opened: ${err.message}`));
      else resolve(data);
    });
  });

  if (rejection) throw new ZipExtractionError(rejection);

  await fs.mkdir(destDir, { recursive: true });

  const files: ExtractedFile[] = [];
  let totalBytes = 0;

  for (const entryName of Object.keys(entries)) {
    const data = entries[entryName];
    if (data.length === 0) continue;

    const baseName = path.basename(entryName);

    // The declared sizes were only a claim; this is what actually arrived.
    totalBytes += data.length;
    if (data.length > MAX_ENTRY_UNCOMPRESSED || totalBytes > MAX_TOTAL_UNCOMPRESSED) {
      throw new ZipExtractionError('The archive expands beyond the extraction limits.');
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
