import type { RateLimitInfo } from './rateLimitConfig';

// Lets the page's AI features show the rate limit dialog (src/components/RateLimitDialog.tsx, in the root layout)
// when an AI route answers 429 because the user's limit is used up (src/lib/rateLimits.ts aiRateLimit). Call it
// with the response and its parsed JSON; anything but a rate limit answer is ignored, so the feature still shows
// the error message as usual.

export const RATE_LIMIT_EVENT = 'racingcoach:ai-rate-limit';

export type RateLimitEventDetail = { message: string; info: RateLimitInfo };

export function reportRateLimit(res: Response, data: unknown): void {
  if (res.status !== 429 || typeof window === 'undefined') return;
  const body = data as { error?: unknown; rateLimit?: RateLimitInfo } | null;
  if (!body?.rateLimit) return;
  const detail: RateLimitEventDetail = { message: typeof body.error === 'string' ? body.error : '', info: body.rateLimit };
  window.dispatchEvent(new CustomEvent(RATE_LIMIT_EVENT, { detail }));
}
