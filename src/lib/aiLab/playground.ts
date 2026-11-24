import { randomUUID } from 'node:crypto';
import { HumanMessage, SystemMessage, type AIMessageChunk } from '@langchain/core/messages';
import { aiModelProvider, isAiModel, labCloudModel, type AiModel } from '@/lib/aiModels';
import { AI_MODEL_PRICES } from '@/lib/aiModelPrices';
import { attemptCost } from '@/lib/localAi/events';
import { insertInferenceEvent } from '@/lib/localAi/store';
import { siteAiCall } from '@/lib/rateLimits';
import { LabUnavailableError, labRequest, labServer } from './gatewayClient';
import { cleanParams, estimateTokens, supportedParams, tokensPerSecond, worstCaseCostUsd, type LabParams, type LabProvider } from './rules';
import { getAiLabSettings, labCloudSpendTodayUsd } from './store';

// The AI Lab playground (docs/AI_LAB_SETUP.md): one prompt on one model, local (through the Mac's gateway, any
// installed model) or cloud (any model in AI_MODELS), with only the parameters that provider takes. Never a
// fallback: if the model asked for can't answer, the run fails and says why, so a comparison is always of the models
// shown. Every run is one "AiInferenceEvents" row with source aiLab (Overview's counts, AI Inference Monitoring);
// cloud runs are the site's own AI calls (siteAiCall), logged in AiUsage and the spend monitor, and refused when they
// could take the day's lab cloud spend past the budget on the AI Lab page.

export type PlaygroundTarget = { provider: 'Local'; model: string; serverId?: string | null } | { provider: 'Cloud'; model: AiModel };

export type PlaygroundMetrics = {
  provider: LabProvider;
  requestedModel: string;
  actualModel: string | null;
  serverId: string | null;
  // Measured on this server: from sending the request to the first token, and to the end
  firstTokenMs: number | null;
  totalMs: number;
  // Measured on the Mac (local only), without the tunnel's round trip
  macFirstTokenMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  tokensPerSecond: number | null;
  costUsd: number | null;
  fallback: false;
  params: LabParams;
  doneReason: string | null;
};

export type PlaygroundEvent =
  | { type: 'token'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'done'; metrics: PlaygroundMetrics }
  | { type: 'error'; error: string; detail?: string | null };

export class PlaygroundRefusal extends Error {
  constructor(public code: 'budget' | 'cloudOff' | 'unknownModel', message: string) {
    super(message);
    this.name = 'PlaygroundRefusal';
  }
}

// Cloud runs counted before they finish, so two at once can't both fit under the budget
const pendingUsd = new Map<string, number>();
const pendingTotal = () => [...pendingUsd.values()].reduce((a, b) => a + b, 0);

export function providerOf(target: PlaygroundTarget): LabProvider {
  return target.provider === 'Local' ? 'Local' : (aiModelProvider(target.model) as LabProvider);
}

// A queue the run pushes events into and the route reads from
function channel() {
  const items: PlaygroundEvent[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  return {
    push(event: PlaygroundEvent) {
      items.push(event);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    async *drain(): AsyncGenerator<PlaygroundEvent> {
      while (true) {
        if (items.length) {
          yield items.shift()!;
          continue;
        }
        if (closed) return;
        await new Promise<void>((resolve) => (wake = resolve));
        wake = null;
      }
    },
  };
}

function record(metrics: PlaygroundMetrics, status: 'completed' | 'failed' | 'timedOut' | 'canceled', startedAt: Date, errorKind: string | null) {
  void insertInferenceEvent({
    id: randomUUID(),
    logicalRequestId: randomUUID(),
    attempt: 1,
    feature: 'aiLabPlayground',
    category: 'Admin',
    source: 'aiLab',
    provider: metrics.provider,
    serverId: metrics.serverId,
    requestedModel: metrics.requestedModel,
    actualModel: metrics.actualModel,
    status,
    routeReason: 'aiLab',
    isFallback: false,
    errorKind,
    inputTokens: metrics.inputTokens,
    cachedInputTokens: null,
    outputTokens: metrics.outputTokens,
    latencyMs: metrics.totalMs,
    costUsd: metrics.costUsd,
    startedAt,
  });
}

const errorKindOf = (error: unknown, signal: AbortSignal) => {
  if (signal.aborted) return { status: 'canceled' as const, kind: 'aborted' };
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/timed? ?out|Timeout/i.test(text)) return { status: 'timedOut' as const, kind: 'timeout' };
  return { status: 'failed' as const, kind: 'error' };
};

export function runPlayground(input: { target: PlaygroundTarget; system: string; prompt: string; params: unknown; signal: AbortSignal }): AsyncGenerator<PlaygroundEvent> {
  const out = channel();
  const provider = providerOf(input.target);
  const params = cleanParams(input.params, supportedParams(provider, input.target.model));
  const startedAt = new Date();
  const started = performance.now();
  const base: PlaygroundMetrics = {
    provider,
    requestedModel: input.target.model,
    actualModel: null,
    serverId: null,
    firstTokenMs: null,
    totalMs: 0,
    macFirstTokenMs: null,
    inputTokens: null,
    outputTokens: null,
    tokensPerSecond: null,
    costUsd: provider === 'Local' ? 0 : null,
    fallback: false,
    params,
    doneReason: null,
  };

  const local = async (target: Extract<PlaygroundTarget, { provider: 'Local' }>) => {
    const server = await labServer(target.serverId);
    base.serverId = server.id;
    const response = await labRequest(
      server,
      'POST /lab/chat',
      { model: target.model, system: input.system, prompt: input.prompt, params, stream: true },
      { timeoutMs: 240_000, signal: input.signal }
    );
    if (!response.ok || !response.body) {
      const text = await response.text();
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: response.status === 403 ? 'cloudflareAccess' : 'unreachable', detail: text.slice(0, 200) };
      }
      throw Object.assign(new Error(String(body.error ?? `HTTP ${response.status}`)), { code: String(body.error ?? 'error'), detail: body.detail ?? null });
    }
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const raw = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!raw) continue;
        const part = JSON.parse(raw) as { type: string; text?: string; error?: string; metrics?: Record<string, unknown> };
        if ((part.type === 'token' || part.type === 'thinking') && base.firstTokenMs === null) base.firstTokenMs = Math.round(performance.now() - started);
        if (part.type === 'token' && part.text) out.push({ type: 'token', text: part.text });
        if (part.type === 'thinking' && part.text) out.push({ type: 'thinking', text: part.text });
        if (part.type === 'error') throw Object.assign(new Error(part.error ?? 'runtimeError'), { code: part.error ?? 'runtimeError', detail: (part as { detail?: string }).detail ?? null });
        if (part.type === 'done' && part.metrics) {
          const m = part.metrics;
          base.actualModel = typeof m.actualModel === 'string' ? m.actualModel : target.model;
          base.macFirstTokenMs = typeof m.firstTokenMs === 'number' ? m.firstTokenMs : null;
          base.inputTokens = typeof m.inputTokens === 'number' ? m.inputTokens : null;
          base.outputTokens = typeof m.outputTokens === 'number' ? m.outputTokens : null;
          // Ollama's own generation time, without loading, the prompt or the tunnel
          base.tokensPerSecond = typeof m.tokensPerSecond === 'number' ? m.tokensPerSecond : null;
          base.doneReason = typeof m.doneReason === 'string' ? m.doneReason : null;
          if (m.params && typeof m.params === 'object') base.params = m.params as LabParams;
        }
      }
    }
  };

  const cloud = async (model: AiModel) => {
    const settings = await getAiLabSettings();
    if (settings.dailyCloudBudgetUsd <= 0) throw new PlaygroundRefusal('cloudOff', 'Cloud models are turned off in the AI Lab (daily budget 0)');
    const price = AI_MODEL_PRICES[model];
    const worst = worstCaseCostUsd(price, estimateTokens(input.system + input.prompt), params.maxTokens ?? 8192);
    const spent = await labCloudSpendTodayUsd();
    if (spent + pendingTotal() + worst > settings.dailyCloudBudgetUsd) {
      throw new PlaygroundRefusal('budget', `This run could cost up to $${worst.toFixed(4)}; $${(spent + pendingTotal()).toFixed(4)} of today's $${settings.dailyCloudBudgetUsd.toFixed(2)} lab budget is used`);
    }
    const key = randomUUID();
    pendingUsd.set(key, worst);
    try {
      await siteAiCall('aiLabPlayground', async () => {
        const chat = await labCloudModel(model, params);
        const messages = [...(input.system ? [new SystemMessage(input.system)] : []), new HumanMessage(input.prompt)];
        let total: AIMessageChunk | null = null;
        for await (const chunk of await chat.stream(messages, { signal: input.signal })) {
          const text = chunk.text;
          if (text) {
            if (base.firstTokenMs === null) base.firstTokenMs = Math.round(performance.now() - started);
            out.push({ type: 'token', text });
          }
          total = total ? total.concat(chunk) : chunk;
        }
        const usage = total?.usage_metadata;
        const meta = (total?.response_metadata ?? {}) as Record<string, unknown>;
        base.actualModel = typeof meta.model_name === 'string' ? meta.model_name : typeof meta.model === 'string' ? meta.model : null;
        base.inputTokens = usage?.input_tokens ?? null;
        base.outputTokens = usage?.output_tokens ?? null;
        base.doneReason = typeof meta.finish_reason === 'string' ? meta.finish_reason : typeof meta.stop_reason === 'string' ? meta.stop_reason : null;
        const cached = usage?.input_token_details?.cache_read ?? null;
        base.costUsd = attemptCost(provider, model, base.inputTokens, cached, base.outputTokens);
      });
      // Cloud throughput: output tokens over the time after the first token (streamed), as close to generation
      // speed as a cloud API lets anyone measure
      const totalMs = Math.round(performance.now() - started);
      base.tokensPerSecond = tokensPerSecond(base.outputTokens, base.firstTokenMs === null ? totalMs : totalMs - base.firstTokenMs);
    } finally {
      pendingUsd.delete(key);
    }
  };

  void (async () => {
    try {
      if (input.target.provider === 'Local') await local(input.target);
      else {
        if (!isAiModel(input.target.model)) throw new PlaygroundRefusal('unknownModel', 'Unknown cloud model');
        await cloud(input.target.model);
      }
      base.totalMs = Math.round(performance.now() - started);
      record(base, 'completed', startedAt, null);
      out.push({ type: 'done', metrics: base });
    } catch (error) {
      base.totalMs = Math.round(performance.now() - started);
      if (error instanceof PlaygroundRefusal || (error instanceof LabUnavailableError && error.reason !== 'unreachable')) {
        // Refused before anything reached a model: not an inference, so not recorded
        out.push({ type: 'error', error: error instanceof PlaygroundRefusal ? error.code : error.reason, detail: error.message });
      } else {
        const kind = errorKindOf(error, input.signal);
        // A refusal before anything reached a model isn't an inference; a failed attempt is
        record(base, kind.status, startedAt, (error as { code?: string }).code ?? kind.kind);
        out.push({ type: 'error', error: (error as { code?: string }).code ?? kind.kind, detail: error instanceof Error ? error.message.slice(0, 300) : null });
      }
    } finally {
      out.close();
    }
  })();

  return out.drain();
}
