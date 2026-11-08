import { ABUSE_LIMITS, ipKey, limitReached, recordAttempt } from '@/lib/abuseGuards';
import { readJsonLimited } from '@/lib/requestBody';

// Where browsers report what the Content-Security-Policy-Report-Only header (security-headers.mjs) would have
// blocked. Logged as one "CSP report" line each, so Render's logs show whether the full policy can be enforced; nothing
// is stored. Public, as browsers send it without credentials: the body is capped and each IP address gets a few an hour.
// Only the directive, what was blocked (its origin, no path or query) and the page's path are logged, never a URL's
// query or anything about the visitor.
function originOf(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'none';
  try {
    const url = new URL(value);
    return url.origin === 'null' ? url.protocol : url.origin;
  } catch {
    return value.slice(0, 40); // 'inline', 'eval', 'data', ...
  }
}

function pathOf(value: unknown): string {
  try {
    return typeof value === 'string' ? new URL(value).pathname.slice(0, 120) : '?';
  } catch {
    return '?';
  }
}

export async function POST(request: Request) {
  try {
    const key = `csp-report:${ipKey(request)}`;
    if (limitReached(key, ABUSE_LIMITS.cspReportsPerIp)) return new Response(null, { status: 204 });
    recordAttempt(key);
    const body = await readJsonLimited(request, 16 * 1024).catch(() => null);
    const report = body?.['csp-report'] ?? body;
    if (report && typeof report === 'object') {
      const directive = String(report['effective-directive'] ?? report['violated-directive'] ?? '?').split(' ')[0];
      console.warn(`CSP report: ${directive} blocked ${originOf(report['blocked-uri'])} on ${pathOf(report['document-uri'])}`);
    }
  } catch (error) {
    console.error('CSP report error:', error);
  }
  return new Response(null, { status: 204 });
}
