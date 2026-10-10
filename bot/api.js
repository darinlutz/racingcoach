// Calls the RacingCoach website's bot-only API routes (src/app/api/bot/ in this repo), so the AI
// coaching logic stays in one place. Authenticated with BOT_API_SECRET, which the website also has.

// The coaching agent makes several model calls; give it time but don't hang forever
const COACH_TIMEOUT_MS = 90_000;

function apiBaseUrl() {
  // RACINGCOACH_API_URL lets a local bot use a local website; otherwise the public site
  const baseUrl = (process.env.RACINGCOACH_API_URL || process.env.SITE_URL)?.trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('RACINGCOACH_API_URL or SITE_URL is not set');
  return baseUrl;
}

// The AI coach's { summary, opportunities } for the Discord user's synced races
export async function getCoaching(discordUserId) {
  const secret = process.env.BOT_API_SECRET?.trim();
  if (!secret) throw new Error('BOT_API_SECRET is not set');

  const response = await fetch(`${apiBaseUrl()}/api/bot/coach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ discordUserId }),
    signal: AbortSignal.timeout(COACH_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Coaching request failed: ${response.status} ${body.error ?? ''}`.trim());
    // The website's error code, e.g. out_of_credits when the AI service has no credits left
    error.code = body.error;
    throw error;
  }
  return body.coaching;
}
