// RacingCoach local AI gateway and heartbeat agent, run on the Mac that serves local models (docs/local-ai.md).
//
//   node local-ai/gateway.ts                 run the gateway and send heartbeats (Ctrl+C stops both)
//   node local-ai/gateway.ts dev on|off|status   the development switch: on, the gateway refuses new requests and
//                                            the heartbeat says so, so the website sends everything to the cloud
//   node local-ai/gateway.ts heartbeat       send one heartbeat now and print the website's answer
//   node local-ai/gateway.ts secret          print a new random shared secret
//
// The gateway listens on 127.0.0.1 only; Cloudflare Tunnel (cloudflared) brings https://ai.<domain> to it, and
// Cloudflare Access lets only the website's service token through. It accepts exactly two requests, both signed
// with LOCAL_AI_SHARED_SECRET (src/lib/localAi/signing.ts): GET /health and POST /v1/chat/completions for an allowed
// model, without streaming. Ollama's own API (pulling, deleting and copying models, its files) is never reachable
// from outside: Ollama stays on 127.0.0.1:11434 and only this script talks to it. At most LOCAL_AI_MAX_CONCURRENCY
// generations run at once; another is refused straight away (503 local_busy), and the website sends it to the
// cloud, rather than queueing without end.
//
// Settings come from the environment, or local-ai/.env (git-ignored; see local-ai/.env.example). No npm packages:
// Node 22.18 or later runs this TypeScript file directly.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { freemem, homedir, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NonceCache, secretUsable, signRequest, verifyRequest } from '../src/lib/localAi/signing.ts';

const AGENT_VERSION = '1.0.0';

// ---- Settings ----

const here = dirname(fileURLToPath(import.meta.url));
const envFile = process.env.LOCAL_AI_ENV_FILE ?? join(here, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trimStart().startsWith('#')) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

const env = (name: string, fallback: string) => process.env[name]?.trim() || fallback;
const config = {
  secret: process.env.LOCAL_AI_SHARED_SECRET ?? '',
  serverId: env('LOCAL_AI_SERVER_ID', 'macbook-pro'),
  heartbeatUrl: env('LOCAL_AI_HEARTBEAT_URL', ''),
  host: env('LOCAL_AI_GATEWAY_HOST', '127.0.0.1'),
  port: Number(env('LOCAL_AI_GATEWAY_PORT', '8787')),
  ollamaUrl: env('OLLAMA_URL', 'http://127.0.0.1:11434').replace(/\/+$/, ''),
  maxConcurrency: Math.max(1, Number(env('LOCAL_AI_MAX_CONCURRENCY', '2'))),
  models: env('LOCAL_AI_MODELS', 'gpt-oss:20b,qwen3:8b')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean),
  maxBodyBytes: Number(env('LOCAL_AI_MAX_BODY_BYTES', String(4 * 1024 * 1024))),
  requestTimeoutMs: Number(env('LOCAL_AI_REQUEST_TIMEOUT_MS', '180000')),
  heartbeatIntervalMs: Number(env('LOCAL_AI_HEARTBEAT_INTERVAL_MS', '10000')),
  devFlag: env('LOCAL_AI_DEV_FLAG', join(homedir(), '.racingcoach-local-ai', 'development')),
};

const developmentMode = () => existsSync(config.devFlag);

const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);

// ---- Commands ----

const command = process.argv[2];
if (command === 'secret') {
  console.log(randomBytes(32).toString('base64url'));
  process.exit(0);
}
if (command === 'dev') {
  const arg = process.argv[3];
  if (arg === 'on') {
    mkdirSync(dirname(config.devFlag), { recursive: true });
    writeFileSync(config.devFlag, `on since ${new Date().toISOString()}\n`);
  } else if (arg === 'off') {
    rmSync(config.devFlag, { force: true });
  }
  console.log(`Development switch: ${developmentMode() ? 'ON (refusing new requests)' : 'off (serving requests)'}`);
  process.exit(0);
}

if (!secretUsable(config.secret)) {
  console.error('LOCAL_AI_SHARED_SECRET must be set (at least 32 characters). Make one with: node local-ai/gateway.ts secret');
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(config.serverId)) {
  console.error('LOCAL_AI_SERVER_ID: lowercase letters, digits and dashes (as registered on the Admin page)');
  process.exit(1);
}

// ---- Ollama ----

async function ollamaJson(path: string, timeoutMs = 2_000): Promise<unknown> {
  const response = await fetch(`${config.ollamaUrl}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Ollama ${path}: HTTP ${response.status}`);
  return response.json();
}

async function ollamaState() {
  try {
    const [tags, ps] = await Promise.all([ollamaJson('/api/tags'), ollamaJson('/api/ps').catch(() => ({ models: [] }))]);
    const names = (value: unknown) =>
      ((value as { models?: { name?: string; model?: string }[] })?.models ?? [])
        .map((m) => m.model ?? m.name ?? '')
        .filter(Boolean);
    return { runtime: 'ok' as const, installed: names(tags), loaded: names(ps) };
  } catch {
    return { runtime: 'down' as const, installed: [] as string[], loaded: [] as string[] };
  }
}

// ---- Gateway ----

const nonces = new NonceCache();
let active = 0;
let shuttingDown = false;

function send(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store' });
  res.end(text);
}

const refuse = (res: ServerResponse, status: number, type: string, message: string) => send(res, status, { error: { type, message } });

function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// gpt-oss and Qwen3 can put their thinking in <think> tags before the answer; the website wants only the answer
function withoutThinking(body: unknown): unknown {
  const choices = (body as { choices?: { message?: { content?: unknown } }[] })?.choices;
  for (const choice of choices ?? []) {
    if (choice.message && typeof choice.message.content === 'string') {
      choice.message.content = choice.message.content.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, '');
    }
  }
  return body;
}

const authFailures = new Map<string, number>();
function logAuthFailure(reason: string) {
  const now = Date.now();
  if (now - (authFailures.get(reason) ?? 0) < 60_000) return;
  authFailures.set(reason, now);
  log(`Refused a request: signature ${reason}`);
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://gateway');
  const route = `${req.method} ${url.pathname}`;
  if (route !== 'GET /health' && route !== 'POST /v1/chat/completions') return refuse(res, 404, 'not_found', 'Not found');

  const body = await readBody(req, config.maxBodyBytes);
  if (body === null) return refuse(res, 413, 'too_large', 'Request too large');
  const verdict = verifyRequest(config.secret, 'inference', { method: req.method ?? 'GET', path: url.pathname, body }, req.headers, nonces);
  if (!verdict.ok) {
    logAuthFailure(verdict.reason);
    return refuse(res, 401, 'unauthorized', 'Unauthorized');
  }

  if (route === 'GET /health') {
    const state = await ollamaState();
    return send(res, 200, {
      ok: state.runtime === 'ok',
      serverId: config.serverId,
      agentVersion: AGENT_VERSION,
      runtime: state.runtime,
      allowedModels: config.models,
      installedModels: state.installed,
      loadedModels: state.loaded,
      activeRequests: active,
      maxConcurrency: config.maxConcurrency,
      developmentMode: developmentMode(),
    });
  }

  let request: Record<string, unknown>;
  try {
    request = JSON.parse(body);
  } catch {
    return refuse(res, 400, 'bad_request', 'Not JSON');
  }
  if (typeof request.model !== 'string' || !config.models.includes(request.model)) {
    return refuse(res, 400, 'model_not_allowed', 'Model not allowed');
  }
  if (request.stream) return refuse(res, 400, 'stream_not_supported', 'Streaming is not supported');
  if (shuttingDown || developmentMode()) return refuse(res, 503, 'local_development', 'Not accepting requests (development)');
  if (active >= config.maxConcurrency) return refuse(res, 503, 'local_busy', 'All local slots are in use');

  active += 1;
  const started = Date.now();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), config.requestTimeoutMs);
  // The website gave up (its timeout, or the visitor left): stop generating
  res.on('close', () => {
    if (!res.writableFinished) abort.abort();
  });
  try {
    const upstream = await fetch(`${config.ollamaUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...request, stream: false }),
      signal: abort.signal,
    });
    const text = await upstream.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return refuse(res, 502, 'runtime_error', `Ollama answered HTTP ${upstream.status} without JSON`);
    }
    send(res, upstream.status, upstream.ok ? withoutThinking(parsed) : parsed);
    log(`${request.model}: HTTP ${upstream.status} in ${Date.now() - started} ms (${active} active)`);
  } catch (error) {
    if (!res.headersSent) refuse(res, 502, 'runtime_error', abort.signal.aborted ? 'Canceled or timed out' : `Ollama: ${(error as Error).message}`);
    log(`${request.model}: failed after ${Date.now() - started} ms: ${(error as Error).message}`);
  } finally {
    clearTimeout(timer);
    active -= 1;
  }
}

// ---- Heartbeat ----

// Memory the models could still use. On macOS os.freemem() counts only truly free pages (often a few hundred MB on a
// busy Mac), so add the inactive and speculative pages the system hands back on demand, from vm_stat
function availableMemoryBytes(): number {
  if (process.platform !== 'darwin') return freemem();
  try {
    const text = execFileSync('/usr/bin/vm_stat', { encoding: 'utf8', timeout: 1000 });
    const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1] ?? 16384);
    const pages = (name: string) => Number(new RegExp(`Pages ${name}:\\s+(\\d+)`).exec(text)?.[1] ?? 0);
    return (pages('free') + pages('inactive') + pages('speculative')) * pageSize;
  } catch {
    return freemem();
  }
}

let lastHeartbeatState = '';

async function sendHeartbeat(accepting = !shuttingDown && !developmentMode()): Promise<{ status: number; body: string } | null> {
  if (!config.heartbeatUrl) return null;
  const state = await ollamaState();
  const body = JSON.stringify({
    serverId: config.serverId,
    sentAt: Date.now(),
    agentVersion: AGENT_VERSION,
    runtime: state.runtime,
    installedModels: state.installed.filter((m) => config.models.includes(m)),
    loadedModels: state.loaded.filter((m) => config.models.includes(m)),
    activeRequests: active,
    maxConcurrency: config.maxConcurrency,
    queueDepth: 0,
    freeMemoryBytes: availableMemoryBytes(),
    totalMemoryBytes: totalmem(),
    accepting: accepting && state.runtime === 'ok',
    developmentMode: developmentMode(),
  });
  const url = new URL(config.heartbeatUrl);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...signRequest(config.secret, 'heartbeat', { method: 'POST', path: url.pathname, body }) },
    body,
    signal: AbortSignal.timeout(5_000),
  });
  const text = await response.text();
  const summary = `HTTP ${response.status} ${text.slice(0, 200)} (Ollama ${state.runtime}, models ${state.installed.join(', ') || 'none'})`;
  if (summary !== lastHeartbeatState) {
    log(`Heartbeat: ${summary}`);
    lastHeartbeatState = summary;
  }
  return { status: response.status, body: text };
}

if (command === 'heartbeat') {
  if (!config.heartbeatUrl) {
    console.error('LOCAL_AI_HEARTBEAT_URL is not set');
    process.exit(1);
  }
  const result = await sendHeartbeat().catch((error: Error) => ({ status: 0, body: error.message }));
  console.log(result);
  process.exit(result && result.status === 200 ? 0 : 1);
}

// ---- Run ----

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    log(`Gateway error: ${(error as Error).message}`);
    if (!res.headersSent) refuse(res, 500, 'internal', 'Internal error');
  });
});
server.requestTimeout = config.requestTimeoutMs + 10_000;
server.listen(config.port, config.host, () => {
  log(`RacingCoach local AI gateway ${AGENT_VERSION} on http://${config.host}:${config.port} as ${config.serverId}`);
  log(`Models: ${config.models.join(', ')}; ${config.maxConcurrency} at a time; development switch ${developmentMode() ? 'ON' : 'off'}`);
  if (!config.heartbeatUrl) log('LOCAL_AI_HEARTBEAT_URL is not set: no heartbeats, so the website treats this server as offline');
});

const beat = () =>
  sendHeartbeat().catch((error: Error) => {
    const summary = `failed: ${error.message}`;
    if (summary !== lastHeartbeatState) {
      log(`Heartbeat ${summary}`);
      lastHeartbeatState = summary;
    }
  });
void beat();
const interval = setInterval(beat, config.heartbeatIntervalMs);

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal}: telling the website this server is stopping, then finishing ${active} request(s)`);
  clearInterval(interval);
  // One last heartbeat saying not accepting, so the website stops routing here at once rather than in 30 s
  await sendHeartbeat(false).catch(() => {});
  server.close();
  const deadline = Date.now() + 15_000;
  while (active > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 200));
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
