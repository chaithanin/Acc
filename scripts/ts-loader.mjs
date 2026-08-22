/**
 * Module resolution hooks so Node can run the app's TypeScript directly.
 *
 * Node strips types on its own; what it does not do is understand the two
 * conveniences the Next.js build gives us:
 *
 *   1. the `@/*` path alias from tsconfig.json, and
 *   2. extensionless relative imports (`./index`, `../types`).
 *
 * Both are resolved here so `npm run seed` and `npm test` execute exactly the
 * same source the application does, with no separate build step.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(projectRoot, 'src');

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs'];

function resolveFile(basePath) {
  if (existsSync(basePath) && statSync(basePath).isFile()) return basePath;

  for (const ext of EXTENSIONS) {
    const candidate = `${basePath}${ext}`;
    if (existsSync(candidate)) return candidate;
  }

  for (const ext of EXTENSIONS) {
    const candidate = path.join(basePath, `index${ext}`);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

export function resolve(specifier, context, nextResolve) {
  // See scripts/server-only-stub.mjs: the real package exists to be replaced
  // by a bundler, and there is none here.
  if (specifier === 'server-only') {
    return asModule(path.join(projectRoot, 'scripts/server-only-stub.mjs'));
  }

  if (specifier.startsWith('@/')) {
    const resolved = resolveFile(path.join(srcRoot, specifier.slice(2)));
    if (resolved) return asModule(resolved);
  }

  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const resolved = resolveFile(path.resolve(parentDir, specifier));
    if (resolved) return asModule(resolved);
  }

  return nextResolve(specifier, context);
}

/**
 * The app has no `"type": "module"`, so Node would otherwise re-parse each
 * .ts file to discover it is ESM. Declaring the format up front avoids that.
 */
function asModule(filePath) {
  const url = pathToFileURL(filePath).href;
  const isTs = /\.(ts|tsx|mts)$/.test(filePath);
  return { url, format: isTs ? 'module-typescript' : undefined, shortCircuit: true };
}
