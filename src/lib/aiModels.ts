import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import { query } from '@/lib/db';
import {
  AI_FEATURE_VALUES,
  AI_FEATURES,
  AI_MODEL_CATEGORIES,
  type AiFeature,
  type AiModel,
  type AiModelCategory,
  isAiFeature,
  isAiModel,
  isAiModelCategory,
  isAiModelFor,
  isClaudeModel,
  SYSTEM_AI_MODEL_CATEGORY,
} from '@/lib/aiModelList';
import { currentAiModelCategory, tokenUsageCallbacks } from '@/lib/aiTokenUsage';
import { ensureUserSchema } from '@/lib/users';

export * from '@/lib/aiModelList';

// Which OpenAI or Anthropic model each AI feature uses for each category of caller (Admin, Gold, Silver, Bronze; see
// aiModelCategoryOf), chosen on the Admin page's AI Model Control section and kept in racingcoach."SiteSettings"
// (key ai_model:<category>:<feature>). A category with no row for a feature uses the feature's model from before
// models were set per category (key ai_model:<feature>), else its default (AI_FEATURES in src/lib/aiModelList.ts).

const settingKey = (category: AiModelCategory, feature: AiFeature) => `ai_model:${category}:${feature}`;

export type AiModelsByCategory = Record<AiModelCategory, Record<AiFeature, AiModel>>;

// Every category's model for every feature, saved or default
export async function getAiModels(): Promise<AiModelsByCategory> {
  await ensureUserSchema();
  const rows = await query<{ key: string; value: string }>(
    `SELECT key, value FROM racingcoach."SiteSettings" WHERE key LIKE 'ai_model:%'`
  );
  const shared = { ...AI_FEATURES } as Record<AiFeature, AiModel>;
  const saved: Partial<Record<AiModelCategory, Partial<Record<AiFeature, AiModel>>>> = {};
  for (const row of rows) {
    if (!isAiModel(row.value)) continue;
    const parts = row.key.split(':');
    if (parts.length === 2 && isAiFeature(parts[1]) && isAiModelFor(parts[1], row.value)) shared[parts[1]] = row.value;
    if (parts.length === 3 && isAiModelCategory(parts[1]) && isAiFeature(parts[2]) && isAiModelFor(parts[2], row.value)) {
      (saved[parts[1]] ??= {})[parts[2]] = row.value;
    }
  }
  return Object.fromEntries(
    AI_MODEL_CATEGORIES.map((category) => [
      category,
      Object.fromEntries(AI_FEATURE_VALUES.map((feature) => [feature, saved[category]?.[feature] ?? shared[feature]])),
    ])
  ) as AiModelsByCategory;
}

export async function setAiModel(category: AiModelCategory, feature: AiFeature, model: AiModel, userId: number): Promise<void> {
  await ensureUserSchema();
  await query(
    `INSERT INTO racingcoach."SiteSettings" (key, value, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [settingKey(category, feature), model, userId]
  );
}

// A feature's model for the caller in context (aiRateLimit's track(); the Admin category outside it). A failed
// read falls back to the default rather than failing the feature
export async function getAiModel(feature: AiFeature): Promise<AiModel> {
  const context = currentAiModelCategory();
  const category = isAiModelCategory(context) ? context : SYSTEM_AI_MODEL_CATEGORY;
  try {
    await ensureUserSchema();
    const rows = await query<{ key: string; value: string }>(
      'SELECT key, value FROM racingcoach."SiteSettings" WHERE key = ANY($1)',
      [[settingKey(category, feature), `ai_model:${feature}`]]
    );
    const own = rows.find((row) => row.key === settingKey(category, feature))?.value;
    const shared = rows.find((row) => row.key === `ai_model:${feature}`)?.value;
    return isAiModelFor(feature, own) ? own : isAiModelFor(feature, shared) ? shared : AI_FEATURES[feature];
  } catch (error) {
    console.error(`Failed to read the AI model for ${feature}:`, error);
    return AI_FEATURES[feature];
  }
}

// gpt-5 and later are reasoning models: OpenAI refuses any temperature but the default for them
const isReasoningModel = (model: string) => model.startsWith('gpt-5');

// LangChain's profiles say Claude models have no native structured output, so createAgent would force a tool call
// for responseFormat, which current Claude models refuse (400). They do support it (output_config.format), so say so
// and createAgent asks for JSON-schema output instead.
class ClaudeChatModel extends ChatAnthropic {
  get profile() {
    return { ...super.profile, structuredOutput: true };
  }
}

// The chat model for a feature. OpenAI reasoning models get low effort instead of the temperature, since their
// reasoning is billed as output tokens. They go through the Responses API, as Chat Completions refuses tools
// with a reasoning effort for newer models (e.g. gpt-5.5), so read replies with .text, not .content. Claude models
// (claude-*) always think and refuse a temperature, so they get low effort too. Inside an AI route's limit.track(),
// every call's tokens are added to its AiUsage row (src/lib/aiTokenUsage.ts).
export async function chatModel(feature: AiFeature, temperature: number): Promise<BaseChatModel> {
  const model = await getAiModel(feature);
  const callbacks = tokenUsageCallbacks(model);
  if (isClaudeModel(model)) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured');
    return new ClaudeChatModel({ model, maxTokens: 16000, outputConfig: { effort: 'low' }, callbacks });
  }
  return isReasoningModel(model)
    ? new ChatOpenAI({ model, reasoning: { effort: 'low' }, useResponsesApi: true, callbacks })
    : new ChatOpenAI({ model, temperature, callbacks });
}
