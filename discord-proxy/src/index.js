// Forwards the website's Discord OAuth2 requests (src/lib/discord.ts) to discord.com, so they come from
// Cloudflare's IP addresses instead of Render's shared ones, which Discord's Cloudflare protection
// sometimes bans. Only the three requests linking an account needs are forwarded, and only when they
// carry the shared secret (PROXY_SECRET here, DISCORD_PROXY_SECRET on the website).

const DISCORD_ORIGIN = 'https://discord.com';

const ALLOWED = new Set([
  'POST /api/v10/oauth2/token',
  'GET /api/v10/users/@me',
  'POST /api/v10/oauth2/token/revoke',
]);

function sameSecret(given, expected) {
  const encoder = new TextEncoder();
  const a = encoder.encode(given);
  const b = encoder.encode(expected);
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

const worker = {
  async fetch(request, env) {
    if (!env.PROXY_SECRET) {
      return Response.json({ error: 'PROXY_SECRET is not configured' }, { status: 500 });
    }
    if (!sameSecret(request.headers.get('X-Proxy-Secret') ?? '', env.PROXY_SECRET)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    if (!ALLOWED.has(`${request.method} ${url.pathname}`)) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    // Only the headers Discord needs; the secret stays here
    const headers = new Headers();
    for (const name of ['Authorization', 'Content-Type']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set('User-Agent', 'RacingCoach (https://racingcoach.app, 1.0)');

    return fetch(`${DISCORD_ORIGIN}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body: request.method === 'GET' ? undefined : await request.text(),
    });
  },
};

export default worker;
