// What a day's paid services cost, and what the spend monitor (src/lib/spendMonitor.ts) does about it. No I/O, so
// tests run it directly. docs/launch-readiness-audit-2026-11-07.md, F-07 and F-33.
//
// Counted: every AI call's recorded tokens at its model's list price (AI_MODEL_PRICES), and satellite tiles fetched
// from the provider. Not counted, as the site doesn't record them per call: text to speech (ElevenLabs, Google,
// OpenAI) and speech to text. The providers' own consoles have those, and their budget caps are the backstop.
import { AI_MODEL_PRICES, type AiModelPrice } from './aiModelPrices.ts';

// Esri's price per tile beyond its free allowance (an estimate; MAP_TILE_PRICE_PER_1000 overrides it)
export const DEFAULT_TILE_PRICE_PER_1000 = 0.15;
// Warn at, and stop paid services at, these many US dollars a day (UTC); SPEND_ALERT_DAILY_USD and
// SPEND_CEILING_DAILY_USD override them
export const DEFAULT_WARN_USD = 25;
export const DEFAULT_CEILING_USD = 100;

// A model the price list doesn't have counts at the dearest one's price, so it's never under-counted
const DEAREST: AiModelPrice = Object.values(AI_MODEL_PRICES).reduce((a, b) => (b.output > a.output ? b : a));

export type UsageByModel = { model: string | null; inputTokens: number; cachedInputTokens: number; outputTokens: number };

export function aiCostUsd(rows: UsageByModel[]): number {
  let total = 0;
  for (const row of rows) {
    if (!row.inputTokens && !row.outputTokens) continue;
    const price = (row.model && AI_MODEL_PRICES[row.model as keyof typeof AI_MODEL_PRICES]) || DEAREST;
    const uncached = Math.max(row.inputTokens - row.cachedInputTokens, 0);
    total += (uncached * price.input + row.cachedInputTokens * price.cachedInput + row.outputTokens * price.output) / 1_000_000;
  }
  return total;
}

export function tileCostUsd(tiles: number, pricePer1000 = DEFAULT_TILE_PRICE_PER_1000): number {
  return (tiles * pricePer1000) / 1000;
}

export type SpendLimits = { warnUsd: number; ceilingUsd: number };

// What's been done about today's spend, kept in SiteSettings so a restart doesn't email again
export type SpendState = { day: string; warned: boolean; stopped: boolean };

export type SpendAction = 'none' | 'warn' | 'stop';

// The next thing to do: warn once at the warning level, stop once at the ceiling, each once per UTC day
export function spendAction(spendUsd: number, limits: SpendLimits, state: SpendState, day: string): SpendAction {
  const today = state.day === day ? state : { day, warned: false, stopped: false };
  if (spendUsd >= limits.ceilingUsd && !today.stopped) return 'stop';
  if (spendUsd >= limits.warnUsd && !today.warned && !today.stopped) return 'warn';
  return 'none';
}

function amountFromEnv(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value.trim() !== '' && Number.isFinite(n) && n > 0 ? n : fallback;
}

export function spendLimitsFromEnv(env: Record<string, string | undefined> = process.env): SpendLimits {
  const warnUsd = amountFromEnv(env.SPEND_ALERT_DAILY_USD, DEFAULT_WARN_USD);
  const ceilingUsd = Math.max(warnUsd, amountFromEnv(env.SPEND_CEILING_DAILY_USD, DEFAULT_CEILING_USD));
  return { warnUsd, ceilingUsd };
}
