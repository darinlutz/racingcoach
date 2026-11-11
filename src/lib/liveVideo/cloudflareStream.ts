import { createPrivateKey, createSign } from 'node:crypto';
import {
  combineStatus,
  isCustomerCode,
  isLiveInputId,
  playbackUrls,
  signingInput,
  base64Url,
  statusFromLifecycle,
  statusFromLiveInput,
  STATUS_CACHE_MS,
  TOKEN_REFRESH_S,
  TOKEN_TTL_S,
  tokenClaims,
  type StreamStatus,
} from './streamRules.ts';

// Cloudflare Stream Live from the server (docs/live-video.md). Everything secret stays here: the API token, the signing
// key and the stream keys (never even read: OBS gets its key from the Cloudflare dashboard). Viewers get only a
// playback URL, and only while the stream is live. Each live input's status is asked for at most every
// STATUS_CACHE_MS however many viewers ask, one request at a time.
//
// Environment (Render):
//   CLOUDFLARE_STREAM_ACCOUNT_ID     the Cloudflare account ID
//   CLOUDFLARE_STREAM_API_TOKEN      an API token with Stream Read (status) or Stream Edit (also create/delete inputs)
//   CLOUDFLARE_STREAM_CUSTOMER_CODE  the <CODE> in customer-<CODE>.cloudflarestream.com
//   CLOUDFLARE_STREAM_SIGNING_KEY_ID, CLOUDFLARE_STREAM_SIGNING_KEY_PEM  optional: a Stream signing key (the PEM as
//                                    Cloudflare returns it, base64), for inputs that require signed URLs

const API = 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 8000;

export type StreamConfig = {
  accountId: string | null;
  apiToken: string | null;
  customerCode: string | null;
  signingKeyId: string | null;
  signingKeyPem: string | null;
};

export function streamConfig(): StreamConfig {
  const value = (name: string) => process.env[name]?.trim() || null;
  const code = value('CLOUDFLARE_STREAM_CUSTOMER_CODE')?.toLowerCase().replace(/^customer-/, '').replace(/\.cloudflarestream\.com.*$/, '') ?? null;
  return {
    accountId: value('CLOUDFLARE_STREAM_ACCOUNT_ID'),
    apiToken: value('CLOUDFLARE_STREAM_API_TOKEN'),
    customerCode: isCustomerCode(code) ? code : null,
    signingKeyId: value('CLOUDFLARE_STREAM_SIGNING_KEY_ID'),
    signingKeyPem: value('CLOUDFLARE_STREAM_SIGNING_KEY_PEM'),
  };
}

// What's missing for playback (the customer code) and for the API (account and token), for the Admin page
export function streamSetup(config = streamConfig()) {
  return {
    playback: !!config.customerCode,
    api: !!config.accountId && !!config.apiToken,
    signing: !!config.signingKeyId && !!config.signingKeyPem,
  };
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = streamConfig();
  if (!config.accountId || !config.apiToken) throw new Error('Cloudflare Stream API is not configured');
  const response = await fetch(`${API}/accounts/${encodeURIComponent(config.accountId)}/stream${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${config.apiToken}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  const json = (await response.json().catch(() => null)) as { success?: boolean; result?: T; errors?: { message?: string }[] } | null;
  if (!response.ok || !json?.success) {
    // Cloudflare's own message, never the request (it carries the token)
    throw new Error(`Cloudflare Stream ${response.status}: ${json?.errors?.map((e) => e.message).join('; ') || 'request failed'}`);
  }
  return json.result as T;
}

export type LiveInputInfo = { uid: string; rtmpsUrl: string | null; name: string | null };

// A new live input, with recording off (nothing stored, so no storage charges) and signed URLs as asked. The stream
// key Cloudflare returns is deliberately dropped: OBS gets it from the Cloudflare dashboard
export async function createLiveInput(name: string, requireSignedUrls: boolean): Promise<LiveInputInfo> {
  const result = await api<{ uid: string; rtmps?: { url?: string }; meta?: { name?: string } }>('/live_inputs', {
    method: 'POST',
    body: JSON.stringify({ meta: { name }, recording: { mode: 'off', requireSignedURLs: requireSignedUrls }, deleteRecordingAfterDays: 30 }),
  });
  if (!isLiveInputId(result.uid)) throw new Error('Cloudflare Stream returned no live input ID');
  return { uid: result.uid, rtmpsUrl: result.rtmps?.url ?? null, name: result.meta?.name ?? name };
}

export async function deleteLiveInput(uid: string): Promise<void> {
  if (!isLiveInputId(uid)) throw new Error('Not a live input ID');
  await api(`/live_inputs/${uid}`, { method: 'DELETE' });
}

// A live input the Admin typed in exists in this account, with its RTMPS URL (not the key)
export async function readLiveInput(uid: string): Promise<LiveInputInfo & { status: StreamStatus }> {
  const result = await api<Record<string, unknown> & { uid: string; rtmps?: { url?: string }; meta?: { name?: string } }>(`/live_inputs/${uid}`);
  return { uid: result.uid, rtmpsUrl: result.rtmps?.url ?? null, name: result.meta?.name ?? null, status: statusFromLiveInput(result) };
}

async function lifecycle(uid: string, code: string): Promise<{ status: StreamStatus; videoUid: string | null }> {
  const config = streamConfig();
  const response = await fetch(`https://customer-${code}.cloudflarestream.com/${uid}/lifecycle`, {
    headers: config.apiToken ? { Authorization: `Bearer ${config.apiToken}` } : {},
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!response.ok) return { status: 'UNKNOWN', videoUid: null };
  return statusFromLifecycle(await response.json().catch(() => null));
}

export type StreamHealth = {
  status: StreamStatus;
  // The broadcast's video UID while live (what signed tokens are for)
  videoUid: string | null;
  checkedAt: number;
  // What went wrong asking, for the Admin page (Cloudflare's message only)
  error: string | null;
  // When it was last seen live, and how many times it dropped since the server started, for stream health
  lastLiveAt: number | null;
  interruptions: number;
};

const store = globalThis as unknown as {
  liveVideoStatus?: { health: Map<string, StreamHealth>; pending: Map<string, Promise<StreamHealth>>; tokens: Map<string, { token: string; exp: number }> };
};
const cache = (store.liveVideoStatus ??= { health: new Map(), pending: new Map(), tokens: new Map() });

async function fetchHealth(uid: string): Promise<StreamHealth> {
  const config = streamConfig();
  const before = cache.health.get(uid);
  let apiStatus: StreamStatus | null = null;
  let error: string | null = null;
  if (config.accountId && config.apiToken) {
    try {
      apiStatus = (await readLiveInput(uid)).status;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  let life: { status: StreamStatus; videoUid: string | null } | null = null;
  if (config.customerCode) {
    try {
      life = await lifecycle(uid, config.customerCode);
    } catch (e) {
      error ??= e instanceof Error ? e.message : String(e);
    }
  }
  let status = combineStatus(apiStatus, life?.status ?? null);
  if (status === 'UNKNOWN' && error) status = 'ERROR';
  const now = Date.now();
  const wasLive = before?.status === 'LIVE';
  const health: StreamHealth = {
    status,
    videoUid: life?.videoUid ?? null,
    checkedAt: now,
    error,
    lastLiveAt: status === 'LIVE' ? now : (before?.lastLiveAt ?? null),
    interruptions: (before?.interruptions ?? 0) + (wasLive && status !== 'LIVE' ? 1 : 0),
  };
  if (wasLive !== (status === 'LIVE')) console.log(`Live video: input ${uid.slice(0, 8)}… is ${status}`);
  cache.health.set(uid, health);
  return health;
}

// The stream's health, from the cache when it's fresh enough
export async function streamHealth(uid: string, maxAgeMs = STATUS_CACHE_MS): Promise<StreamHealth> {
  const cached = cache.health.get(uid);
  if (cached && Date.now() - cached.checkedAt < maxAgeMs) return cached;
  let pending = cache.pending.get(uid);
  if (!pending) {
    pending = fetchHealth(uid).finally(() => cache.pending.delete(uid));
    cache.pending.set(uid, pending);
  }
  return pending;
}

// The last health known, without asking Cloudflare
export const cachedHealth = (uid: string): StreamHealth | null => cache.health.get(uid) ?? null;

// A signed playback token for the live video, shared by every viewer (it names no one) and reused until it's near its
// end; null without a signing key or before the broadcast's video UID is known
function signedToken(videoUid: string): { token: string; exp: number } | null {
  const config = streamConfig();
  if (!config.signingKeyId || !config.signingKeyPem) return null;
  const now = Math.floor(Date.now() / 1000);
  const cached = cache.tokens.get(videoUid);
  if (cached && cached.exp - now > TOKEN_REFRESH_S) return cached;
  // Cloudflare gives the PEM base64-encoded; a PEM pasted as it is works too
  const pem = config.signingKeyPem.includes('BEGIN') ? config.signingKeyPem : Buffer.from(config.signingKeyPem, 'base64').toString('utf8');
  const claims = tokenClaims(videoUid, config.signingKeyId, now, TOKEN_TTL_S);
  const input = signingInput(claims);
  const signature = createSign('RSA-SHA256').update(input).sign(createPrivateKey(pem));
  const token = { token: `${input}.${base64Url(new Uint8Array(signature))}`, exp: claims.payload.exp };
  cache.tokens.set(videoUid, token);
  return token;
}

export type Playback = { hls: string; iframe: string; expiresAt: number | null; signed: boolean };

// The viewer's playback URLs, signed when the input requires it. Null when playback isn't set up, or the input
// requires signed URLs and they can't be made
export function playbackFor(uid: string, health: StreamHealth | null, requireSigned: boolean): Playback | null {
  const config = streamConfig();
  if (!config.customerCode || !isLiveInputId(uid)) return null;
  if (requireSigned) {
    const token = health?.videoUid ? signedToken(health.videoUid) : null;
    if (!token) return null;
    return { ...playbackUrls(config.customerCode, token.token), expiresAt: token.exp * 1000, signed: true };
  }
  return { ...playbackUrls(config.customerCode, uid), expiresAt: null, signed: false };
}
