import { isIP } from 'node:net';

// The caller's IP address, for every per-IP limit (signup, login, password reset, Support, privacy requests, TV
// pairing, visitors' AI calls) and the activity log. A browser can put anything in X-Forwarded-For, and a proxy that
// appends to it leaves the browser's value first, so the first entry can't be trusted on its own. In order:
// 1. CLIENT_IP_HEADER, when set: the one header the hosting infrastructure sets itself (e.g. cf-connecting-ip). For
//    a header with a list (x-forwarded-for), its last entry, the one the nearest proxy added.
// 2. CF-Connecting-IP: Render's edge is Cloudflare, which sets this header to the address that connected to it and
//    replaces any the browser sent, so it can't be spoofed through Render.
// 3. The first X-Forwarded-For entry, then X-Real-IP (local development and other hosts).
// Whatever isn't a valid IP address is ignored. The first request logs which headers arrived, so the deployment can be
// checked in its logs (see logClientIpSourceOnce). No other imports, so tests run it directly.

type HeadersLike = { get(name: string): string | null };

const valid = (value: string | null | undefined) => {
  const ip = value?.trim();
  return ip && isIP(ip) ? ip : null;
};

export function clientIpFromHeaders(headers: HeadersLike, configured = process.env.CLIENT_IP_HEADER): string | null {
  const name = configured?.trim().toLowerCase();
  if (name) {
    const list = headers.get(name)?.split(',') ?? [];
    return valid(list[list.length - 1]);
  }
  return (
    valid(headers.get('cf-connecting-ip')) ??
    valid(headers.get('x-forwarded-for')?.split(',')[0]) ??
    valid(headers.get('x-real-ip'))
  );
}

let logged = false;

// Logs once per server start which address headers a request had (their names and how many addresses, never the
// addresses themselves), so it's plain from the logs whether CF-Connecting-IP arrives on this host
export function logClientIpSourceOnce(headers: HeadersLike): void {
  if (logged) return;
  logged = true;
  const forwarded = headers.get('x-forwarded-for');
  console.log(
    `Client IP headers: cf-connecting-ip ${headers.get('cf-connecting-ip') ? 'present' : 'absent'}, ` +
      `true-client-ip ${headers.get('true-client-ip') ? 'present' : 'absent'}, ` +
      `x-forwarded-for ${forwarded ? `${forwarded.split(',').length} address(es)` : 'absent'}` +
      (process.env.CLIENT_IP_HEADER ? `; using CLIENT_IP_HEADER=${process.env.CLIENT_IP_HEADER}` : '')
  );
}

export function clientIp(request: Request): string | null {
  logClientIpSourceOnce(request.headers);
  return clientIpFromHeaders(request.headers);
}
