import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { RawWorkbook } from './types';

/**
 * Bridge to the parsing worker.
 *
 * The worker is disposable by design: it gets one file, a hard time limit, and
 * is terminated afterwards either way. See `workers/excel-parse.worker.mjs` for
 * why parsing is isolated rather than done inline.
 */

/** Long enough for a genuinely large workbook, short enough to bound a request. */
const PARSE_TIMEOUT_MS = 60_000;

const WORKER_PATH = path.join(process.cwd(), 'workers', 'excel-parse.worker.mjs');

export class ExcelParseError extends Error {
  readonly fileName: string;
  readonly reason: 'timeout' | 'corrupt' | 'worker';

  constructor(message: string, fileName: string, reason: 'timeout' | 'corrupt' | 'worker') {
    super(message);
    this.name = 'ExcelParseError';
    this.fileName = fileName;
    this.reason = reason;
  }
}

export function readWorkbook(filePath: string, fileName: string): Promise<RawWorkbook> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, {
      workerData: { filePath, fileName },
      resourceLimits: {
        // Caps the blast radius of a workbook that expands badly in memory.
        maxOldGenerationSizeMb: 1024,
      },
    });

    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new ExcelParseError(
            `Parsing "${fileName}" exceeded ${PARSE_TIMEOUT_MS / 1000}s and was stopped.`,
            fileName,
            'timeout',
          ),
        ),
      );
    }, PARSE_TIMEOUT_MS);

    worker.on('message', (message: { ok: boolean; workbook?: RawWorkbook; error?: { message: string } }) => {
      finish(() => {
        if (message.ok && message.workbook) {
          resolve(message.workbook);
        } else {
          reject(
            new ExcelParseError(
              message.error?.message ?? 'The workbook could not be read.',
              fileName,
              'corrupt',
            ),
          );
        }
      });
    });

    worker.on('error', (err) => {
      finish(() => reject(new ExcelParseError(err.message, fileName, 'worker')));
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        finish(() =>
          reject(new ExcelParseError(`Parser exited with code ${code}.`, fileName, 'worker')),
        );
      }
    });
  });
}

const EXCEL_EXTENSIONS = new Set(['.xlsx', '.xls', '.xlsm', '.xlsb', '.xltx', '.csv']);

export function isExcelFile(fileName: string): boolean {
  return EXCEL_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

export function isZipFile(fileName: string): boolean {
  return path.extname(fileName).toLowerCase() === '.zip';
}

export function fileExtension(fileName: string): string {
  return path.extname(fileName).toLowerCase().replace('.', '') || 'unknown';
}
