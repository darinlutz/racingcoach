// What one model call of each AI feature may cost: the most output tokens it may write, how long it may take, and how
// many times it's retried when the provider fails. chatModel (src/lib/aiModels.ts) builds every model with them, so a
// runaway answer, a hung connection or a provider outage can't multiply the bill (LangChain otherwise retries 6
// times, and the OpenAI SDK waits 10 minutes). The live features get no retry: their moment has passed by then.
// The caps are about twice the most output any call of the feature wrote in production ("AiUsage", 2026-11-07), so
// they stop a runaway answer without cutting off a real one. No imports, so tests run it directly.

export type AiCallLimit = { maxOutputTokens: number; timeoutMs: number; maxRetries: number };

export const AI_CALL_LIMITS = {
  debriefCoach: { maxOutputTokens: 10000, timeoutMs: 90_000, maxRetries: 1 },
  inCarCoachPlan: { maxOutputTokens: 3000, timeoutMs: 60_000, maxRetries: 1 },
  inCarCoachCallouts: { maxOutputTokens: 3000, timeoutMs: 30_000, maxRetries: 0 },
  lapSummary: { maxOutputTokens: 7000, timeoutMs: 60_000, maxRetries: 1 },
  multiLapSummary: { maxOutputTokens: 7000, timeoutMs: 60_000, maxRetries: 1 },
  stintSummary: { maxOutputTokens: 7000, timeoutMs: 60_000, maxRetries: 1 },
  raceTrends: { maxOutputTokens: 4000, timeoutMs: 90_000, maxRetries: 1 },
  raceCoaching: { maxOutputTokens: 4000, timeoutMs: 90_000, maxRetries: 1 },
  collectorLogReview: { maxOutputTokens: 2500, timeoutMs: 60_000, maxRetries: 0 },
  racecarAnalysis: { maxOutputTokens: 4000, timeoutMs: 60_000, maxRetries: 1 },
  raceAnnouncer: { maxOutputTokens: 7500, timeoutMs: 20_000, maxRetries: 0 },
  raceEngineer: { maxOutputTokens: 2500, timeoutMs: 25_000, maxRetries: 0 },
  setupEngineer: { maxOutputTokens: 2000, timeoutMs: 25_000, maxRetries: 0 },
} as const satisfies Record<string, AiCallLimit>;

// For a feature without its own row
export const DEFAULT_AI_CALL_LIMIT: AiCallLimit = { maxOutputTokens: 4000, timeoutMs: 60_000, maxRetries: 1 };

// Reasoning models (gpt-5 and later) count their hidden reasoning as output, so they get this many times the room
export const REASONING_OUTPUT_FACTOR = 4;

// Claude models think too; the output cap they were tuned with
export const CLAUDE_MAX_OUTPUT_TOKENS = 16_000;

export function aiCallLimit(feature: string): AiCallLimit {
  return (AI_CALL_LIMITS as Record<string, AiCallLimit>)[feature] ?? DEFAULT_AI_CALL_LIMIT;
}
