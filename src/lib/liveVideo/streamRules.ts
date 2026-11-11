// Cloudflare Stream Live's pure parts (docs/live-video.md): what a live input's status means, the playback URLs, and
// the claims of a signed playback token. No imports, so Node's tests run it directly (npm run test:live-video).

// The stream's state as the website knows it from Cloudflare. The player adds BUFFERING of its own
export type StreamStatus = 'LIVE' | 'CONNECTING' | 'OFFLINE' | 'ERROR' | 'UNKNOWN';
export type PlayerStatus = StreamStatus | 'BUFFERING';

// At most this many live inputs: each is a stream the site's account pays to deliver, so they're added by an Admin
// only, never by viewers
export const MAX_LIVE_STREAMS = 10;
// Cloudflare is asked about each live input at most this often, however many viewers there are
export const STATUS_CACHE_MS = 10_000;
// A signed playback token lasts this long (Cloudflare allows up to 24 hours); viewers get a new one with each status
export const TOKEN_TTL_S = 2 * 60 * 60;
// Tokens are handed out until this long before they expire
export const TOKEN_REFRESH_S = 30 * 60;

// A live input's UID: 32 hex characters
export const isLiveInputId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
// The customer code of customer-<CODE>.cloudflarestream.com
export const isCustomerCode = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9]{4,64}$/.test(value);

// Cloudflare's connection states (GET /accounts/{account}/stream/live_inputs/{uid}: status, which may be the state
// itself or { current: { state } })
export function statusFromLiveInput(json: unknown): StreamStatus {
  const result = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  const raw = result.status;
  let state: unknown = raw;
  if (raw && typeof raw === 'object') {
    const current = (raw as Record<string, unknown>).current;
    state = current && typeof current === 'object' ? (current as Record<string, unknown>).state : (raw as Record<string, unknown>).state;
  }
  if (result.enabled === false) return 'OFFLINE';
  switch (state) {
    case 'connected':
    case 'reconnected':
      return 'LIVE';
    case 'reconnecting':
    case 'new_configuration_accepted':
      return 'CONNECTING';
    case 'failed_to_connect':
    case 'failed_to_reconnect':
      return 'ERROR';
    case null:
    case undefined:
    case 'client_disconnect':
    case 'ttl_exceeded':
    case 'disconnected':
      return 'OFFLINE';
    default:
      return 'UNKNOWN';
  }
}

// GET https://customer-<CODE>.cloudflarestream.com/<INPUT_ID>/lifecycle: { isInput, videoUID, live }
export function statusFromLifecycle(json: unknown): { status: StreamStatus; videoUid: string | null } {
  const r = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  const videoUid = isLiveInputId(r.videoUID) ? r.videoUID : null;
  if (r.live === true) return { status: 'LIVE', videoUid };
  if (r.live === false) return { status: 'OFFLINE', videoUid };
  return { status: 'UNKNOWN', videoUid };
}

// The two answers together: the API's connection state when there is one, the lifecycle's when the API couldn't say.
// The lifecycle's live means video is actually being delivered, so a connected encoder with nothing playable yet is
// CONNECTING
export function combineStatus(api: StreamStatus | null, lifecycle: StreamStatus | null): StreamStatus {
  if (api === 'LIVE' && lifecycle === 'OFFLINE') return 'CONNECTING';
  if (api && api !== 'UNKNOWN') return api;
  return lifecycle ?? api ?? 'UNKNOWN';
}

export type PlaybackUrls = { hls: string; iframe: string };

// The live input's HLS and iframe URLs, by its UID (it never changes between broadcasts) or a signed token in its place
export function playbackUrls(customerCode: string, idOrToken: string): PlaybackUrls {
  const base = `https://customer-${customerCode}.cloudflarestream.com/${encodeURIComponent(idOrToken)}`;
  return { hls: `${base}/manifest/video.m3u8`, iframe: `${base}/iframe` };
}

// A signed URL token's header and claims (RS256), for the video being broadcast: Cloudflare signs tokens for a video
// UID, so the live broadcast's videoUID from the lifecycle, not the input's
export function tokenClaims(sub: string, keyId: string, nowSeconds: number, ttlSeconds = TOKEN_TTL_S) {
  return {
    header: { alg: 'RS256', kid: keyId, typ: 'JWT' },
    payload: { sub, kid: keyId, nbf: nowSeconds - 60, exp: nowSeconds + ttlSeconds },
  };
}

export const base64Url = (input: string | Uint8Array): string => {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// The part of a JWT that's signed: base64url(header).base64url(payload)
export function signingInput(claims: ReturnType<typeof tokenClaims>): string {
  return `${base64Url(JSON.stringify(claims.header))}.${base64Url(JSON.stringify(claims.payload))}`;
}

// Cloudflare's playback minutes, for the cost estimate on the Admin page: every viewer watching a minute is a minute
// delivered, however many watch the same stream (USD per 1,000 minutes, published 2026-11)
export const DELIVERY_USD_PER_1000_MIN = 1;
export const STORAGE_USD_PER_1000_MIN_MONTH = 5;
export function deliveryCostUsd(viewers: number, minutes: number): number {
  return Math.round(viewers * minutes * DELIVERY_USD_PER_1000_MIN) / 1000;
}
