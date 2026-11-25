// The gateway's Memory Service routes (docs/AI_MEMORY_SETUP.md): what the website's Memory Service may ask of this
// Mac, under /lab/ so they share the lab's 'lab' signature and its LOCAL_AI_LAB=on switch. Like every lab route,
// nothing is passed through: each request to Ollama or the Mem0 sidecar is rebuilt from checked fields at a fixed
// path on 127.0.0.1.
//
//   POST /lab/memory/embed     { model, input: string[] }: Ollama /api/embed
//   POST /lab/memory/generate  { model, system, prompt, schema }: one non-streaming Ollama chat with a JSON schema
//                              as its format (structured output), temperature 0, capped in context, output and time
//   POST /lab/mem0/<op>        health | extract | search | upsert | delete | list: the Mem0 sidecar
//                              (local-ai/mem0/server.py) at MEM0_URL, 503 mem0NotConfigured without it
//
// Memory calls have their own slots (LOCAL_AI_MEMORY_MAX_CONCURRENCY, default 1) and are refused while every
// production slot is busy, so memory work never starves production inference; the website defers the job.

import { validModelName } from '../src/lib/aiLab/rules.ts';

type Json = Record<string, unknown>;
export type MemoryRouteConfig = { ollamaUrl: string; mem0Url: string; maxConcurrency: number; maxContext: number; maxOutput: number; timeoutMs: number };
type Result = { status: number; body: unknown };

const MEM0_OPS = ['health', 'extract', 'search', 'upsert', 'delete', 'list'] as const;
const MAX_INPUTS = 64;
const MAX_INPUT_CHARS = 8_000;
const MAX_PROMPT_CHARS = 48_000;
const MAX_SCHEMA_BYTES = 16_000;

const text = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : null);

export function createMemoryRoutes(config: MemoryRouteConfig, production: { active: () => number; max: () => number }, log: (m: string) => void) {
  let active = 0;

  async function post(url: string, body: unknown, timeoutMs: number): Promise<{ status: number; body: Json }> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    const raw = await response.text();
    try {
      return { status: response.status, body: raw ? (JSON.parse(raw) as Json) : {} };
    } catch {
      return { status: response.status, body: { error: raw.slice(0, 300) } };
    }
  }

  async function slot<T>(work: () => Promise<T>): Promise<T | Result> {
    if (active >= config.maxConcurrency) return { status: 503, body: { error: 'memoryBusy' } };
    if (production.active() >= production.max()) return { status: 503, body: { error: 'productionBusy' } };
    active++;
    try {
      return await work();
    } finally {
      active--;
    }
  }

  async function embed(request: Json): Promise<Result> {
    if (!validModelName(request.model)) return { status: 400, body: { error: 'badModel' } };
    const input = Array.isArray(request.input) ? request.input : null;
    if (!input || !input.length || input.length > MAX_INPUTS || !input.every((t) => typeof t === 'string' && t.length > 0 && t.length <= MAX_INPUT_CHARS)) {
      return { status: 400, body: { error: 'badInput' } };
    }
    const started = Date.now();
    const r = await post(`${config.ollamaUrl}/api/embed`, { model: request.model, input, truncate: true }, 60_000);
    if (r.status !== 200) return { status: r.status === 404 ? 404 : 502, body: { error: r.status === 404 ? 'modelNotInstalled' : 'runtimeError', detail: String(r.body.error ?? '').slice(0, 300) } };
    const embeddings = r.body.embeddings as number[][] | undefined;
    if (!Array.isArray(embeddings) || embeddings.length !== input.length) return { status: 502, body: { error: 'runtimeError', detail: 'unexpected embed response' } };
    return { status: 200, body: { model: request.model, embeddings, dimensions: embeddings[0]?.length ?? 0, ms: Date.now() - started } };
  }

  async function generate(request: Json): Promise<Result> {
    if (!validModelName(request.model)) return { status: 400, body: { error: 'badModel' } };
    const system = text(request.system, MAX_PROMPT_CHARS);
    const prompt = text(request.prompt, MAX_PROMPT_CHARS);
    if (system === null || !prompt) return { status: 400, body: { error: 'badPrompt' } };
    const schema = request.schema && typeof request.schema === 'object' ? request.schema : null;
    if (!schema || JSON.stringify(schema).length > MAX_SCHEMA_BYTES) return { status: 400, body: { error: 'badSchema' } };
    const started = Date.now();
    const r = await post(
      `${config.ollamaUrl}/api/chat`,
      {
        model: request.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        stream: false,
        format: schema,
        think: false,
        keep_alive: '10m',
        options: { temperature: 0, num_ctx: Math.min(16_384, config.maxContext), num_predict: Math.min(2_048, config.maxOutput) },
      },
      config.timeoutMs
    );
    if (r.status !== 200) return { status: r.status === 404 ? 404 : 502, body: { error: r.status === 404 ? 'modelNotInstalled' : 'runtimeError', detail: String(r.body.error ?? '').slice(0, 300) } };
    const message = (r.body.message ?? {}) as Json;
    return {
      status: 200,
      body: {
        model: request.model,
        content: typeof message.content === 'string' ? message.content : '',
        promptTokens: typeof r.body.prompt_eval_count === 'number' ? r.body.prompt_eval_count : null,
        outputTokens: typeof r.body.eval_count === 'number' ? r.body.eval_count : null,
        ms: Date.now() - started,
      },
    };
  }

  // The sidecar validates its own fields too; here only the operation and the body's size are checked
  async function mem0(op: string, request: Json): Promise<Result> {
    if (!config.mem0Url) return { status: 503, body: { error: 'mem0NotConfigured' } };
    if (!(MEM0_OPS as readonly string[]).includes(op)) return { status: 404, body: { error: 'notFound' } };
    if (JSON.stringify(request).length > 64_000) return { status: 400, body: { error: 'tooLarge' } };
    const r = await post(`${config.mem0Url}/${op}`, request, op === 'extract' ? config.timeoutMs : 60_000);
    return { status: r.status, body: r.body };
  }

  return {
    handles: (path: string) => path.startsWith('/lab/memory/') || path.startsWith('/lab/mem0/'),
    async route(method: string, path: string, request: Json): Promise<Result> {
      if (method !== 'POST') return { status: 404, body: { error: 'notFound' } };
      try {
        if (path === '/lab/memory/embed') return await slot(() => embed(request));
        if (path === '/lab/memory/generate') return await slot(() => generate(request));
        if (path.startsWith('/lab/mem0/')) {
          const op = path.slice('/lab/mem0/'.length);
          return op === 'extract' ? await slot(() => mem0(op, request)) : await mem0(op, request);
        }
        return { status: 404, body: { error: 'notFound' } };
      } catch (error) {
        const detail = (error instanceof Error ? error.message : String(error)).slice(0, 300);
        log(`Memory ${path}: ${detail}`);
        return { status: 502, body: { error: path.startsWith('/lab/mem0/') ? 'mem0Unreachable' : 'unreachable', detail } };
      }
    },
    activeCount: () => active,
  };
}
