// The HTTP security headers on every response (next.config.js headers()). Plain JavaScript with no imports, so
// next.config.js and the tests (scripts/launch-hardening.test.mjs) share it. docs/launch-readiness-audit-2026-11-07.md
// F-24.
//
// Two Content-Security-Policies:
// - ENFORCED: what can't break a working page. frame-ancestors 'none' stops the site being framed (clickjacking of
//   Delete Account, Change Password or the Admin page); object-src, base-uri; form-action allows the site and Stripe,
//   as Chrome checks form-action on the redirect too (Pricing's form posts to /api/create-checkout-session, which
//   redirects to checkout.stripe.com).
// - REPORT_ONLY: the whole policy, which browsers only report against (to /api/csp-report, logged as "CSP report"),
//   so it can be enforced once a while of real use shows nothing legitimate would be blocked. Scripts still need
//   'unsafe-inline': Next.js's own inline scripts would need a nonce per response to drop it.
// The browser only leaves the site for Stripe checkout and the sign-in providers (navigations, which CSP doesn't
// govern) and the Broadcast Video Library's files in Cloudflare R2 (uploaded and played from the bucket's address).

const R2 = 'https://*.r2.cloudflarestorage.com';

export const ENFORCED_CSP = [
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com",
].join('; ');

export function reportOnlyCsp({ dev = false } = {}) {
  return [
    "default-src 'self'",
    // Next.js's inline scripts; the dev server also evaluates code and talks over a WebSocket
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    // The profile picture cropper and the 3D view draw to canvases (blob: and data: images)
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // blob: is the page's own data (e.g. the engine sound played under the announcers, read with fetch)
    `connect-src 'self' blob: ${R2}${dev ? ' ws: wss:' : ''}`,
    `media-src 'self' blob: data: ${R2}`,
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com",
    'report-uri /api/csp-report',
  ].join('; ');
}

export function securityHeaders({ dev = false } = {}) {
  return [
    // HTTPS only, for two years, subdomains too (only after a visit over HTTPS; never sent over plain HTTP)
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    // For browsers that don't know frame-ancestors
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // The microphone only for the site itself (Live Racing's Hold to Talk); nothing else the site doesn't use
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()' },
    { key: 'Content-Security-Policy', value: ENFORCED_CSP },
    { key: 'Content-Security-Policy-Report-Only', value: reportOnlyCsp({ dev }) },
  ];
}
