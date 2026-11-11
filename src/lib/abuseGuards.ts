// Spam and abuse guards for the routes open to visitors: Support, signup, log in and forgot password.
//
// Attempt limits are counted in this server's memory, like overAttemptLimit in tvAuth.ts: a restart starts the
// counts over, and with more than one server instance each would count separately (they'd have to move to Postgres).
// Off for the e2e tests, which sign up many accounts from one address and fill forms at machine speed: ABUSE_GUARDS=off,
// set only by playwright.config.ts (NODE_ENV=test too, though Next.js can fix NODE_ENV in the code it compiles, so
// it can't be relied on alone).

import { clientIp } from './clientIp';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const ABUSE_LIMITS = {
  // Reports sent per IP address an hour, and by everyone a day (rolling)
  supportPerIp: { max: 3, windowMs: HOUR },
  supportPerDay: { max: 30, windowMs: DAY },
  // Accounts created per IP address an hour
  signupPerIp: { max: 5, windowMs: HOUR },
  // Failed logins per IP address, and per email address, in 15 minutes
  loginFailuresPerIp: { max: 10, windowMs: 15 * MINUTE },
  loginFailuresPerEmail: { max: 10, windowMs: 15 * MINUTE },
  // Reset requests per email address and per IP address an hour
  resetPerEmail: { max: 3, windowMs: HOUR },
  resetPerIp: { max: 10, windowMs: HOUR },
  // Email address confirmation links resent per account an hour (signing up sends the first)
  verifyEmailPerUser: { max: 3, windowMs: HOUR },
  // The telemetry collector's uploads per account (upload key): normally a lap every minute or so plus its re-upload
  // with track positions after the stint, and a log batch every 15 s; a played-back .ibt can send a session at once.
  // Well above that, so only a runaway or abusive collector meets them (it retries a 429 later)
  lapUploadsPerHour: { max: 300, windowMs: HOUR },
  lapUploadsPerDay: { max: 1500, windowMs: DAY },
  logBatchesPerHour: { max: 600, windowMs: HOUR },
  // Content-Security-Policy violation reports per IP address an hour (/api/csp-report): enough to see a problem
  cspReportsPerIp: { max: 30, windowMs: HOUR },
  // Live video (docs/live-video.md): the Live Racing page asks for its streams every 15 s, a TV reports its player's
  // metrics every 10 s, and an Admin adds or removes live inputs (each a Cloudflare API call)
  liveVideoStreamsPerUser: { max: 30, windowMs: MINUTE },
  liveVideoReportsPerTv: { max: 20, windowMs: MINUTE },
  liveVideoInputsPerAdmin: { max: 10, windowMs: HOUR },
} as const;

// A form submitted sooner than this after the page showed it was filled by a script
export const MIN_FORM_FILL_MS = 2000;

const guardsOn = () => process.env.ABUSE_GUARDS !== 'off' && process.env.NODE_ENV !== 'test';

const attempts = new Map<string, number[]>();
const longestWindow = Math.max(...Object.values(ABUSE_LIMITS).map((limit) => limit.windowMs));

function recent(key: string, windowMs: number, now: number): number[] {
  return (attempts.get(key) ?? []).filter((at) => now - at < windowMs);
}

// Whether key already has max attempts in the window (doesn't count this one)
export function limitReached(key: string, limit: { max: number; windowMs: number }): boolean {
  if (!guardsOn()) return false;
  return recent(key, limit.windowMs, Date.now()).length >= limit.max;
}

// Counts an attempt against key
export function recordAttempt(key: string): void {
  if (!guardsOn()) return;
  const now = Date.now();
  const times = recent(key, longestWindow, now);
  times.push(now);
  attempts.set(key, times);
  if (attempts.size > 10_000) {
    for (const [k, list] of attempts) if (list.every((at) => now - at >= longestWindow)) attempts.delete(k);
  }
}

export function clearAttempts(key: string): void {
  attempts.delete(key);
}

export function ipKey(request: Request): string {
  return clientIp(request) ?? 'unknown';
}

// The Support and Create an Account forms send formTrap, a field hidden from people that only bots fill in, and
// formMs, how long the form was on screen before it was sent (FormGuard.tsx). 'trap' is a bot; 'tooFast' is a
// script, or a page loaded before these fields existed, which a reload fixes.
export function checkFormGuard(body: { formTrap?: unknown; formMs?: unknown }): 'ok' | 'trap' | 'tooFast' {
  if (!guardsOn()) return 'ok';
  if (typeof body.formTrap === 'string' && body.formTrap.trim() !== '') return 'trap';
  if (typeof body.formMs !== 'number' || !Number.isFinite(body.formMs) || body.formMs < MIN_FORM_FILL_MS) return 'tooFast';
  return 'ok';
}
