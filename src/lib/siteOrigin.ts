// The public origin the visitor used (e.g. https://clarivex.app or
// http://localhost:3000). Behind the host's proxy, request.url is the internal
// bind address (http://0.0.0.0:10000), so read the forwarded headers instead.
export function getSiteOrigin(request: Request): string {
  const fallback = new URL(request.url);
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0].trim() ||
    request.headers.get('host') ||
    fallback.host;
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0].trim() ||
    fallback.protocol.replace(':', '');
  return `${proto}://${host}`;
}

// The site's public URL for links that leave the site (emails, OAuth redirects). SITE_URL pins it
// to the real domain in production so a forged Host header can't redirect them; locally it falls
// back to the request. Stray whitespace or a trailing slash in SITE_URL is ignored.
// In production SITE_URL is required: without it a POST with a forged Host or X-Forwarded-Host header would get a
// real password reset or confirmation link pointing at someone else's site, so this throws instead.
export function getPublicSiteUrl(request: Request): string {
  const siteUrl = process.env.SITE_URL?.trim().replace(/\/+$/, '');
  if (siteUrl) return siteUrl;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SITE_URL is not set: links in emails and OAuth redirects need the real site address');
  }
  return getSiteOrigin(request);
}
