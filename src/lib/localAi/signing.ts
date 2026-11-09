// Signed requests between the website and a local AI server (docs/local-ai.md): the Mac's heartbeats to the website,
// and the website's inference and health calls to the Mac's gateway (local-ai/gateway.ts, which imports this file, so
// it has no imports but node:crypto). HMAC-SHA256 with the shared secret (LOCAL_AI_SHARED_SECRET on both sides) over
// the purpose, method, path, timestamp, a random nonce and the body's SHA-256. A request is refused when its
// timestamp is more than MAX_SKEW_MS from the receiver's clock, or its nonce was seen within twice that, so a
// captured request can't be replayed. The purpose keeps a heartbeat's signature from being reused as an inference
// call's, and the other way round.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADERS = {
  timestamp: 'x-rc-timestamp',
  nonce: 'x-rc-nonce',
  signature: 'x-rc-signature',
} as const;

export type SignaturePurpose = 'heartbeat' | 'inference';

export const MAX_SKEW_MS = 60_000;
export const MIN_SECRET_LENGTH = 32;

export type SignedParts = { method: string; path: string; body: string };

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function canonical(purpose: SignaturePurpose, parts: SignedParts, timestamp: string, nonce: string): string {
  return ['racingcoach-local-ai-v1', purpose, parts.method.toUpperCase(), parts.path, timestamp, nonce, sha256(parts.body)].join('\n');
}

export function secretUsable(secret: string | undefined): secret is string {
  return typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH;
}

// The headers that sign a request
export function signRequest(
  secret: string,
  purpose: SignaturePurpose,
  parts: SignedParts,
  now: number = Date.now(),
  nonce: string = randomBytes(16).toString('hex')
): Record<string, string> {
  const timestamp = String(now);
  const signature = createHmac('sha256', secret).update(canonical(purpose, parts, timestamp, nonce)).digest('hex');
  return {
    [SIGNATURE_HEADERS.timestamp]: timestamp,
    [SIGNATURE_HEADERS.nonce]: nonce,
    [SIGNATURE_HEADERS.signature]: signature,
  };
}

// Nonces seen recently, so each signed request is accepted once
export class NonceCache {
  #seen = new Map<string, number>();
  #maxEntries: number;

  constructor(maxEntries = 50_000) {
    this.#maxEntries = maxEntries;
  }

  // true when the nonce is new (and now remembered), false when it was seen
  remember(nonce: string, now: number): boolean {
    this.prune(now);
    if (this.#seen.has(nonce)) return false;
    if (this.#seen.size >= this.#maxEntries) {
      // Full: forget the oldest, which are past their window anyway once the cache is this busy
      const oldest = this.#seen.keys().next().value;
      if (oldest !== undefined) this.#seen.delete(oldest);
    }
    this.#seen.set(nonce, now);
    return true;
  }

  prune(now: number) {
    for (const [nonce, at] of this.#seen) {
      if (now - at <= 2 * MAX_SKEW_MS) break;
      this.#seen.delete(nonce);
    }
  }
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'missing' | 'malformed' | 'stale' | 'badSignature' | 'replayed' };

const header = (headers: Headers | Record<string, string | string[] | undefined>, name: string): string | null => {
  if (headers instanceof Headers) return headers.get(name);
  const value = headers[name];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
};

// Checks a request's signature. The nonce is only remembered once the signature is good, so nobody can use up
// nonces with forged requests.
export function verifyRequest(
  secret: string,
  purpose: SignaturePurpose,
  parts: SignedParts,
  headers: Headers | Record<string, string | string[] | undefined>,
  nonces: NonceCache,
  now: number = Date.now()
): VerifyResult {
  const timestamp = header(headers, SIGNATURE_HEADERS.timestamp);
  const nonce = header(headers, SIGNATURE_HEADERS.nonce);
  const signature = header(headers, SIGNATURE_HEADERS.signature);
  if (!timestamp || !nonce || !signature) return { ok: false, reason: 'missing' };
  if (!/^\d{10,16}$/.test(timestamp) || !/^[0-9a-f]{16,64}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(signature)) {
    return { ok: false, reason: 'malformed' };
  }
  if (Math.abs(now - Number(timestamp)) > MAX_SKEW_MS) return { ok: false, reason: 'stale' };
  const expected = createHmac('sha256', secret).update(canonical(purpose, parts, timestamp, nonce)).digest();
  const given = Buffer.from(signature, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'badSignature' };
  if (!nonces.remember(nonce, now)) return { ok: false, reason: 'replayed' };
  return { ok: true };
}
