/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['better-sqlite3', 'xlsx'],
  experimental: {
    serverActions: {
      // Financial workbooks and ZIP bundles can be large; parsing happens server-side.
      bodySizeLimit: '100mb',
    },
  },
};

export default nextConfig;
