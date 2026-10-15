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

// The models the Admin page offers; only these can be saved. Add new OpenAI chat models here.
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
] as const;

export type AiModel = (typeof AI_MODELS)[number];

export function isAiFeature(value: unknown): value is AiFeature {
  return typeof value === 'string' && Object.hasOwn(AI_FEATURES, value);
}

export function isAiModel(value: unknown): value is AiModel {
  return typeof value === 'string' && (AI_MODELS as readonly string[]).includes(value);
}
