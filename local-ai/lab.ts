// The gateway's AI Lab routes (docs/AI_LAB_SETUP.md): what the website's AI Lab page may ask of this Mac, all under
// /lab/, each signed with the 'lab' purpose (so a production inference signature can't be replayed here) and each
// answered 404 unless LOCAL_AI_LAB=on in local-ai/.env. Model downloads and deletions also need
// LOCAL_AI_LAB_MANAGE=on. Nothing is passed through as-is: every route rebuilds its request to Ollama or Open WebUI
// from checked fields, at fixed paths on 127.0.0.1, so the website can't reach anything else on the Mac (no SSRF).
//
//   GET  /lab/status              Ollama's version, installed and loaded models, Open WebUI's health, pulls, limits
//   POST /lab/show                { name }: one model's details (context length, capabilities, family, quantization)
//   POST /lab/chat                { model, system?, prompt, params, stream, think? }: one lab generation
//   POST /lab/load | /lab/unload  { name, keepAlive? }: load a model into memory, or unload it
//   POST /lab/remote-size         { name }: a registry model's download size, before pulling it
//   POST /lab/pull                { name }: start a download in the background (one at a time); GET /lab/pulls
//   POST /lab/pull/cancel         { name }
//   POST /lab/delete              { name }: never a model the production gateway serves (LOCAL_AI_MODELS)
//   /lab/webui/...                memories, knowledge bases and model configurations, through Open WebUI's API with
//                                 OPEN_WEBUI_API_KEY, which never leaves this Mac
//
// Lab generations have their own slots (LOCAL_AI_LAB_MAX_CONCURRENCY, default 1), are refused while every production
// slot is busy, and are capped in context, output and time, so the lab can't starve production requests (which fall
// back to the cloud anyway).

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  cleanParams,
  LAB_HARD_LIMITS,
  LAB_PARAMS,
  LAB_TEXT_LIMITS,
  ollamaOptions,
  registryName,
  tokensPerSecond,
  validConfigId,
  validModelName,
  validWebuiId,
} from '../src/lib/aiLab/rules.ts';

export type LabConfig = {
  enabled: boolean;
  manage: boolean;
  ollamaUrl: string;
  productionModels: string[];
  maxConcurrency: number;
  maxContext: number;
  maxOutput: number;
  timeoutMs: number;
  openWebuiUrl: string;
  openWebuiApiKey: string;
  registryUrl: string;
  startedAt: number;
  agentVersion: string;
};

type Json = Record<string, unknown>;
type Send = (res: ServerResponse, status: number, body: unknown) => void;

export type Lab = {
  handles: (path: string) => boolean;
  handle: (req: IncomingMessage, res: ServerResponse, path: string, body: string, send: Send) => Promise<void>;
  activeCount: () => number;
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

export function createLab(config: LabConfig, production: { active: () => number; max: () => number }, log: (m: string) => void): Lab {
  let active = 0;
  type Pull = { name: string; status: string; completed: number | null; total: number | null; startedAt: number; finishedAt: number | null; error: string | null; abort: AbortController };
  const pulls = new Map<string, Pull>();
  const publicPull = (p: Pull) => ({ name: p.name, status: p.status, completed: p.completed, total: p.total, startedAt: p.startedAt, finishedAt: p.finishedAt, error: p.error });

  async function ollama(path: string, init: { method?: string; body?: unknown; timeoutMs?: number; signal?: AbortSignal } = {}) {
    const response = await fetch(`${config.ollamaUrl}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal ?? AbortSignal.timeout(init.timeoutMs ?? 5_000),
      redirect: 'error',
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { error: text.slice(0, 300) };
    }
    return { status: response.status, ok: response.ok, body: parsed as Json };
  }

  async function webui(path: string, init: { method?: string; body?: unknown } = {}) {
    if (!config.openWebuiApiKey) return { status: 503, ok: false, body: { error: 'openWebuiNotConfigured' } as Json };
    const response = await fetch(`${config.openWebuiUrl}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { authorization: `Bearer ${config.openWebuiApiKey}`, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { error: text.slice(0, 300) };
    }
    return { status: response.status, ok: response.ok, body: parsed as Json };
  }

  // ---- Status ----

  const models = (value: unknown) => ((value as { models?: Json[] })?.models ?? []);

  // Ollama's /api/tags leaves the family and size empty for some models (MLX safetensors ones, like qwen3.8:27b),
  // which /api/show has. Asked once per model version (digest), kept while the gateway runs.
  const showDetails = new Map<string, { family: string | null; parameterSize: string | null }>();
  async function fillDetails(m: Json, details: Json) {
    const text = (v: unknown) => (typeof v === 'string' && v ? v : null);
    const family = text(details.family);
    const parameterSize = text(details.parameter_size);
    if (family && parameterSize) return { family, parameterSize };
    const key = `${m.model ?? m.name}@${m.digest ?? ''}`;
    if (!showDetails.has(key)) {
      const shown = await ollama('/api/show', { body: { model: m.model ?? m.name }, timeoutMs: 5_000 }).catch(() => null);
      if (!shown?.ok) return { family, parameterSize };
      const d = (shown.body.details ?? {}) as Json;
      showDetails.set(key, { family: text(d.family), parameterSize: text(d.parameter_size) });
    }
    const known = showDetails.get(key)!;
    return { family: family ?? known.family, parameterSize: parameterSize ?? known.parameterSize };
  }

  async function status() {
    const [version, tags, ps] = await Promise.all([
      ollama('/api/version').catch((e) => ({ ok: false, status: 0, body: { error: errorText(e) } as Json })),
      ollama('/api/tags').catch((e) => ({ ok: false, status: 0, body: { error: errorText(e) } as Json })),
      ollama('/api/ps').catch((e) => ({ ok: false, status: 0, body: { error: errorText(e) } as Json })),
    ]);
    let openWebui: Json = { configured: false, ok: null, version: null, apiKey: Boolean(config.openWebuiApiKey), error: null };
    if (config.openWebuiUrl) {
      try {
        const [health, v] = await Promise.all([
          fetch(`${config.openWebuiUrl}/health`, { signal: AbortSignal.timeout(3_000), redirect: 'error' }),
          fetch(`${config.openWebuiUrl}/api/version`, { signal: AbortSignal.timeout(3_000), redirect: 'error' }).then((r) => (r.ok ? r.json() : null)),
        ]);
        openWebui = { configured: true, ok: health.ok, version: (v as Json | null)?.version ?? null, apiKey: Boolean(config.openWebuiApiKey), error: health.ok ? null : `HTTP ${health.status}` };
      } catch (error) {
        openWebui = { configured: true, ok: false, version: null, apiKey: Boolean(config.openWebuiApiKey), error: errorText(error) };
      }
    }
    return {
      agentVersion: config.agentVersion,
      uptimeSeconds: Math.round((Date.now() - config.startedAt) / 1000),
      lab: {
        manage: config.manage,
        active,
        maxConcurrency: config.maxConcurrency,
        maxContext: config.maxContext,
        maxOutput: config.maxOutput,
        timeoutMs: config.timeoutMs,
      },
      production: { models: config.productionModels, active: production.active(), maxConcurrency: production.max() },
      ollama: {
        ok: version.ok && tags.ok,
        version: (version.body as Json)?.version ?? null,
        error: version.ok && tags.ok ? null : String((version.body as Json)?.error ?? (tags.body as Json)?.error ?? `HTTP ${tags.status}`),
      },
      models: await Promise.all(models(tags.body).map(async (m) => {
        const details = (m.details ?? {}) as Json;
        const { family, parameterSize } = await fillDetails(m, details);
        return {
          name: m.model ?? m.name,
          family,
          families: details.families ?? null,
          parameterSize,
          quantization: details.quantization_level ?? null,
          format: details.format ?? null,
          sizeBytes: typeof m.size === 'number' ? m.size : null,
          modifiedAt: m.modified_at ?? null,
          digest: typeof m.digest === 'string' ? m.digest.slice(0, 12) : null,
        };
      })),
      loaded: models(ps.body).map((m) => ({
        name: m.model ?? m.name,
        sizeBytes: typeof m.size === 'number' ? m.size : null,
        vramBytes: typeof m.size_vram === 'number' ? m.size_vram : null,
        contextLength: typeof m.context_length === 'number' ? m.context_length : null,
        expiresAt: m.expires_at ?? null,
      })),
      openWebui,
      pulls: [...pulls.values()].map(publicPull),
    };
  }

  // ---- One model ----

  async function show(name: string) {
    const result = await ollama('/api/show', { body: { model: name }, timeoutMs: 10_000 });
    if (!result.ok) return result;
    const info = (result.body.model_info ?? {}) as Json;
    const contextKey = Object.keys(info).find((k) => k.endsWith('.context_length'));
    const details = (result.body.details ?? {}) as Json;
    const parameters = typeof result.body.parameters === 'string' ? result.body.parameters : '';
    const numCtx = /^num_ctx\s+(\d+)/m.exec(parameters)?.[1];
    return {
      status: 200,
      ok: true,
      body: {
        name,
        family: details.family || null,
        parameterSize: details.parameter_size || null,
        quantization: details.quantization_level || null,
        architecture: info['general.architecture'] ?? null,
        parameterCount: typeof info['general.parameter_count'] === 'number' ? info['general.parameter_count'] : null,
        contextLength: contextKey ? info[contextKey] : null,
        configuredNumCtx: numCtx ? Number(numCtx) : null,
        capabilities: Array.isArray(result.body.capabilities) ? result.body.capabilities : [],
        parameters: parameters.slice(0, 2000),
        license: typeof result.body.license === 'string' ? result.body.license.slice(0, 400) : null,
      } as Json,
    };
  }

  // ---- Generation ----

  async function chat(req: IncomingMessage, res: ServerResponse, request: Json, send: Send) {
    if (!validModelName(request.model)) return send(res, 400, { error: 'badModel' });
    const prompt = typeof request.prompt === 'string' ? request.prompt : '';
    const system = typeof request.system === 'string' ? request.system : '';
    if (!prompt.trim() || prompt.length > LAB_TEXT_LIMITS.prompt || system.length > LAB_TEXT_LIMITS.system) return send(res, 400, { error: 'badPrompt' });
    if (active >= config.maxConcurrency) return send(res, 503, { error: 'labBusy' });
    if (production.active() >= production.max()) return send(res, 503, { error: 'productionBusy' });

    const params = cleanParams(request.params, LAB_PARAMS);
    params.numCtx = Math.min(params.numCtx ?? config.maxContext, config.maxContext, LAB_HARD_LIMITS.numCtx);
    params.maxTokens = Math.min(params.maxTokens ?? config.maxOutput, config.maxOutput, LAB_HARD_LIMITS.maxTokens);
    const stream = request.stream === true;
    const body: Json = {
      model: request.model,
      messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }],
      stream: true,
      options: ollamaOptions(params),
    };
    if (typeof request.think === 'boolean') body.think = request.think;

    active += 1;
    const started = performance.now();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), config.timeoutMs);
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });
    let firstTokenMs: number | null = null;
    let text = '';
    let thinking = '';
    let final: Json | null = null;
    const line = (value: unknown) => res.write(`${JSON.stringify(value)}\n`);
    // Streamed: headers go out at once, and a line every 15 s until the first token, because Cloudflare gives up
    // (524) on an origin that sends nothing for 100 s, and a large model can take longer than that to load
    let keepAlive: ReturnType<typeof setInterval> | null = null;
    if (stream) {
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
      line({ type: 'started' });
      keepAlive = setInterval(() => firstTokenMs === null && line({ type: 'waiting' }), 15_000);
    }
    try {
      const upstream = await fetch(`${config.ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: abort.signal,
        redirect: 'error',
      });
      if (!upstream.ok || !upstream.body) {
        const detail = (await upstream.text()).slice(0, 300);
        const error = upstream.status === 404 ? 'modelNotInstalled' : 'runtimeError';
        if (stream) {
          line({ type: 'error', error, detail });
          return void res.end();
        }
        return send(res, upstream.status === 404 ? 404 : 502, { error, detail });
      }
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const raw = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!raw) continue;
          const part = JSON.parse(raw) as Json;
          if (part.error) throw new Error(String(part.error));
          const message = (part.message ?? {}) as Json;
          const delta = typeof message.content === 'string' ? message.content : '';
          const thought = typeof message.thinking === 'string' ? message.thinking : '';
          if ((delta || thought) && firstTokenMs === null) firstTokenMs = Math.round(performance.now() - started);
          if (delta) {
            text += delta;
            if (stream) line({ type: 'token', text: delta });
          }
          if (thought) {
            thinking += thought;
            if (stream) line({ type: 'thinking', text: thought });
          }
          if (part.done) final = part;
        }
      }
      const totalMs = Math.round(performance.now() - started);
      const ns = (v: unknown) => (typeof v === 'number' ? Math.round(v / 1e6) : null);
      const outputTokens = typeof final?.eval_count === 'number' ? final.eval_count : null;
      const metrics = {
        provider: 'Local',
        requestedModel: request.model,
        actualModel: final?.model ?? request.model,
        firstTokenMs,
        totalMs,
        inputTokens: typeof final?.prompt_eval_count === 'number' ? final.prompt_eval_count : null,
        outputTokens,
        tokensPerSecond: tokensPerSecond(outputTokens, ns(final?.eval_duration)),
        loadMs: ns(final?.load_duration),
        promptEvalMs: ns(final?.prompt_eval_duration),
        evalMs: ns(final?.eval_duration),
        doneReason: final?.done_reason ?? null,
        params,
      };
      log(`Lab ${request.model}: ${outputTokens ?? '?'} tokens in ${totalMs} ms`);
      if (stream) {
        line({ type: 'done', metrics });
        res.end();
      } else {
        send(res, 200, { text, thinking: thinking || null, metrics });
      }
    } catch (error) {
      const message = abort.signal.aborted ? 'canceledOrTimedOut' : errorText(error);
      log(`Lab ${request.model}: failed after ${Math.round(performance.now() - started)} ms: ${message}`);
      if (res.headersSent) {
        line({ type: 'error', error: message });
        res.end();
      } else {
        send(res, 502, { error: 'runtimeError', detail: message });
      }
    } finally {
      clearTimeout(timer);
      if (keepAlive) clearInterval(keepAlive);
      active -= 1;
    }
  }

  // ---- Loading ----

  // Answers when the model is loaded, or after 60 s with loading: true while Ollama carries on (the status shows it
  // loaded once it is), so a big model never holds the request past Cloudflare's 100 s
  async function load(name: string, keepAlive: string) {
    const loading = ollama('/api/generate', { body: { model: name, keep_alive: keepAlive }, timeoutMs: 600_000 });
    loading.then(
      (r) => log(`Lab: load ${name} (${keepAlive}): HTTP ${r.status}`),
      (e) => log(`Lab: load ${name} failed: ${errorText(e)}`)
    );
    const result = await Promise.race([loading, new Promise<null>((resolve) => setTimeout(() => resolve(null), 60_000))]);
    if (result === null) return { status: 202, body: { loaded: false, loading: true } };
    return result.ok
      ? { status: 200, body: { loaded: true } }
      : { status: result.status === 404 ? 404 : 502, body: { error: result.status === 404 ? 'modelNotInstalled' : 'runtimeError', detail: (result.body as Json)?.error ?? null } };
  }

  // ---- Downloads ----

  async function remoteSize(name: string) {
    const ref = registryName(name);
    if (!ref) return { status: 200, ok: true, body: { name, known: false, sizeBytes: null } as Json };
    const response = await fetch(`${config.registryUrl}/v2/${ref.namespace}/${ref.model}/manifests/${ref.tag}`, {
      headers: { accept: 'application/vnd.docker.distribution.manifest.v2+json' },
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    if (response.status === 404) return { status: 404, ok: false, body: { error: 'modelNotFound' } as Json };
    if (!response.ok) return { status: 502, ok: false, body: { error: 'registryError', detail: `HTTP ${response.status}` } as Json };
    const manifest = (await response.json()) as { layers?: { size?: number }[]; config?: { size?: number } };
    const sizeBytes = (manifest.layers ?? []).reduce((sum, layer) => sum + (layer.size ?? 0), manifest.config?.size ?? 0);
    return { status: 200, ok: true, body: { name, known: true, sizeBytes } as Json };
  }

  function startPull(name: string) {
    const running = [...pulls.values()].find((p) => p.finishedAt === null);
    if (running) return { status: 409, ok: false, body: { error: 'pullRunning', name: running.name } as Json };
    const pull: Pull = { name, status: 'starting', completed: null, total: null, startedAt: Date.now(), finishedAt: null, error: null, abort: new AbortController() };
    pulls.set(name, pull);
    log(`Lab: pulling ${name}`);
    void (async () => {
      try {
        const response = await fetch(`${config.ollamaUrl}/api/pull`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: name, stream: true }),
          signal: pull.abort.signal,
          redirect: 'error',
        });
        if (!response.ok || !response.body) throw new Error(`Ollama HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
        const decoder = new TextDecoder();
        let buffer = '';
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          buffer += decoder.decode(chunk, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const raw = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!raw) continue;
            const part = JSON.parse(raw) as Json;
            if (part.error) throw new Error(String(part.error));
            pull.status = String(part.status ?? pull.status).slice(0, 100);
            if (typeof part.total === 'number') pull.total = part.total;
            if (typeof part.completed === 'number') pull.completed = part.completed;
          }
        }
        if (pull.status !== 'success') throw new Error(`Ended with status ${pull.status}`);
        log(`Lab: pulled ${name}`);
      } catch (error) {
        pull.error = pull.abort.signal.aborted ? 'canceled' : errorText(error);
        pull.status = 'failed';
        log(`Lab: pull of ${name} failed: ${pull.error}`);
      } finally {
        pull.finishedAt = Date.now();
      }
    })();
    // Finished pulls are kept an hour for the page to show
    for (const [key, p] of pulls) if (p.finishedAt && Date.now() - p.finishedAt > 3_600_000) pulls.delete(key);
    return { status: 202, ok: true, body: { started: true, name } as Json };
  }

  // ---- Open WebUI ----

  const memory = (m: Json) => ({ id: m.id, content: m.content, type: m.type ?? null, createdAt: m.created_at ?? null, updatedAt: m.updated_at ?? null });

  async function webuiRoute(method: string, path: string, request: Json) {
    switch (`${method} ${path}`) {
      case 'GET /lab/webui/memories': {
        const r = await webui('/api/v1/memories/');
        return r.ok ? { ...r, body: { memories: ((r.body as unknown as Json[]) ?? []).map(memory) } } : r;
      }
      case 'POST /lab/webui/memories': {
        const content = typeof request.content === 'string' ? request.content.trim() : '';
        if (!content || content.length > LAB_TEXT_LIMITS.memory) return { status: 400, ok: false, body: { error: 'badContent' } };
        const r = await webui('/api/v1/memories/add', { body: { content } });
        return r.ok ? { ...r, body: { memory: memory(r.body) } } : r;
      }
      case 'POST /lab/webui/memories/update': {
        const content = typeof request.content === 'string' ? request.content.trim() : '';
        if (!validWebuiId(request.id) || !content || content.length > LAB_TEXT_LIMITS.memory) return { status: 400, ok: false, body: { error: 'badContent' } };
        const r = await webui(`/api/v1/memories/${request.id}/update`, { body: { content } });
        return r.ok ? { ...r, body: { memory: memory(r.body) } } : r;
      }
      case 'POST /lab/webui/memories/delete': {
        if (!validWebuiId(request.id)) return { status: 400, ok: false, body: { error: 'badId' } };
        const r = await webui(`/api/v1/memories/${request.id}`, { method: 'DELETE' });
        return r.ok ? { ...r, body: { deleted: r.body === (true as unknown) } } : r;
      }
      case 'POST /lab/webui/memories/query': {
        const content = typeof request.content === 'string' ? request.content.trim() : '';
        const k = Math.min(10, Math.max(1, Math.round(Number(request.k) || 3)));
        if (!content || content.length > LAB_TEXT_LIMITS.prompt) return { status: 400, ok: false, body: { error: 'badContent' } };
        const r = await webui('/api/v1/memories/query', { body: { content, k } });
        // Open WebUI answers "No memories found" with 404 when there are none
        if (r.status === 404) return { status: 200, ok: true, body: { results: [] } };
        if (!r.ok) return r;
        // A vector search result: { ids: [[...]], documents: [[...]], distances: [[...]] }
        const first = (key: string) => (((r.body as Json)[key] as unknown[][] | undefined)?.[0] ?? []) as unknown[];
        const ids = first('ids');
        const documents = first('documents');
        const distances = first('distances');
        return { status: 200, ok: true, body: { results: ids.map((id, i) => ({ id, content: documents[i] ?? null, distance: typeof distances[i] === 'number' ? distances[i] : null })) } };
      }
      case 'GET /lab/webui/knowledge': {
        const r = await webui('/api/v1/knowledge/?page=1');
        if (!r.ok) return r;
        const items = (Array.isArray(r.body) ? r.body : ((r.body as Json).items as Json[] | undefined) ?? []) as Json[];
        return {
          ...r,
          body: {
            knowledge: items.map((k) => ({
              id: k.id,
              name: k.name,
              description: k.description ?? '',
              files: Array.isArray(k.files) ? k.files.length : null,
              updatedAt: k.updated_at ?? null,
            })),
            total: typeof (r.body as Json).total === 'number' ? (r.body as Json).total : items.length,
          },
        };
      }
      case 'POST /lab/webui/knowledge': {
        const name = typeof request.name === 'string' ? request.name.trim() : '';
        const description = typeof request.description === 'string' ? request.description.trim() : '';
        if (!name || name.length > LAB_TEXT_LIMITS.name || description.length > LAB_TEXT_LIMITS.description) return { status: 400, ok: false, body: { error: 'badName' } };
        // No access grants: private to the API key's owner (the Mac's Open WebUI admin)
        const r = await webui('/api/v1/knowledge/create', { body: { name, description } });
        return r.ok ? { ...r, body: { id: (r.body as Json)?.id ?? null } } : r;
      }
      case 'GET /lab/webui/models': {
        const r = await webui('/api/v1/models/list?page=1');
        if (!r.ok) return r;
        const items = (Array.isArray(r.body) ? r.body : ((r.body as Json).items as Json[] | undefined) ?? []) as Json[];
        return {
          ...r,
          body: {
            models: items.map((m) => {
              const meta = (m.meta ?? {}) as Json;
              const params = (m.params ?? {}) as Json;
              return {
                id: m.id,
                name: m.name,
                baseModelId: m.base_model_id ?? null,
                description: meta.description ?? '',
                knowledge: Array.isArray(meta.knowledge) ? meta.knowledge.length : 0,
                hasSystem: typeof params.system === 'string' && params.system.length > 0,
                isActive: m.is_active !== false,
                kind: (meta as Json).racingcoachKind ?? null,
                updatedAt: m.updated_at ?? null,
              };
            }),
          },
        };
      }
      case 'POST /lab/webui/models': {
        const name = typeof request.name === 'string' ? request.name.trim() : '';
        const description = typeof request.description === 'string' ? request.description.trim() : '';
        const system = typeof request.system === 'string' ? request.system.trim() : '';
        if (!validConfigId(request.id) || !validModelName(request.baseModelId)) return { status: 400, ok: false, body: { error: 'badId' } };
        if (!name || name.length > LAB_TEXT_LIMITS.name || description.length > LAB_TEXT_LIMITS.description || system.length > LAB_TEXT_LIMITS.system) {
          return { status: 400, ok: false, body: { error: 'badName' } };
        }
        const params = cleanParams(request.params, LAB_PARAMS);
        const r = await webui('/api/v1/models/create', {
          body: {
            id: request.id,
            base_model_id: request.baseModelId,
            name,
            // racingcoachKind marks it as a configuration made in AI Lab: a system prompt and parameters on unchanged
            // base weights, never a fine-tuned model
            meta: { description, racingcoachKind: 'configuration' },
            params: { system, ...ollamaOptions(params) },
            is_active: true,
          },
        });
        return r.ok ? { ...r, body: { id: (r.body as Json)?.id ?? request.id } } : r;
      }
      default:
        return { status: 404, ok: false, body: { error: 'notFound' } };
    }
  }

  // ---- Routing ----

  async function handle(req: IncomingMessage, res: ServerResponse, path: string, body: string, send: Send) {
    if (!config.enabled) return send(res, 404, { error: 'labDisabled' });
    const method = req.method ?? 'GET';
    let request: Json = {};
    if (method === 'POST') {
      try {
        request = body ? (JSON.parse(body) as Json) : {};
      } catch {
        return send(res, 400, { error: 'notJson' });
      }
    }
    const reply = (r: { status: number; body: unknown }) => send(res, r.status, r.body);
    const named = () => (validModelName(request.name) ? request.name : null);
    const route = `${method} ${path}`;
    try {
      if (path.startsWith('/lab/webui/')) return reply(await webuiRoute(method, path, request));
      switch (route) {
        case 'GET /lab/status':
          return send(res, 200, await status());
        case 'GET /lab/pulls':
          return send(res, 200, { pulls: [...pulls.values()].map(publicPull) });
        case 'POST /lab/chat':
          return chat(req, res, request, send);
        case 'POST /lab/show': {
          const name = named();
          return name ? reply(await show(name)) : send(res, 400, { error: 'badModel' });
        }
        case 'POST /lab/load': {
          const name = named();
          if (!name) return send(res, 400, { error: 'badModel' });
          const keepAlive = typeof request.keepAlive === 'string' && /^\d{1,4}[smh]$/.test(request.keepAlive) ? request.keepAlive : '30m';
          // A generate request without a prompt loads the model and keeps it for keepAlive
          return reply(await load(name, keepAlive));
        }
        case 'POST /lab/unload': {
          const name = named();
          if (!name) return send(res, 400, { error: 'badModel' });
          const r = await ollama('/api/generate', { body: { model: name, keep_alive: 0 }, timeoutMs: 30_000 });
          log(`Lab: unload ${name}: HTTP ${r.status}`);
          return reply(r.ok ? { status: 200, body: { unloaded: true } } : { status: 502, body: { error: 'runtimeError', detail: (r.body as Json)?.error ?? null } });
        }
        case 'POST /lab/remote-size': {
          const name = named();
          return name ? reply(await remoteSize(name)) : send(res, 400, { error: 'badModel' });
        }
        case 'POST /lab/pull': {
          if (!config.manage) return send(res, 403, { error: 'manageDisabled' });
          const name = named();
          return name ? reply(startPull(name)) : send(res, 400, { error: 'badModel' });
        }
        case 'POST /lab/pull/cancel': {
          const pull = pulls.get(String(request.name));
          if (!pull || pull.finishedAt) return send(res, 404, { error: 'noPull' });
          pull.abort.abort();
          return send(res, 200, { canceled: true });
        }
        case 'POST /lab/delete': {
          if (!config.manage) return send(res, 403, { error: 'manageDisabled' });
          const name = named();
          if (!name) return send(res, 400, { error: 'badModel' });
          if (config.productionModels.includes(name)) return send(res, 409, { error: 'productionModel' });
          const r = await ollama('/api/delete', { method: 'DELETE', body: { model: name }, timeoutMs: 30_000 });
          log(`Lab: delete ${name}: HTTP ${r.status}`);
          return reply(r.ok ? { status: 200, body: { deleted: true } } : { status: r.status === 404 ? 404 : 502, body: { error: r.status === 404 ? 'modelNotInstalled' : 'runtimeError' } });
        }
        default:
          return send(res, 404, { error: 'notFound' });
      }
    } catch (error) {
      log(`Lab ${route}: ${errorText(error)}`);
      if (!res.headersSent) send(res, 502, { error: 'unreachable', detail: errorText(error) });
    }
  }

  return { handles: (path) => path === '/lab' || path.startsWith('/lab/'), handle, activeCount: () => active };
}
