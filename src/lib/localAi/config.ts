// Local AI Server Mode (docs/local-ai.md): the settings the Admin page's Local AI Server Mode section edits, the local
// models offered, and which AI features may run on a local model by default. Pure: only aiModelList.ts (itself
// import-free), so the section's client component and `node --test` can use it.

import { AI_FEATURE_VALUES, type AiFeature } from '../aiModelList.ts';

// cloudOnly: nothing goes to a local server (the default, until the Mac is set up and tested). automatic: features
// mapped to a local model go to a healthy local server with room, else to their cloud model. development: like
// cloudOnly for new requests, so the Mac is free for development; requests already running there finish.
export const LOCAL_AI_MODES = ['cloudOnly', 'automatic', 'development'] as const;
export type LocalAiMode = (typeof LOCAL_AI_MODES)[number];
export const isLocalAiMode = (value: unknown): value is LocalAiMode =>
  typeof value === 'string' && (LOCAL_AI_MODES as readonly string[]).includes(value);

// The open-weight models a local server may run, by their Ollama tags. Checked against the Ollama library and the
// models' cards (2026-11): both Apache 2.0, both with tool calling. contextTokens is what Ollama serves, not the
// model's maximum (131,072 for gpt-oss, 40,960 for Qwen3): Ollama's default is only 4,096 and it cuts longer prompts
// silently, so docs/local-ai.md sets OLLAMA_CONTEXT_LENGTH=32768 and the router keeps a request's estimated input
// under contextShare of that. Raise both together. requestExtras are added to every request body
// (gpt-oss takes a reasoning effort; low keeps it quick, as the cloud reasoning models are run).
export type LocalModelInfo = {
  label: string;
  contextTokens: number;
  license: string;
  approxMemoryGb: number;
  requestExtras: Record<string, unknown>;
};

export const LOCAL_MODELS = {
  'gpt-oss:20b': {
    label: 'GPT-OSS 20B',
    contextTokens: 32_768,
    license: 'Apache-2.0',
    approxMemoryGb: 14,
    requestExtras: { reasoning_effort: 'low' },
  },
  'qwen3:8b': {
    label: 'Qwen3 8B',
    contextTokens: 32_768,
    license: 'Apache-2.0',
    approxMemoryGb: 5.2,
    requestExtras: {},
  },
} as const satisfies Record<string, LocalModelInfo>;

export type LocalModelId = keyof typeof LOCAL_MODELS;
export const LOCAL_MODEL_IDS = Object.keys(LOCAL_MODELS) as LocalModelId[];
export const isLocalModelId = (value: unknown): value is LocalModelId =>
  typeof value === 'string' && Object.hasOwn(LOCAL_MODELS, value);

// How events name a local model's provider (cloud ones are OpenAI, Anthropic or DeepSeek, aiModelProvider)
export const LOCAL_PROVIDER = 'Local';

// Which features may run locally, and on which model, until the Admin page changes it. Plain text summaries and the
// Racecar Analysis answer go to GPT-OSS 20B. Kept on the cloud: the Debrief Coach, Race Trends and Race Coaching
// (many tool calls over a big context), and the live features (the In-Car AI Coach, Race Announcers, Race Engineer,
// Setup Engineer), whose moment passes in seconds. None of this applies until the mode is Automatic.
export const DEFAULT_FEATURE_MODELS: Partial<Record<AiFeature, LocalModelId>> = {
  lapSummary: 'gpt-oss:20b',
  multiLapSummary: 'gpt-oss:20b',
  stintSummary: 'gpt-oss:20b',
  racecarAnalysis: 'gpt-oss:20b',
};

export type LocalAiSettings = {
  mode: LocalAiMode;
  // Each feature's local model, or null for cloud only. A feature missing here takes its DEFAULT_FEATURE_MODELS entry
  featureModels: Record<AiFeature, LocalModelId | null>;
  // A local attempt gets at most this long (and at most the feature's own timeout) before the cloud takes over
  localTimeoutMs: number;
  // Consecutive local failures that open a server's circuit, and how long it stays open before one trial request
  circuitFailures: number;
  circuitOpenMs: number;
  // A request's estimated input may use this share of the local model's context, else it goes to the cloud
  contextShare: number;
};

export const LOCAL_AI_LIMITS = {
  localTimeoutMs: { min: 5_000, max: 300_000 },
  circuitFailures: { min: 1, max: 20 },
  circuitOpenMs: { min: 10_000, max: 3_600_000 },
  contextShare: { min: 0.1, max: 0.95 },
  maxConcurrency: { min: 1, max: 16 },
} as const;

// No heartbeat for this long and a server counts as offline (server time, never the Mac's)
export const HEARTBEAT_STALE_MS = 30_000;
// How often the Mac's agent sends one
export const HEARTBEAT_INTERVAL_MS = 10_000;

export function defaultFeatureModels(): Record<AiFeature, LocalModelId | null> {
  return Object.fromEntries(AI_FEATURE_VALUES.map((feature) => [feature, DEFAULT_FEATURE_MODELS[feature] ?? null])) as Record<
    AiFeature,
    LocalModelId | null
  >;
}

export function defaultLocalAiSettings(): LocalAiSettings {
  return {
    mode: 'cloudOnly',
    featureModels: defaultFeatureModels(),
    localTimeoutMs: 60_000,
    circuitFailures: 3,
    circuitOpenMs: 60_000,
    contextShare: 0.75,
  };
}

const clamp = (value: unknown, limits: { min: number; max: number }, fallback: number) => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.min(limits.max, Math.max(limits.min, n)) : fallback;
};

// Saved settings (JSON from "SiteSettings", or an Admin's PUT) made whole and safe: anything missing or wrong takes
// its default, so a bad value can never turn local routing on. The mode defaults to cloudOnly.
export function parseLocalAiSettings(raw: unknown): LocalAiSettings {
  const base = defaultLocalAiSettings();
  if (!raw || typeof raw !== 'object') return base;
  const value = raw as Record<string, unknown>;
  const saved = value.featureModels && typeof value.featureModels === 'object' ? (value.featureModels as Record<string, unknown>) : {};
  const featureModels = { ...base.featureModels };
  for (const feature of AI_FEATURE_VALUES) {
    if (!Object.hasOwn(saved, feature)) continue;
    const model = saved[feature];
    if (model === null) featureModels[feature] = null;
    else if (isLocalModelId(model)) featureModels[feature] = model;
  }
  return {
    mode: isLocalAiMode(value.mode) ? value.mode : base.mode,
    featureModels,
    localTimeoutMs: Math.round(clamp(value.localTimeoutMs, LOCAL_AI_LIMITS.localTimeoutMs, base.localTimeoutMs)),
    circuitFailures: Math.round(clamp(value.circuitFailures, LOCAL_AI_LIMITS.circuitFailures, base.circuitFailures)),
    circuitOpenMs: Math.round(clamp(value.circuitOpenMs, LOCAL_AI_LIMITS.circuitOpenMs, base.circuitOpenMs)),
    contextShare: clamp(value.contextShare, LOCAL_AI_LIMITS.contextShare, base.contextShare),
  };
}

// A rough token count for a request (about 4 characters a token, rounded up), to keep it inside a local model's
// context. It over-counts JSON a little, which errs toward the cloud.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// A server ID: lowercase letters, digits and dashes, as in the heartbeat and the gateway's .env
export const SERVER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
