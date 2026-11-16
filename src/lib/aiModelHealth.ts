// Models a provider says don't exist. Providers retire models: one picked on the Admin page's AI Model Control then
// answers 404 to every call (OpenAI retired gpt-4.1-nano on 2026-11-11 and the Race Announcers failed for the rest
// of that evening's race). A model that answers so is left alone for RETRY_MS, and its feature's default model is
// used meanwhile (usableModel, from getAiModel in src/lib/aiModels.ts), so only the first call fails. After RETRY_MS
// it's tried once more, in case the provider's answer was passing. In this server's memory; no imports, so tests run
// it directly.

export const RETRY_MS = 10 * 60_000;

const goneUntil = new Map<string, number>();

// Whether a failed model call says the model itself doesn't exist: the provider's 404, which LangChain also marks
// MODEL_NOT_FOUND (@langchain/openai, also DeepSeek's, and @langchain/anthropic). Never a timeout, a rate limit or
// a refused request, which say nothing about the model
export function isModelGone(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { status?: unknown; lc_error_code?: unknown };
  return e.status === 404 || e.lc_error_code === 'MODEL_NOT_FOUND';
}

// Notes a failed call of model; true when it's the failure that marks the model gone (not already marked)
export function noteModelError(model: string, error: unknown, now = Date.now()): boolean {
  if (!isModelGone(error)) return false;
  const already = modelGone(model, now);
  goneUntil.set(model, now + RETRY_MS);
  return !already;
}

export function modelGone(model: string, now = Date.now()): boolean {
  const until = goneUntil.get(model);
  if (until === undefined) return false;
  if (until > now) return true;
  goneUntil.delete(model);
  return false;
}

// The model to call: picked, unless its provider says it doesn't exist and the fallback can stand in for it
export function usableModel<Model extends string>(picked: Model, fallback: Model, now = Date.now()): Model {
  return picked !== fallback && modelGone(picked, now) && !modelGone(fallback, now) ? fallback : picked;
}

// For tests
export function forgetModelErrors(): void {
  goneUntil.clear();
}
