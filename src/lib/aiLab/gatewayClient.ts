import { localAiSecret, cloudflareAccessHeaders } from '@/lib/localAi/localModel';
import { signRequest } from '@/lib/localAi/signing';
import { listLocalAiServers, type LocalAiServer } from '@/lib/localAi/store';

// The website's side of the gateway's AI Lab routes (local-ai/lab.ts; docs/AI_LAB_SETUP.md). Requests go only to a
// server an Admin registered in Local AI Server Mode (its https gateway URL, checked when it was saved), only to the
// paths below, signed with the 'lab' purpose and carrying the Cloudflare Access service token, all on this server:
// no secret, gateway URL or Ollama/Open WebUI address ever reaches a browser, and a browser can't choose where a
// request goes (no SSRF). Status is cached a few seconds, and an unreachable Mac is asked again only after a pause,
// so a closed laptop costs one failed request every 15 s, not one per page refresh.

export const LAB_PATHS = [
  'GET /lab/status',
  'GET /lab/pulls',
  'POST /lab/show',
  'POST /lab/chat',
  'POST /lab/load',
  'POST /lab/unload',
  'POST /lab/remote-size',
  'POST /lab/pull',
  'POST /lab/pull/cancel',
  'POST /lab/delete',
  'GET /lab/webui/memories',
  'POST /lab/webui/memories',
  'POST /lab/webui/memories/update',
  'POST /lab/webui/memories/delete',
  'POST /lab/webui/memories/query',
  'GET /lab/webui/knowledge',
  'POST /lab/webui/knowledge',
  'GET /lab/webui/models',
  'POST /lab/webui/models',
  'POST /lab/webui/models/knowledge-query',
] as const;
export type LabPath = (typeof LAB_PATHS)[number];

export class LabUnavailableError extends Error {
  constructor(public reason: 'noServer' | 'noSecret' | 'unreachable', message: string) {
    super(message);
    this.name = 'LabUnavailableError';
  }
}

// The registered server the lab talks to: the one asked for, else the first registered. Production's Enabled switch
// doesn't apply: turning a server off for production routing leaves the lab working (LOCAL_AI_LAB on the Mac is the
// lab's own switch).
export async function labServer(serverId?: string | null): Promise<LocalAiServer> {
  const servers = await listLocalAiServers();
  const server = serverId ? servers.find((s) => s.id === serverId) : servers[0];
  if (!server) throw new LabUnavailableError('noServer', 'No local AI server is registered');
  return server;
}

export type LabResponse = { status: number; body: Record<string, unknown> };

export async function labRequest(
  server: LocalAiServer,
  route: LabPath,
  body?: Record<string, unknown>,
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<Response> {
  const secret = localAiSecret();
  if (!secret) throw new LabUnavailableError('noSecret', 'LOCAL_AI_SHARED_SECRET is not configured');
  const [method, path] = route.split(' ') as ['GET' | 'POST', string];
  const text = method === 'POST' ? JSON.stringify(body ?? {}) : '';
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? 15_000)])
    : AbortSignal.timeout(options.timeoutMs ?? 15_000);
  try {
    return await fetch(`${server.gatewayUrl}${path}`, {
      method,
      headers: {
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        ...signRequest(secret, 'lab', { method, path, body: text }),
        ...cloudflareAccessHeaders(),
      },
      body: method === 'POST' ? text : undefined,
      signal,
      redirect: 'error',
      cache: 'no-store',
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new LabUnavailableError('unreachable', error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : 'Unreachable');
  }
}

// A JSON answer. Cloudflare's own pages (Access refusing the token, the tunnel down) aren't JSON: they're reported
// as the HTTP status with a short reason, so the page can say which layer failed.
export async function labJson(server: LocalAiServer, route: LabPath, body?: Record<string, unknown>, timeoutMs?: number): Promise<LabResponse> {
  const response = await labRequest(server, route, body, { timeoutMs });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
  } catch {
    const layer = response.status === 403 ? 'cloudflareAccess' : response.status === 502 || response.status === 530 ? 'tunnel' : 'notJson';
    return { status: response.status, body: { error: layer, detail: text.slice(0, 200) } };
  }
}

// ---- Status, cached ----

export type LabStatus =
  | { reachable: true; checkedAt: number; latencyMs: number; serverId: string; data: Record<string, unknown> }
  | { reachable: false; checkedAt: number; serverId: string | null; reason: string; detail: string | null };

const OK_CACHE_MS = 5_000;
const FAIL_CACHE_MS = 15_000;
const cache = new Map<string, LabStatus>();
let lastSuccessAt: number | null = null;
let lastError: { at: number; reason: string; detail: string | null } | null = null;

export const labHistory = () => ({ lastSuccessAt, lastError });

export async function labStatus(serverId?: string | null, fresh = false): Promise<LabStatus> {
  let server: LocalAiServer;
  try {
    server = await labServer(serverId);
  } catch (error) {
    return { reachable: false, checkedAt: Date.now(), serverId: null, reason: error instanceof LabUnavailableError ? error.reason : 'error', detail: null };
  }
  const cached = cache.get(server.id);
  if (!fresh && cached && Date.now() - cached.checkedAt < (cached.reachable ? OK_CACHE_MS : FAIL_CACHE_MS)) return cached;
  const started = performance.now();
  let result: LabStatus;
  try {
    const { status, body } = await labJson(server, 'GET /lab/status', undefined, 8_000);
    result =
      status === 200
        ? { reachable: true, checkedAt: Date.now(), latencyMs: Math.round(performance.now() - started), serverId: server.id, data: body }
        : { reachable: false, checkedAt: Date.now(), serverId: server.id, reason: String(body.error ?? `http${status}`), detail: typeof body.detail === 'string' ? body.detail : `HTTP ${status}` };
  } catch (error) {
    result = {
      reachable: false,
      checkedAt: Date.now(),
      serverId: server.id,
      reason: error instanceof LabUnavailableError ? error.reason : 'error',
      detail: error instanceof Error ? error.message.slice(0, 300) : null,
    };
  }
  if (result.reachable) lastSuccessAt = result.checkedAt;
  else lastError = { at: result.checkedAt, reason: result.reason, detail: result.detail };
  cache.set(server.id, result);
  return result;
}

export function forgetLabStatus() {
  cache.clear();
}
