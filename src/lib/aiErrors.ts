import { NextResponse } from 'next/server';

// Shown instead of a route's generic error when OpenAI refuses the request because the account has
// no credits left (HTTP 429, insufficient_quota), so the cause is obvious from the page.
export const AI_OUT_OF_CREDITS = 'The AI service is out of credits';

// OpenAI's codes for an exhausted balance. The Python scripts only pass the message text along, so
// that is checked too.
const OUT_OF_CREDITS_MARKERS = ['insufficient_quota', 'credit_balance_exhausted', 'You have no credits remaining'];

export function isAiOutOfCredits(error: unknown): boolean {
  for (let e = error, depth = 0; e && typeof e === 'object' && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const { code, type, message } = e as { code?: unknown; type?: unknown; message?: unknown };
    const text = [code, type, message].filter((v) => typeof v === 'string').join(' ');
    if (OUT_OF_CREDITS_MARKERS.some((marker) => text.includes(marker))) return true;
  }
  return false;
}

// The error response for a failed AI route: the out-of-credits message when that is the cause,
// otherwise the route's own message
export function aiErrorResponse(error: unknown, fallback: string): NextResponse {
  return isAiOutOfCredits(error)
    ? NextResponse.json({ error: AI_OUT_OF_CREDITS }, { status: 503 })
    : NextResponse.json({ error: fallback }, { status: 500 });
}
