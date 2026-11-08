import { query } from './db';
import { tileFetchesToday } from './mapTileBudget';
import { meteredServicesOn, setMeteredServices } from './meteredServices';
import { emailOwner } from './ownerNotifications';
import {
  aiCostUsd,
  DEFAULT_TILE_PRICE_PER_1000,
  spendAction,
  spendLimitsFromEnv,
  tileCostUsd,
  type SpendLimits,
  type SpendState,
  type UsageByModel,
} from './spendRules';
import { ensureUserSchema } from './users';

// Every 10 minutes: today's (UTC) cost of paid services so far (spendRules.ts), an email to the site owner once it
// passes the warning level, and at the ceiling the emergency stop (src/lib/meteredServices.ts) switched off
// automatically, with an email; the owner switches it back on in Admin > Site Settings. Each happens once a day,
// remembered in "SiteSettings" (key spend_monitor_state) across restarts.

const CHECK_MS = 10 * 60_000;
const STATE_KEY = 'spend_monitor_state';

export type SpendToday = { day: string; aiUsd: number; tilesUsd: number; totalUsd: number; limits: SpendLimits };

const utcDay = (now = new Date()) => now.toISOString().slice(0, 10);

export async function readSpendToday(): Promise<SpendToday> {
  await ensureUserSchema();
  const rows = await query<{ model: string | null; input: string; cached: string; output: string }>(
    `SELECT model, sum(input_tokens) AS input, sum(cached_input_tokens) AS cached, sum(output_tokens) AS output
     FROM racingcoach."AiUsage" WHERE occurred_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
     GROUP BY model`
  );
  const usage: UsageByModel[] = rows.map((r) => ({
    model: r.model,
    inputTokens: Number(r.input),
    cachedInputTokens: Number(r.cached),
    outputTokens: Number(r.output),
  }));
  const aiUsd = aiCostUsd(usage);
  const tilePrice = Number(process.env.MAP_TILE_PRICE_PER_1000) || DEFAULT_TILE_PRICE_PER_1000;
  const tilesUsd = tileCostUsd(tileFetchesToday(), tilePrice);
  return { day: utcDay(), aiUsd, tilesUsd, totalUsd: aiUsd + tilesUsd, limits: spendLimitsFromEnv() };
}

async function readState(): Promise<SpendState> {
  const [row] = await query<{ value: string }>('SELECT value FROM racingcoach."SiteSettings" WHERE key = $1', [STATE_KEY]);
  try {
    const parsed = row ? JSON.parse(row.value) : null;
    if (parsed && typeof parsed.day === 'string') return { day: parsed.day, warned: !!parsed.warned, stopped: !!parsed.stopped };
  } catch {
    // A broken value starts the day over
  }
  return { day: '', warned: false, stopped: false };
}

async function saveState(state: SpendState): Promise<void> {
  await query(
    `INSERT INTO racingcoach."SiteSettings" (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [STATE_KEY, JSON.stringify(state)]
  );
}

const usd = (n: number) => `$${n.toFixed(2)}`;

// One check; exported for tests and the Admin page
export async function checkSpend(): Promise<{ spend: SpendToday; action: ReturnType<typeof spendAction> }> {
  const spend = await readSpendToday();
  const saved = await readState();
  const state = saved.day === spend.day ? saved : { day: spend.day, warned: false, stopped: false };
  const action = spendAction(spend.totalUsd, spend.limits, state, spend.day);
  const site = process.env.SITE_URL?.trim().replace(/\/+$/, '') ?? '';
  const breakdown = `AI models ${usd(spend.aiUsd)}, satellite tiles ${usd(spend.tilesUsd)} (speech and transcription aren't counted here: see the providers' consoles).`;

  if (action === 'warn') {
    await emailOwner(
      `RacingCoach.app: paid services passed ${usd(spend.limits.warnUsd)} today`,
      `Today's (UTC) spend so far is ${usd(spend.totalUsd)}: ${breakdown}\n\nAt ${usd(spend.limits.ceilingUsd)} paid AI, speech and map services switch off automatically.\n\nUsage by user and feature: ${site}/admin#monitoring`
    );
    await saveState({ ...state, warned: true });
  } else if (action === 'stop') {
    const wasOn = await meteredServicesOn();
    await setMeteredServices(false, null);
    console.warn(`Spend monitor: ${usd(spend.totalUsd)} today passed the ${usd(spend.limits.ceilingUsd)} ceiling; paid services stopped`);
    await emailOwner(
      `RacingCoach.app: paid services STOPPED at ${usd(spend.totalUsd)} today`,
      `Today's (UTC) spend reached ${usd(spend.totalUsd)}, past the ${usd(spend.limits.ceilingUsd)} ceiling: ${breakdown}\n\n${
        wasOn ? 'Paid AI, speech and map services are now switched off for everyone.' : 'Paid services were already switched off.'
      } Find out what used them (usage by user and feature: ${site}/admin#monitoring), then switch "Paid AI, speech and map services" back on in Admin > Site Settings. It won't be switched off again today.`
    );
    await saveState({ ...state, warned: true, stopped: true });
  }
  return { spend, action };
}

const g = globalThis as typeof globalThis & { spendMonitorTimer?: NodeJS.Timeout };

export function startSpendMonitor(): void {
  if (g.spendMonitorTimer || !process.env.DATABASE_URL) return;
  const tick = () =>
    checkSpend().catch((error) => console.warn('Spend monitor:', error instanceof Error ? error.message : error));
  g.spendMonitorTimer = setInterval(tick, CHECK_MS);
  g.spendMonitorTimer.unref();
  setTimeout(tick, 60_000).unref();
}
