// AI Lab rules (docs/AI_LAB_SETUP.md), shared by the website and the Mac's gateway (local-ai/lab.ts imports this
// file, so it has no imports at all). Model names, parameters and their ranges, what each provider accepts, the
// AI Lab settings, and the status colors. Nothing here reaches production routing: the lab's models and parameters
// are never read by chatModel() or the Local AI router.

// ---- Error pages ----

// A short, plain description of an answer that wasn't JSON (Cloudflare's error pages when the tunnel or the Mac is
// down, a proxy's HTML): the HTTP status and the page's title, never its markup or scripts.
export function errorPageSummary(status: number, text: string): string {
  const head = `HTTP ${status}`;
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1];
  const plain = title ?? (/<[a-z!/]/i.test(text) ? '' : text);
  const clean = plain
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' })[e] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return clean ? `${head}: ${clean}` : head;
}

// ---- Names and IDs ----

// An Ollama model name: [host/][namespace/]model[:tag], e.g. qwen3:8b, library/gemma3:27b, hf.co/user/repo:Q4_K_M.
// Letters, digits and . _ - / : only, no "..", no leading or trailing slash, no spaces: so it can't become a path,
// a URL or an option on the Mac.
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._\-/:]{0,199}$/;

export function validModelName(value: unknown): value is string {
  if (typeof value !== 'string' || !MODEL_NAME.test(value)) return false;
  if (value.includes('..') || value.includes('//') || value.endsWith('/') || value.endsWith(':')) return false;
  return (value.match(/:/g) ?? []).length <= 1;
}

// A name pulled from Ollama's own registry (registry.ollama.ai): no host part. Anything else (hf.co/...) is pulled
// from that host by Ollama itself, and its size can't be read beforehand.
export function registryName(name: string): { namespace: string; model: string; tag: string } | null {
  if (!validModelName(name)) return null;
  const [path, tag = 'latest'] = name.split(':');
  const parts = path.split('/');
  if (parts.length > 2 || parts.some((p) => p.includes('.'))) return null;
  const [namespace, model] = parts.length === 2 ? parts : ['library', parts[0]];
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(model) || !/^[a-z0-9][a-z0-9._-]*$/i.test(namespace) || !/^[A-Za-z0-9._-]+$/.test(tag)) return null;
  return { namespace, model, tag };
}

// Open WebUI's IDs: memories and knowledge bases are UUIDs; a model configuration's ID is what the Admin typed
export const validWebuiId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(value);
export const validConfigId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{1,63}$/.test(value);

// ---- Sizes ----

export const LAB_TEXT_LIMITS = {
  prompt: 20_000,
  system: 8_000,
  memory: 4_000,
  name: 120,
  description: 1_000,
} as const;

// The heaviest a lab request may be, whatever the Mac's own caps are (the gateway applies the lower of the two)
export const LAB_HARD_LIMITS = { numCtx: 131_072, maxTokens: 8_192 } as const;

// ---- Parameters ----

export const LAB_PARAMS = ['temperature', 'topP', 'topK', 'numCtx', 'maxTokens', 'repeatPenalty', 'seed'] as const;
export type LabParam = (typeof LAB_PARAMS)[number];
export type LabParams = Partial<Record<LabParam, number>>;

export const PARAM_RANGES: Record<LabParam, { min: number; max: number; step: number; integer: boolean }> = {
  temperature: { min: 0, max: 2, step: 0.05, integer: false },
  topP: { min: 0, max: 1, step: 0.01, integer: false },
  topK: { min: 1, max: 500, step: 1, integer: true },
  numCtx: { min: 512, max: LAB_HARD_LIMITS.numCtx, step: 512, integer: true },
  maxTokens: { min: 1, max: LAB_HARD_LIMITS.maxTokens, step: 1, integer: true },
  repeatPenalty: { min: 0.5, max: 2, step: 0.01, integer: false },
  seed: { min: 0, max: 2_147_483_647, step: 1, integer: true },
};

export type LabProvider = 'Local' | 'OpenAI' | 'Anthropic' | 'DeepSeek';

// What each provider takes. Ollama: everything. OpenAI's gpt-5 models are reasoning models that refuse any
// temperature or top_p; the others take temperature, top_p and a seed. Current Claude models refuse a temperature
// (see aiModels.ts), so only the output cap. DeepSeek (OpenAI-compatible, thinking off): temperature and top_p.
// Context length is the provider's own for every cloud model, so it's local only; so are top_k and repeat penalty.
export function supportedParams(provider: LabProvider, model: string): LabParam[] {
  if (provider === 'Local') return [...LAB_PARAMS];
  if (provider === 'OpenAI') return model.startsWith('gpt-5') ? ['maxTokens'] : ['temperature', 'topP', 'maxTokens', 'seed'];
  if (provider === 'DeepSeek') return ['temperature', 'topP', 'maxTokens'];
  return ['maxTokens'];
}

// Only the parameters given, supported and in range (clamped; integers rounded). Anything else is dropped, so a
// parameter is never sent to a provider that would refuse it.
export function cleanParams(raw: unknown, supported: readonly LabParam[]): LabParams {
  const out: LabParams = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of supported) {
    const value = (raw as Record<string, unknown>)[key];
    if (value === null || value === undefined || value === '') continue;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) continue;
    const range = PARAM_RANGES[key];
    const clamped = Math.min(range.max, Math.max(range.min, n));
    out[key] = range.integer ? Math.round(clamped) : clamped;
  }
  return out;
}

// Ollama's names for them (its /api/chat options)
export function ollamaOptions(params: LabParams): Record<string, number> {
  const names: Record<LabParam, string> = {
    temperature: 'temperature',
    topP: 'top_p',
    topK: 'top_k',
    numCtx: 'num_ctx',
    maxTokens: 'num_predict',
    repeatPenalty: 'repeat_penalty',
    seed: 'seed',
  };
  const out: Record<string, number> = {};
  for (const key of LAB_PARAMS) if (params[key] !== undefined) out[names[key]] = params[key] as number;
  return out;
}

// ---- Measurements ----

// Output tokens a second over the generation itself (after the first token), or null when it can't be measured
export function tokensPerSecond(outputTokens: number | null, generationMs: number | null): number | null {
  if (!outputTokens || !generationMs || generationMs <= 0) return null;
  return Math.round((outputTokens / (generationMs / 1000)) * 10) / 10;
}

// The most a cloud call could cost: its estimated input plus every output token it may write, at list price
export function worstCaseCostUsd(price: { input: number; output: number }, inputTokens: number, maxTokens: number): number {
  return (inputTokens * price.input + maxTokens * price.output) / 1_000_000;
}

export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

// ---- Status ----

// green: online and healthy; yellow: degraded or starting; red: offline or unreachable; gray: not configured
export type StatusColor = 'green' | 'yellow' | 'red' | 'gray';

export function serviceColor(service: { configured: boolean; ok: boolean | null; degraded?: boolean }): StatusColor {
  if (!service.configured) return 'gray';
  if (service.ok === null) return 'yellow';
  if (!service.ok) return 'red';
  return service.degraded ? 'yellow' : 'green';
}

// ---- Settings ("SiteSettings" key ai_lab) ----

export type AiLabSettings = {
  // Where Launch Open WebUI goes: its Cloudflare hostname (behind Cloudflare Access), https with no path
  openWebuiUrl: string | null;
  // The most the playground's cloud models may cost a UTC day, in US dollars (0 turns them off)
  dailyCloudBudgetUsd: number;
  // The playground's default local model, and each model's own default parameters. The lab only: never production
  defaultModel: string | null;
  modelParams: Record<string, LabParams>;
};

export const DEFAULT_AI_LAB_SETTINGS: AiLabSettings = {
  openWebuiUrl: null,
  dailyCloudBudgetUsd: 2,
  defaultModel: null,
  modelParams: {},
};

export const MAX_DAILY_CLOUD_BUDGET_USD = 100;

export function validOpenWebuiUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 200) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== '/' && url.pathname !== '') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function parseAiLabSettings(raw: unknown): AiLabSettings {
  const base = { ...DEFAULT_AI_LAB_SETTINGS, modelParams: {} as Record<string, LabParams> };
  if (!raw || typeof raw !== 'object') return base;
  const value = raw as Record<string, unknown>;
  const budget = Number(value.dailyCloudBudgetUsd);
  const params: Record<string, LabParams> = {};
  if (value.modelParams && typeof value.modelParams === 'object') {
    for (const [model, p] of Object.entries(value.modelParams as Record<string, unknown>).slice(0, 100)) {
      if (validModelName(model)) params[model] = cleanParams(p, LAB_PARAMS);
    }
  }
  return {
    openWebuiUrl: value.openWebuiUrl === null ? null : (validOpenWebuiUrl(value.openWebuiUrl) ?? base.openWebuiUrl),
    dailyCloudBudgetUsd: Number.isFinite(budget) ? Math.min(MAX_DAILY_CLOUD_BUDGET_USD, Math.max(0, budget)) : base.dailyCloudBudgetUsd,
    defaultModel: validModelName(value.defaultModel) ? value.defaultModel : null,
    modelParams: params,
  };
}

// ---- Model configurations (Open WebUI workspace models; base weights unchanged) ----

// Starting points for the Model Configuration tab. The system prompts are for the model, so in English like every
// prompt on the site; the names shown on the page come from the dictionaries (aiLab.configs.presets).
export const CONFIG_PRESETS = [
  {
    key: 'raceEngineer',
    id: 'racingcoach-race-engineer',
    name: 'RacingCoach Race Engineer',
    temperature: 0.3,
    system:
      'You are a professional race engineer for sim racing drivers. Diagnose handling from what the driver reports and ' +
      'any data they give: name the corner phase (entry, mid, exit), the likely root cause, and one primary change at a ' +
      'time, with the trade-off it brings. Prefer driving technique fixes before setup changes. Never invent telemetry, ' +
      'setup values or car facts; say what you would need to know.',
  },
  {
    key: 'drivingCoach',
    id: 'racingcoach-driving-coach',
    name: 'RacingCoach Driving Coach',
    temperature: 0.4,
    system:
      'You are a calm, encouraging driving coach for sim racers. Focus on braking points, brake release, minimum speed, ' +
      'throttle application and consistency. Give one or two specific, measurable things to try next lap, and explain ' +
      'why. Never claim to see data you were not given.',
  },
  {
    key: 'softwareArchitect',
    id: 'software-architect',
    name: 'Software Architect',
    temperature: 0.2,
    system:
      'You are a senior software architect. Weigh trade-offs explicitly, prefer simple designs that can grow, call out ' +
      'security, failure modes and operational cost, and say when you are unsure.',
  },
  {
    key: 'pythonDeveloper',
    id: 'python-developer',
    name: 'Python Developer',
    temperature: 0.2,
    system:
      'You are an expert Python developer. Write idiomatic, typed, tested Python 3. Explain non-obvious choices briefly ' +
      'and point out edge cases.',
  },
  {
    key: 'researchAssistant',
    id: 'ai-research-assistant',
    name: 'AI Research Assistant',
    temperature: 0.3,
    system:
      'You are an AI and machine learning research assistant. Explain concepts precisely, distinguish established results ' +
      'from speculation, and cite the papers or sources you rely on when you know them; never invent citations.',
  },
  {
    key: 'personalAssistant',
    id: 'personal-assistant',
    name: 'General Personal Assistant',
    temperature: 0.5,
    system: 'You are a helpful, concise personal assistant. Ask a clarifying question when a request is ambiguous.',
  },
] as const;

export type ConfigPresetKey = (typeof CONFIG_PRESETS)[number]['key'];

// The knowledge bases the Knowledge tab offers to create in Open WebUI; names and descriptions from the dictionaries
export const KNOWLEDGE_PRESETS = ['softwareDevelopment', 'aiMachineLearning', 'raceEngineering', 'raceCarSetups', 'simRacingTelemetry', 'racingCoachDocs', 'personalResearch'] as const;
