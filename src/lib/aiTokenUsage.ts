import { AsyncLocalStorage } from 'node:async_hooks';
import type { CallbackHandlerMethods } from '@langchain/core/callbacks/base';
import type { LLMResult } from '@langchain/core/outputs';
import { query } from './db';

// Token counts for the Admin page's AI Usage report. aiRateLimit's track() runs a route's AI work with its
// racingcoach."AiUsage" row in context; chatModel (src/lib/aiModels.ts) then gives the model a callback that adds
// each model call's tokens to that row. An agent makes several model calls per AI call, so they add up. AI calls
// made outside track() (or without an OpenAI chat model, e.g. speech) record none.

const currentUsage = new AsyncLocalStorage<{ usageId: number }>();

// Runs work with the AiUsage row usageId in context
export function withAiUsage<T>(usageId: number, work: () => Promise<T>): Promise<T> {
  return currentUsage.run({ usageId }, work);
}

type UsageMetadata = {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: { cache_read?: number };
};

// The tokens of one model call: the message's usage_metadata, else the provider's own tokenUsage
function tokensOf(output: LLMResult) {
  let input = 0;
  let output_ = 0;
  let cached = 0;
  let found = false;
  for (const generation of output.generations.flat()) {
    const usage = (generation as { message?: { usage_metadata?: UsageMetadata } }).message?.usage_metadata;
    if (!usage) continue;
    found = true;
    input += usage.input_tokens ?? 0;
    output_ += usage.output_tokens ?? 0;
    cached += usage.input_token_details?.cache_read ?? 0;
  }
  if (!found) {
    const usage = output.llmOutput?.tokenUsage as { promptTokens?: number; completionTokens?: number } | undefined;
    input = usage?.promptTokens ?? 0;
    output_ = usage?.completionTokens ?? 0;
  }
  return { input, output: output_, cached };
}

// Callbacks for a chat model made now: they add every call's tokens (and the model's name) to the AiUsage row in
// context. None when there's no row. Recording never fails the AI call.
export function tokenUsageCallbacks(model: string): CallbackHandlerMethods[] {
  const usageId = currentUsage.getStore()?.usageId;
  if (usageId === undefined) return [];
  return [
    {
      handleLLMEnd: async (output: LLMResult) => {
        const tokens = tokensOf(output);
        try {
          await query(
            `UPDATE racingcoach."AiUsage"
             SET input_tokens = input_tokens + $2, cached_input_tokens = cached_input_tokens + $3,
                 output_tokens = output_tokens + $4, model_calls = model_calls + 1, model = $5
             WHERE id = $1`,
            [usageId, tokens.input, tokens.cached, tokens.output, model]
          );
        } catch (error) {
          console.error('Failed to record AI token usage:', error);
        }
      },
    },
  ];
}
