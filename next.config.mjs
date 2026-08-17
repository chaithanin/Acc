/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emits .next/standalone with a self-contained server and only the traced
  // dependencies, which keeps the deployed image small.
  output: 'standalone',

  serverExternalPackages: ['better-sqlite3', 'xlsx'],

  // schema.sql is read at runtime by getDb(). Nothing imports it, so tracing
  // cannot find it on its own and it has to be named explicitly or the
  // container starts without a schema.
  outputFileTracingIncludes: {
    '/**': ['./src/lib/db/schema.sql'],
  },

  // Tracing otherwise sweeps the working directory into .next/standalone,
  // which on a developer machine means the live SQLite database and every
  // uploaded client workbook. Those must never reach a build artefact, let
  // alone a deployed image.
  outputFileTracingExcludes: {
    '/**': ['./data/**', './samples/**', './tests/**', './docs/**'],
  },

  experimental: {
    serverActions: {
      // Financial workbooks and ZIP bundles can be large; parsing happens server-side.
      bodySizeLimit: '100mb',
    },
  },
};

export default nextConfig;
