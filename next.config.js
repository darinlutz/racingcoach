import path from 'path';
import { fileURLToPath } from 'url';
import { securityHeaders } from './security-headers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  output: 'standalone',
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  turbopack: {
    root: __dirname,
  },
  // HSTS, nosniff, framing, referrer, permissions and the Content-Security-Policies on every response
  // (security-headers.mjs)
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders({ dev: process.env.NODE_ENV !== 'production' }) }];
  },
};

export default nextConfig;
