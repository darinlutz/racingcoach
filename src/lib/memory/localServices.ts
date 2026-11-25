import { isLiveServer } from '@/lib/serverEnvironment';
import { labJson, labServer, LabUnavailableError, labStatus, type LabPath } from '@/lib/aiLab/gatewayClient';

// How the Memory Service reaches Ollama and the Mem0 sidecar on the Mac (docs/AI_MEMORY_ARCHITECTURE.md,
// Infrastructure): through the registered gateway and Cloudflare tunnel, signed like every AI Lab call
// (local-ai/memoryRoutes.ts). For local development only, MEMORY_OLLAMA_URL and MEMORY_MEM0_URL point straight at
// them on this computer; the live server never uses them, so nothing on the Mac is ever reached unsigned from Render.
//
// Each service has a circuit breaker: after a failure it isn't asked again for 30 s (2 minutes after three in a
// row), so an offline Mac costs one failed request, not one per memory operation. Callers treat OfflineError as
// "degrade": keyword-only retrieval, extraction deferred.

export class OfflineError extends Error {
  constructor(public service: 'ollama' | 'mem0', public reason: string, message?: string) {
    super(message ?? `${service} is unavailable: ${reason}`);
    this.name = 'OfflineError';
  }
}

type Breaker = { failures: number; openUntil: number; lastError: string | null; lastOkAt: number | null; lastErrorAt: number | null; requests: number; errors: number; totalMs: number };
const globalForBreakers = globalThis as unknown as { memoryBreakers?: Record<'ollama' | 'mem0', Breaker> };
const fresh = (): Breaker => ({ failures: 0, openUntil: 0, lastError: null, lastOkAt: null, lastErrorAt: null, requests: 0, errors: 0, totalMs: 0 });
const breakers = (globalForBreakers.memoryBreakers ??= { ollama: fresh(), mem0: fresh() });

export const serviceHealth = () => ({
  ollama: { ...breakers.ollama, open: breakers.ollama.openUntil > Date.now() },
  mem0: { ...breakers.mem0, open: breakers.mem0.openUntil > Date.now() },
});

export function resetBreakers(): void {
  breakers.ollama = fresh();
  breakers.mem0 = fresh();
}

function devUrl(name: 'MEMORY_OLLAMA_URL' | 'MEMORY_MEM0_URL'): string | null {
  const value = process.env[name]?.trim();
  if (!value || isLiveServer()) return null;
  try {
    const url = new URL(value);
    // Only this computer: a development override is never a way to reach another host
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return null;
    return value.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

async function guarded<T>(service: 'ollama' | 'mem0', work: () => Promise<T>): Promise<T> {
  const b = breakers[service];
  if (b.openUntil > Date.now()) throw new OfflineError(service, 'circuitOpen', b.lastError ?? undefined);
  const started = Date.now();
  b.requests++;
  try {
    const value = await work();
    b.failures = 0;
    b.lastOkAt = Date.now();
    b.totalMs += Date.now() - started;
    return value;
  } catch (error) {
    // A refusal that says the Mac is busy isn't the Mac being down: no breaker, the job is deferred
    const busy = error instanceof OfflineError && ['memoryBusy', 'productionBusy'].includes(error.reason);
    b.errors++;
    b.lastError = error instanceof Error ? error.message.slice(0, 300) : String(error);
    b.lastErrorAt = Date.now();
    if (!busy) {
      b.failures++;
      b.openUntil = Date.now() + (b.failures >= 3 ? 120_000 : 30_000);
    }
    if (error instanceof OfflineError) throw error;
    throw new OfflineError(service, 'unreachable', b.lastError);
  }
}

async function direct(base: string, path: string, body: unknown, timeoutMs: number): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
    cache: 'no-store',
  });
  const text = await response.text();
  try {
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  } catch {
    return { status: response.status, body: { error: text.slice(0, 300) } };
  }
}

async function viaGateway(route: LabPath, body: Record<string, unknown>, timeoutMs: number, service: 'ollama' | 'mem0') {
  try {
    const server = await labServer();
    return await labJson(server, route, body, timeoutMs);
  } catch (error) {
    if (error instanceof LabUnavailableError) throw new OfflineError(service, error.reason, error.message);
    throw error;
  }
}

function check(service: 'ollama' | 'mem0', r: { status: number; body: Record<string, unknown> }) {
  if (r.status === 200) return r.body;
  const reason = typeof r.body.error === 'string' ? r.body.error : `http${r.status}`;
  throw new OfflineError(service, reason, typeof r.body.detail === 'string' ? `${reason}: ${r.body.detail}` : reason);
}

// ---- Ollama ----

export async function ollamaEmbed(model: string, input: string[]): Promise<{ embeddings: number[][]; dimensions: number; ms: number }> {
  return guarded('ollama', async () => {
    const started = Date.now();
    const base = devUrl('MEMORY_OLLAMA_URL');
    if (base) {
      const r = check('ollama', await direct(base, '/api/embed', { model, input, truncate: true }, 60_000));
      const embeddings = r.embeddings as number[][];
      return { embeddings, dimensions: embeddings[0]?.length ?? 0, ms: Date.now() - started };
    }
    const r = check('ollama', await viaGateway('POST /lab/memory/embed', { model, input }, 60_000, 'ollama'));
    return { embeddings: r.embeddings as number[][], dimensions: Number(r.dimensions), ms: Date.now() - started };
  });
}

export type GenerateResult = { content: string; model: string; promptTokens: number | null; outputTokens: number | null; ms: number };

// One structured generation: the model must answer JSON matching the schema (Ollama's format), temperature 0
export async function ollamaGenerateJson(model: string, system: string, prompt: string, schema: Record<string, unknown>, timeoutMs = 120_000): Promise<GenerateResult> {
  return guarded('ollama', async () => {
    const started = Date.now();
    const base = devUrl('MEMORY_OLLAMA_URL');
    if (base) {
      const r = check(
        'ollama',
        await direct(
          base,
          '/api/chat',
          {
            model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: prompt },
            ],
            stream: false,
            format: schema,
            think: false,
            keep_alive: '10m',
            options: { temperature: 0, num_ctx: 16_384, num_predict: 2_048 },
          },
          timeoutMs
        )
      );
      const message = (r.message ?? {}) as { content?: string };
      return { content: message.content ?? '', model, promptTokens: (r.prompt_eval_count as number) ?? null, outputTokens: (r.eval_count as number) ?? null, ms: Date.now() - started };
    }
    const r = check('ollama', await viaGateway('POST /lab/memory/generate', { model, system, prompt, schema }, timeoutMs + 5_000, 'ollama'));
    return { content: String(r.content ?? ''), model, promptTokens: (r.promptTokens as number) ?? null, outputTokens: (r.outputTokens as number) ?? null, ms: Date.now() - started };
  });
}

export type InstalledModel = { name: string; family: string | null; capabilities: string[] | null; parameterSize: string | null };

// Installed models, for the Providers section's pickers: the lab's cached status in production, Ollama's tags here
export async function installedModels(): Promise<{ reachable: boolean; models: InstalledModel[]; version: string | null; error: string | null }> {
  const base = devUrl('MEMORY_OLLAMA_URL');
  try {
    if (base) {
      const [tags, version] = await Promise.all([
        fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4_000), cache: 'no-store' }).then((r) => r.json() as Promise<{ models?: { name: string; details?: { family?: string; parameter_size?: string } }[] }>),
        fetch(`${base}/api/version`, { signal: AbortSignal.timeout(4_000), cache: 'no-store' }).then((r) => r.json() as Promise<{ version?: string }>),
      ]);
      const models = await Promise.all(
        (tags.models ?? []).map(async (m) => {
          let capabilities: string[] | null = null;
          try {
            const shown = await direct(base, '/api/show', { model: m.name }, 4_000);
            capabilities = Array.isArray(shown.body.capabilities) ? (shown.body.capabilities as string[]) : null;
          } catch {
            /* capabilities stay unknown */
          }
          return { name: m.name, family: m.details?.family ?? null, parameterSize: m.details?.parameter_size ?? null, capabilities };
        })
      );
      return { reachable: true, models, version: version.version ?? null, error: null };
    }
    const status = await labStatus();
    if (!status.reachable) return { reachable: false, models: [], version: null, error: status.reason };
    const data = status.data as { ollama?: { version?: string; ok?: boolean }; models?: InstalledModel[] };
    return { reachable: data.ollama?.ok !== false, models: data.models ?? [], version: data.ollama?.version ?? null, error: null };
  } catch (error) {
    return { reachable: false, models: [], version: null, error: error instanceof Error ? error.message.slice(0, 200) : 'unreachable' };
  }
}

// ---- Mem0 sidecar ----

export const MEM0_OPS = ['health', 'extract', 'search', 'upsert', 'delete', 'list'] as const;
export type Mem0Op = (typeof MEM0_OPS)[number];

export async function mem0Call(op: Mem0Op, body: Record<string, unknown>, timeoutMs = 60_000): Promise<Record<string, unknown>> {
  return guarded('mem0', async () => {
    const base = devUrl('MEMORY_MEM0_URL');
    if (base) return check('mem0', await direct(base, `/${op}`, body, timeoutMs));
    return check('mem0', await viaGateway(`POST /lab/mem0/${op}` as LabPath, body, timeoutMs + 5_000, 'mem0'));
  });
}

// True when the Ollama path in use is the development override (shown in Providers)
export const usingDevOverride = () => ({ ollama: devUrl('MEMORY_OLLAMA_URL') !== null, mem0: devUrl('MEMORY_MEM0_URL') !== null });
