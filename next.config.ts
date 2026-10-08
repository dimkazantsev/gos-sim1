import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { useTypeScriptCli: false },
  serverExternalPackages: ['mammoth', 'unpdf'],
  outputFileTracingIncludes: {
    '/api/extract-document': ['./lib/server/document-parser.worker.cjs', './node_modules/mammoth/**/*', './node_modules/unpdf/**/*', './node_modules/underscore/underscore-umd.js'],
    '/api/import-cloud-document': ['./lib/server/document-parser.worker.cjs', './node_modules/mammoth/**/*', './node_modules/unpdf/**/*', './node_modules/underscore/underscore-umd.js']
  },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" }
    ] }];
  }
};

export default nextConfig;
