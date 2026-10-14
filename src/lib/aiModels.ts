import { ChatOpenAI } from '@langchain/openai';
import { query } from '@/lib/db';
import { AI_FEATURES, type AiFeature, type AiModel, isAiFeature, isAiModel } from '@/lib/aiModelList';
import { ensureUserSchema } from '@/lib/users';

export * from '@/lib/aiModelList';

// Which OpenAI model each AI feature uses, chosen on the Admin page's AI Model Control section and kept in
// racingcoach."SiteSettings" (key ai_model:<feature>). A feature with no row uses its default (AI_FEATURES in
// src/lib/aiModelList.ts).

const settingKey = (feature: AiFeature) => `ai_model:${feature}`;

// Every feature's model, saved or default
export async function getAiModels(): Promise<Record<AiFeature, AiModel>> {
  await ensureUserSchema();
  const rows = await query<{ key: string; value: string }>(
    `SELECT key, value FROM racingcoach."SiteSettings" WHERE key LIKE 'ai_model:%'`
  );
  const models = { ...AI_FEATURES } as Record<AiFeature, AiModel>;
  for (const row of rows) {
    const feature = row.key.slice('ai_model:'.length);
    if (isAiFeature(feature) && isAiModel(row.value)) models[feature] = row.value;
  }
  return models;
}

export async function setAiModel(feature: AiFeature, model: AiModel, userId: number): Promise<void> {
  await ensureUserSchema();
  await query(
    `INSERT INTO racingcoach."SiteSettings" (key, value, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [settingKey(feature), model, userId]
  );
}

// A feature's model; a failed read falls back to the default rather than failing the feature
export async function getAiModel(feature: AiFeature): Promise<AiModel> {
  try {
    await ensureUserSchema();
    const rows = await query<{ value: string }>('SELECT value FROM racingcoach."SiteSettings" WHERE key = $1', [settingKey(feature)]);
    return isAiModel(rows[0]?.value) ? rows[0].value : AI_FEATURES[feature];
  } catch (error) {
    console.error(`Failed to read the AI model for ${feature}:`, error);
    return AI_FEATURES[feature];
  }
}

// gpt-5 and later are reasoning models: OpenAI refuses any temperature but the default for them
const isReasoningModel = (model: string) => model.startsWith('gpt-5');

// The chat model for a feature. Reasoning models get low effort instead of the temperature, since their
// reasoning is billed as output tokens.
export async function chatModel(feature: AiFeature, temperature: number): Promise<ChatOpenAI> {
  const model = await getAiModel(feature);
  return isReasoningModel(model)
    ? new ChatOpenAI({ model, reasoning: { effort: 'low' } })
    : new ChatOpenAI({ model, temperature });
}
