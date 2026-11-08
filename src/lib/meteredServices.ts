import { query } from './db';
import { ensureUserSchema } from './users';

// The Admin page's emergency stop for everything that's billed per use: every AI model call (chatModel), text to
// speech (synthesizeSpeech, elevenLabsSpeech), speech to text (transcribeRadio) and the satellite tile proxy. Each of
// those checks it itself, so no route can miss it, and aiRateLimit answers a clean 503 before any work. Unlike Enable
// AI Features, which changes what the site offers, this only stops the paid calls, at once, without a redeploy.
// "SiteSettings" key metered_services: on (running) when there's no row. Read at most every 5 s per server.

const KEY = 'metered_services';
const CACHE_MS = 5_000;
let cached: { at: number; on: boolean } | null = null;

export class MeteredServicesStoppedError extends Error {
  constructor() {
    super('Paid AI, speech and map services are stopped (Admin > Site Settings)');
    this.name = 'MeteredServicesStoppedError';
  }
}

export async function meteredServicesOn(): Promise<boolean> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.on;
  try {
    await ensureUserSchema();
    const rows = await query<{ value: string }>('SELECT value FROM racingcoach."SiteSettings" WHERE key = $1', [KEY]);
    cached = { at: Date.now(), on: rows.length === 0 || rows[0].value === 'true' };
  } catch (error) {
    // The database is down: keep the last answer, else stop (the rate limiter can't count calls either)
    console.error('Failed to read the metered services switch:', error);
    return cached?.on ?? false;
  }
  return cached.on;
}

// Throws MeteredServicesStoppedError while stopped
export async function assertMeteredServicesOn(): Promise<void> {
  if (!(await meteredServicesOn())) throw new MeteredServicesStoppedError();
}

// userId is the Admin who flipped it, or null for the spend monitor's automatic stop (src/lib/spendMonitor.ts)
export async function setMeteredServices(on: boolean, userId: number | null): Promise<void> {
  await ensureUserSchema();
  await query(
    `INSERT INTO racingcoach."SiteSettings" (key, value, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [KEY, String(on), userId]
  );
  cached = { at: Date.now(), on };
}
