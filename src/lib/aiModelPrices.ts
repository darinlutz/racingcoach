import { AI_MODELS, type AiModel } from './aiModelList';

// Each offered model's list price in US dollars per million tokens, for the Admin page's AI Model Costs table
// (src/components/AiModelCostTable.tsx). Estimates from the providers' published prices as of October 2026:
// OpenAI's and Anthropic's standard tiers; DeepSeek's V4 prices for deepseek-flash and deepseek-v4-pro. A new
// model in AI_MODELS needs its price here too.
export type AiModelPrice = { input: number; cachedInput: number; output: number };

export const AI_MODEL_PRICES: Record<AiModel, AiModelPrice> = {
  'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 },
  'gpt-4o': { input: 2.5, cachedInput: 1.25, output: 10 },
  'gpt-4.1-nano': { input: 0.1, cachedInput: 0.025, output: 0.4 },
  'gpt-4.1-mini': { input: 0.4, cachedInput: 0.1, output: 1.6 },
  'gpt-4.1': { input: 2, cachedInput: 0.5, output: 8 },
  'gpt-5-nano': { input: 0.05, cachedInput: 0.005, output: 0.4 },
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'gpt-5': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5.1': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5.2': { input: 1.75, cachedInput: 0.175, output: 14 },
  'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.5 },
  'gpt-5.4': { input: 2.5, cachedInput: 0.25, output: 15 },
  'gpt-5.5': { input: 5, cachedInput: 0.5, output: 30 },
  'claude-sonnet-5-5': { input: 2, cachedInput: 0.2, output: 10 },
  'claude-opus-5-5': { input: 4, cachedInput: 0.2, output: 20 },
  'deepseek-flash': { input: 0.14, cachedInput: 0.028, output: 0.28 },
  'deepseek-v4-pro': { input: 1.74, cachedInput: 0.145, output: 3.48 },
};

// The tokens of a typical AI call (all its model calls together; input includes the cached part)
export type CallTokens = { input: number; cachedInput: number; output: number };

// Used until the site has logged enough calls with tokens to measure its own
export const DEFAULT_CALL_TOKENS: CallTokens = { input: 6000, cachedInput: 0, output: 600 };

// What 100 AI calls of that size cost on a model, in US dollars
export function costPer100Calls(model: AiModel, tokens: CallTokens): number {
  const price = AI_MODEL_PRICES[model];
  const uncached = Math.max(tokens.input - tokens.cachedInput, 0);
  return (100 * (uncached * price.input + tokens.cachedInput * price.cachedInput + tokens.output * price.output)) / 1_000_000;
}

// Every offered model with its price and cost per 100 calls, cheapest first
export function modelsByCost(tokens: CallTokens) {
  return AI_MODELS.map((model) => ({ model, price: AI_MODEL_PRICES[model], cost: costPer100Calls(model, tokens) })).sort(
    (a, b) => a.cost - b.cost
  );
}
