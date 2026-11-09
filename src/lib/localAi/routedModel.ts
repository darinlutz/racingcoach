// A chat model that sends each model call to a local server or the cloud (docs/local-ai.md). chatModel
// (src/lib/aiModels.ts) returns one for a feature mapped to a local model while the mode is Automatic, in place of
// the cloud model; everything else gets the cloud model exactly as before.
//
// Fallback happens inside one model call, before its answer reaches the caller: the local attempt must finish and its
// answer must have the shape the caller asked for (tool calls to tools it has, JSON for a response format), or the
// same messages go to the cloud model and its answer is returned instead. So an agent never sees half of one answer
// and half of another, and never runs a tool for an answer that was thrown away: tools run after the model call
// returns, on the one answer it returned. Nothing is streamed (no caller streams, and BaseChatModel streams a model
// without _streamResponseChunks as one chunk from _generate). When the caller's own signal aborts, nothing falls
// back: the call is canceled.
//
// Every attempt, local or cloud, is reported to record() once, with one logical request ID for the call. Only
// @langchain/core and node:crypto, so `node --test` runs it with fake models.

import { randomUUID } from 'node:crypto';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { BaseChatModelCallOptions, BindToolsInput } from '@langchain/core/language_models/chat_models';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AIMessage, BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { Runnable } from '@langchain/core/runnables';
import { FALLBACK_REASONS, type RoutePlan, type RouteReason } from './routing.ts';

export type AttemptStatus = 'completed' | 'failed' | 'timedOut' | 'canceled';

export type InferenceAttempt = {
  id: string;
  logicalRequestId: string;
  attempt: number;
  provider: string; // 'Local', or the cloud provider
  serverId: string | null;
  requestedModel: string;
  actualModel: string | null; // what the provider's answer says it was
  status: AttemptStatus;
  routeReason: RouteReason;
  isFallback: boolean;
  errorKind: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  startedAt: Date;
};

export type RouterDeps = {
  // Where this call goes, given the request's text (messages and tool definitions); read fresh for every call
  plan: (requestText: string) => Promise<RoutePlan>;
  // Takes a slot on the server (and the circuit's trial when it's half open); the reason when it can't
  acquire: (serverId: string) => RouteReason | null;
  release: (serverId: string) => void;
  // The local attempt's outcome, for the circuit breaker (a canceled call isn't the server's fault: not reported)
  reportLocal: (serverId: string, ok: boolean) => void;
  localModel: (plan: Extract<RoutePlan, { target: 'local' }>) => BaseChatModel;
  record: (attempt: InferenceAttempt) => void;
  cloudModelName: string;
  cloudProvider: string;
  // The Admin test console's "simulate a local failure": the local attempt fails at once, without calling the server
  simulateLocalFailure?: boolean;
};

type Binding = { tools: BindToolsInput[]; kwargs: Record<string, unknown> };

type UsageMetadata = { input_tokens?: number; output_tokens?: number; input_token_details?: { cache_read?: number } };

function usageOf(message: AIMessage) {
  const usage = message.usage_metadata as UsageMetadata | undefined;
  return {
    inputTokens: usage?.input_tokens ?? null,
    cachedInputTokens: usage?.input_token_details?.cache_read ?? null,
    outputTokens: usage?.output_tokens ?? null,
  };
}

// The model the provider says answered (OpenAI-compatible APIs, Ollama's included, give model_name)
function actualModelOf(message: AIMessage): string | null {
  const meta = (message.response_metadata ?? {}) as Record<string, unknown>;
  const name = meta.model_name ?? meta.model;
  return typeof name === 'string' && name ? name.slice(0, 200) : null;
}

function toolName(tool: BindToolsInput): string | null {
  const value = tool as { name?: unknown; function?: { name?: unknown } };
  if (typeof value.name === 'string') return value.name;
  if (value.function && typeof value.function.name === 'string') return value.function.name;
  return null;
}

// Why a local answer can't be used, or null when it can
export function localOutputProblem(message: AIMessage, binding: Binding | null): string | null {
  const calls = message.tool_calls ?? [];
  if ((message.invalid_tool_calls ?? []).length > 0) return 'invalidToolCall';
  const names = new Set((binding?.tools ?? []).map(toolName).filter((name): name is string => Boolean(name)));
  if (calls.some((call) => names.size > 0 && !names.has(call.name))) return 'unknownTool';
  if (calls.length > 0 && names.size === 0) return 'unknownTool';
  const choice = binding?.kwargs.tool_choice;
  if ((choice === 'any' || choice === 'required') && calls.length === 0) return 'noToolCall';
  const text = message.text ?? '';
  const format = binding?.kwargs.response_format as { type?: string } | undefined;
  if (format?.type === 'json_schema' && calls.length === 0) {
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object') return 'notJson';
    } catch {
      return 'notJson';
    }
  }
  if (calls.length === 0 && !text.trim()) return 'empty';
  return null;
}

export function errorKindOf(error: unknown): { status: AttemptStatus; kind: string; busy: boolean } {
  const e = error as { name?: string; message?: string; status?: number; error?: { error?: { type?: string }; type?: string } };
  const name = String(e?.name ?? '');
  const message = String(e?.message ?? '');
  const type = e?.error?.error?.type ?? e?.error?.type;
  if (name.includes('Timeout') || /timed? ?out/i.test(message)) return { status: 'timedOut', kind: 'timeout', busy: false };
  if (name === 'AbortError' || /abort/i.test(message)) return { status: 'canceled', kind: 'aborted', busy: false };
  if (type === 'local_busy' || e?.status === 429) return { status: 'failed', kind: 'busy', busy: true };
  if (typeof e?.status === 'number') return { status: 'failed', kind: `http${e.status}`, busy: false };
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|Connection error/i.test(message)) return { status: 'failed', kind: 'connection', busy: false };
  return { status: 'failed', kind: name && name !== 'Error' ? name.slice(0, 60) : 'error', busy: false };
}

export class RoutedChatModel extends BaseChatModel {
  #cloud: BaseChatModel;
  #deps: RouterDeps;
  #binding: Binding | null;

  constructor(cloud: BaseChatModel, deps: RouterDeps, binding: Binding | null = null) {
    super({});
    this.#cloud = cloud;
    this.#deps = deps;
    this.#binding = binding;
  }

  _llmType() {
    return 'racingcoach-routed';
  }

  // createAgent picks how to ask for a response format from the profile: the cloud model's, as before. The local
  // model gets the same request, and an answer it can't give in that shape falls back (localOutputProblem).
  get profile() {
    return this.#cloud.profile;
  }

  bindTools(tools: BindToolsInput[], kwargs?: Partial<BaseChatModelCallOptions>): ReturnType<NonNullable<BaseChatModel['bindTools']>> {
    return new RoutedChatModel(this.#cloud, this.#deps, { tools, kwargs: (kwargs ?? {}) as Record<string, unknown> }) as unknown as ReturnType<
      NonNullable<BaseChatModel['bindTools']>
    >;
  }

  #bound(model: BaseChatModel): Runnable<BaseMessage[], AIMessage> {
    if (!this.#binding) return model as unknown as Runnable<BaseMessage[], AIMessage>;
    if (!model.bindTools) throw new Error(`${model._llmType()} can't bind tools`);
    return model.bindTools(this.#binding.tools, this.#binding.kwargs as Partial<BaseChatModelCallOptions>) as Runnable<BaseMessage[], AIMessage>;
  }

  // The inner models report to their own callbacks (token usage); this run's callbacks only see the answer
  async _generate(messages: BaseMessage[], options: this['ParsedCallOptions'], // eslint-disable-next-line @typescript-eslint/no-unused-vars -- part of BaseChatModel's signature
    _runManager?: CallbackManagerForLLMRun): Promise<ChatResult> {
    const deps = this.#deps;
    const logicalRequestId = randomUUID();
    const signal = options.signal;
    let attempt = 0;
    let reason: RouteReason;

    let plan: RoutePlan;
    try {
      const toolsText = this.#binding ? JSON.stringify(this.#binding.tools.map((tool) => toolName(tool))) : '';
      plan = await deps.plan(messagesText(messages) + toolsText);
    } catch (error) {
      console.error('Local AI routing failed; using the cloud model:', error);
      plan = { target: 'cloud', reason: 'settingsUnavailable' };
    }

    if (plan.target === 'local') {
      const refused = deps.acquire(plan.serverId);
      if (refused) reason = refused;
      else {
        const startedAt = new Date();
        const started = performance.now();
        attempt += 1;
        const base = {
          id: randomUUID(),
          logicalRequestId,
          attempt,
          provider: 'Local',
          serverId: plan.serverId,
          requestedModel: plan.model,
          routeReason: 'local' as RouteReason,
          isFallback: false,
          startedAt,
        };
        try {
          if (deps.simulateLocalFailure) throw Object.assign(new Error('Simulated local failure (Admin test console)'), { name: 'SimulatedFailure' });
          const message = await this.#bound(deps.localModel(plan)).invoke(messages, { signal });
          const problem = localOutputProblem(message, this.#binding);
          const latencyMs = Math.round(performance.now() - started);
          if (!problem) {
            deps.record({ ...base, ...usageOf(message), actualModel: actualModelOf(message), status: 'completed', errorKind: null, latencyMs });
            deps.reportLocal(plan.serverId, true);
            return { generations: [{ text: message.text ?? '', message }] };
          }
          deps.record({ ...base, ...usageOf(message), actualModel: actualModelOf(message), status: 'failed', errorKind: problem, latencyMs });
          deps.reportLocal(plan.serverId, false);
          reason = 'localInvalidOutput';
        } catch (error) {
          const latencyMs = Math.round(performance.now() - started);
          const nothing = { actualModel: null, inputTokens: null, cachedInputTokens: null, outputTokens: null, latencyMs };
          if (signal?.aborted) {
            // The caller gave up (its own time limit, or the request went away): no fallback, and not the server's fault
            deps.record({ ...base, ...nothing, status: 'canceled', errorKind: 'callerAborted' });
            throw error;
          }
          const kind = errorKindOf(error);
          const simulated = (error as Error).name === 'SimulatedFailure';
          deps.record({ ...base, ...nothing, status: kind.status === 'canceled' ? 'failed' : kind.status, errorKind: simulated ? 'simulated' : kind.kind });
          // A busy server isn't failing, and a simulated failure isn't the server's
          if (!kind.busy && !simulated) deps.reportLocal(plan.serverId, false);
          reason = kind.busy ? 'localBusy' : kind.status === 'timedOut' ? 'localTimeout' : 'localFailed';
        } finally {
          deps.release(plan.serverId);
        }
      }
    } else {
      reason = plan.reason;
    }

    // The cloud model, as the feature would have used without local AI
    const startedAt = new Date();
    const started = performance.now();
    attempt += 1;
    const base = {
      id: randomUUID(),
      logicalRequestId,
      attempt,
      provider: deps.cloudProvider,
      serverId: null,
      requestedModel: deps.cloudModelName,
      routeReason: reason,
      isFallback: FALLBACK_REASONS.has(reason),
      startedAt,
    };
    try {
      const message = await this.#bound(this.#cloud).invoke(messages, { signal });
      deps.record({
        ...base,
        ...usageOf(message),
        actualModel: actualModelOf(message),
        status: 'completed',
        errorKind: null,
        latencyMs: Math.round(performance.now() - started),
      });
      return { generations: [{ text: message.text ?? '', message }] };
    } catch (error) {
      const kind = errorKindOf(error);
      deps.record({
        ...base,
        actualModel: null,
        inputTokens: null,
        cachedInputTokens: null,
        outputTokens: null,
        status: signal?.aborted ? 'canceled' : kind.status,
        errorKind: signal?.aborted ? 'callerAborted' : kind.kind,
        latencyMs: Math.round(performance.now() - started),
      });
      throw error;
    }
  }
}

// The messages' text, for estimating whether they fit a local model's context
export function messagesText(messages: BaseMessage[]): string {
  return messages
    .map((message) => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)))
    .join('\n');
}

