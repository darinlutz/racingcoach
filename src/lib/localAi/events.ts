import { randomUUID } from 'node:crypto';
import type { CallbackHandlerMethods } from '@langchain/core/callbacks/base';
import type { LLMResult } from '@langchain/core/outputs';
import { aiModelProvider } from '@/lib/aiModelList';
import { AI_MODEL_PRICES } from '@/lib/aiModelPrices';
import type { InferenceAttempt } from './routedModel';
import type { RouteReason } from './routing';
import { insertInferenceEvent, type InferenceEventRow } from './store';

// Every model call is recorded here, one row per attempt (racingcoach."AiInferenceEvents", src/lib/localAi/store.ts),
// for the Admin page's AI Inference Monitoring. It's done where chatModel (src/lib/aiModels.ts) builds the model, so
// every agent's every model call is counted (an agent's tool loop makes several), whichever feature it is. A model
// routed between local and cloud records its own attempts (routedModel.ts); a plain cloud model records through
// LangChain's callbacks below. Recording never fails the call.

export type EventContext = { feature: string; category: string | null; source: 'app' | 'testConsole' };

// The cloud list price of a call's tokens; 0 for a local model, null for a model without a price
export function attemptCost(provider: string, model: string, input: number | null, cached: number | null, output: number | null): number | null {
  if (provider === 'Local') return 0;
  const price = AI_MODEL_PRICES[model as keyof typeof AI_MODEL_PRICES];
  if (!price || (input === null && output === null)) return null;
  const cachedTokens = cached ?? 0;
  const uncached = Math.max((input ?? 0) - cachedTokens, 0);
  return (uncached * price.input + cachedTokens * price.cachedInput + (output ?? 0) * price.output) / 1_000_000;
}

export function recordAttempt(context: EventContext, attempt: InferenceAttempt): void {
  const row: InferenceEventRow = {
    ...attempt,
    ...context,
    costUsd: attemptCost(attempt.provider, attempt.requestedModel, attempt.inputTokens, attempt.cachedInputTokens, attempt.outputTokens),
  };
  void insertInferenceEvent(row);
}

type UsageMetadata = { input_tokens?: number; output_tokens?: number; input_token_details?: { cache_read?: number } };

function resultDetails(output: LLMResult) {
  let input: number | null = null;
  let outputTokens: number | null = null;
  let cached: number | null = null;
  let actual: string | null = null;
  for (const generation of output.generations.flat()) {
    const message = (generation as { message?: { usage_metadata?: UsageMetadata; response_metadata?: Record<string, unknown> } }).message;
    const usage = message?.usage_metadata;
    if (usage) {
      input = (input ?? 0) + (usage.input_tokens ?? 0);
      outputTokens = (outputTokens ?? 0) + (usage.output_tokens ?? 0);
      cached = (cached ?? 0) + (usage.input_token_details?.cache_read ?? 0);
    }
    const name = message?.response_metadata?.model_name ?? message?.response_metadata?.model;
    if (!actual && typeof name === 'string') actual = name.slice(0, 200);
  }
  if (input === null) {
    const usage = output.llmOutput?.tokenUsage as { promptTokens?: number; completionTokens?: number } | undefined;
    if (usage) {
      input = usage.promptTokens ?? null;
      outputTokens = usage.completionTokens ?? null;
    }
  }
  return { input, outputTokens, cached, actual };
}

// Callbacks for a plain cloud model: a row for each of its calls, completed or failed
export function cloudEventCallbacks(context: EventContext, model: string, routeReason: RouteReason): CallbackHandlerMethods[] {
  const starts = new Map<string, { at: Date; started: number }>();
  const provider = aiModelProvider(model);
  const base = (runId: string) => {
    const start = starts.get(runId);
    starts.delete(runId);
    return {
      id: randomUUID(),
      logicalRequestId: randomUUID(),
      attempt: 1,
      provider,
      serverId: null,
      requestedModel: model,
      routeReason,
      isFallback: false,
      startedAt: start?.at ?? new Date(),
      latencyMs: start ? Math.round(performance.now() - start.started) : 0,
    };
  };
  return [
    {
      handleChatModelStart: (_llm, _messages, runId) => {
        starts.set(runId, { at: new Date(), started: performance.now() });
      },
      handleLLMEnd: (output: LLMResult, runId: string) => {
        const details = resultDetails(output);
        recordAttempt(context, {
          ...base(runId),
          actualModel: details.actual,
          status: 'completed',
          errorKind: null,
          inputTokens: details.input,
          cachedInputTokens: details.cached,
          outputTokens: details.outputTokens,
        });
      },
      handleLLMError: (error: unknown, runId: string) => {
        const e = error as { name?: string; message?: string; status?: number };
        const name = String(e?.name ?? '');
        const timedOut = name.includes('Timeout') || /timed? ?out/i.test(String(e?.message ?? ''));
        const aborted = !timedOut && (name === 'AbortError' || /abort/i.test(String(e?.message ?? '')));
        recordAttempt(context, {
          ...base(runId),
          actualModel: null,
          status: timedOut ? 'timedOut' : aborted ? 'canceled' : 'failed',
          errorKind: timedOut ? 'timeout' : aborted ? 'aborted' : typeof e?.status === 'number' ? `http${e.status}` : 'error',
          inputTokens: null,
          cachedInputTokens: null,
          outputTokens: null,
        });
      },
    },
  ];
}
