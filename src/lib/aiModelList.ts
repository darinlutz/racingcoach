// The AI features and the OpenAI models the Admin page's AI Model Control section offers. No imports, so the
// section's client component can use it; src/lib/aiModels.ts reads and saves the choices.

// Each feature's default model: the cheaper gpt-4o-mini where the job is short or structured, gpt-4o where it
// reasons over many tool results
export const AI_FEATURES = {
  debriefCoach: 'gpt-4o',
  inCarCoachPlan: 'gpt-4o-mini',
  inCarCoachCallouts: 'gpt-4o-mini',
  lapSummary: 'gpt-4o-mini',
  multiLapSummary: 'gpt-4o-mini',
  stintSummary: 'gpt-4o-mini',
  raceTrends: 'gpt-4o',
  raceCoaching: 'gpt-4o',
  collectorLogReview: 'gpt-4o',
} as const satisfies Record<string, AiModel>;

export type AiFeature = keyof typeof AI_FEATURES;
export const AI_FEATURE_VALUES = Object.keys(AI_FEATURES) as AiFeature[];

// The models the Admin page offers; only these can be saved. Add new OpenAI or Anthropic (claude-*) chat models here.
// Not claude-haiku-5-5: given tools and a response format together, it often answers without calling the tools.
export const AI_MODELS = [
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-4.1-nano',
  'gpt-4.1-mini',
  'gpt-4.1',
  'gpt-5-nano',
  'gpt-5-mini',
  'gpt-5',
  'gpt-5.1',
  'gpt-5.2',
  'gpt-5.4',
  'gpt-5.5',
  'claude-sonnet-5-5',
  'claude-opus-5-5',
] as const;

export type AiModel = (typeof AI_MODELS)[number];

export const isClaudeModel = (model: string) => model.startsWith('claude-');

// Features that can't use Anthropic models: the In-Car AI Coach stays on OpenAI, alongside its OpenAI voice
const OPENAI_ONLY_FEATURES: readonly AiFeature[] = ['inCarCoachPlan', 'inCarCoachCallouts'];

// The models the Admin page offers for a feature
export function aiModelsFor(feature: AiFeature): readonly AiModel[] {
  return OPENAI_ONLY_FEATURES.includes(feature) ? AI_MODELS.filter((model) => !isClaudeModel(model)) : AI_MODELS;
}

export function isAiModelFor(feature: AiFeature, value: unknown): value is AiModel {
  return isAiModel(value) && aiModelsFor(feature).includes(value);
}

// Each feature's model is set separately for each category of caller: the Admin role, else their membership level.
// Coaches and Users go by their level; visitors who aren't signed in count as Bronze.
export const AI_MODEL_CATEGORIES = ['Admin', 'Gold', 'Silver', 'Bronze'] as const;
export type AiModelCategory = (typeof AI_MODEL_CATEGORIES)[number];

// AI calls made for no user (e.g. the collector log review) use the Admin category's models
export const SYSTEM_AI_MODEL_CATEGORY: AiModelCategory = 'Admin';

// role 'Admin' is ROLES.admin (src/lib/roles.ts), written out so this file keeps no imports
export function aiModelCategoryOf(user: { role: string; membershipLevel: string } | null): AiModelCategory {
  if (!user) return 'Bronze';
  if (user.role === 'Admin') return 'Admin';
  return user.membershipLevel === 'Gold' || user.membershipLevel === 'Silver' ? user.membershipLevel : 'Bronze';
}

export function isAiModelCategory(value: unknown): value is AiModelCategory {
  return typeof value === 'string' && (AI_MODEL_CATEGORIES as readonly string[]).includes(value);
}

export function isAiFeature(value: unknown): value is AiFeature {
  return typeof value === 'string' && Object.hasOwn(AI_FEATURES, value);
}

export function isAiModel(value: unknown): value is AiModel {
  return typeof value === 'string' && (AI_MODELS as readonly string[]).includes(value);
}
