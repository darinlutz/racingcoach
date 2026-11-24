// The gateway's AI Lab routes (local-ai/lab.ts) end to end, with stand-ins for Ollama's API, Open WebUI's API and
// Ollama's model registry, on this computer only: the lab signature (a production inference signature is refused),
// what's off unless turned on, streamed and whole generations with their measurements, the context and output caps,
// background downloads with progress, deletion (never a production model), and the Open WebUI calls rebuilt from
// checked fields with the API key kept on the Mac. Run with: npm run test:ai-lab
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { signRequest } from '../src/lib/localAi/signing.ts';

const SECRET = 'lab-test-secret-'.padEnd(48, 'x');
const WEBUI_KEY = 'sk-test-webui-key';
const dir = mkdtempSync(join(tmpdir(), 'ai-lab-gateway-'));
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const read = (req) =>
  new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });
const json = (res, status, value) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
};

const ollamaCalls = [];
const webuiCalls = [];
let pullRelease = null;
let servers = [];
const gateways = [];

async function startGateway(extraEnv) {
  const probe = createServer();
  const port = await listen(probe);
  await new Promise((r) => probe.close(r));
  const envFile = join(dir, 'empty.env');
  writeFileSync(envFile, '');
  const child = spawn(process.execPath, ['local-ai/gateway.ts'], {
    env: {
      ...process.env,
      LOCAL_AI_ENV_FILE: envFile,
      LOCAL_AI_SHARED_SECRET: SECRET,
      LOCAL_AI_SERVER_ID: 'test-mac',
      LOCAL_AI_HEARTBEAT_URL: '',
      LOCAL_AI_GATEWAY_PORT: String(port),
      LOCAL_AI_MODELS: 'gpt-oss:20b,qwen3:8b',
      LOCAL_AI_DEV_FLAG: join(dir, 'dev'),
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (c) => (output += c));
  child.stderr.on('data', (c) => (output += c));
  for (let i = 0; i < 100 && !output.includes('AI Lab routes'); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(output.includes('AI Lab routes'), `gateway did not start: ${output}`);
  gateways.push(child);
  return `http://127.0.0.1:${port}`;
}

let labUrl;
let offUrl;
let readOnlyUrl;

const call = async (base, method, path, body, purpose = 'lab') => {
  const text = body === undefined ? '' : JSON.stringify(body);
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(text ? { 'content-type': 'application/json' } : {}), ...signRequest(SECRET, purpose, { method, path, body: text }) },
    body: text || undefined,
  });
  const raw = await response.text();
  let parsed = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // NDJSON
  }
  return { status: response.status, body: parsed, raw, type: response.headers.get('content-type') };
};

before(async () => {
  const ollama = createServer(async (req, res) => {
    const body = await read(req);
    const request = body ? JSON.parse(body) : {};
    ollamaCalls.push({ method: req.method, url: req.url, body: request });
    if (req.url === '/api/version') return json(res, 200, { version: '0.13.0' });
    if (req.url === '/api/tags') {
      return json(res, 200, {
        models: [
          { name: 'qwen3:8b', model: 'qwen3:8b', size: 5_200_000_000, modified_at: '2026-11-01T10:00:00Z', digest: 'abcdef1234567890', details: { family: 'qwen3', parameter_size: '8.2B', quantization_level: 'Q4_K_M', format: 'gguf' } },
          { name: 'gemma3:4b', model: 'gemma3:4b', size: 3_300_000_000, modified_at: '2026-11-02T10:00:00Z', digest: '0123456789abcdef', details: { family: 'gemma3', parameter_size: '4.3B', quantization_level: 'Q4_K_M', format: 'gguf' } },
        ],
      });
    }
    if (req.url === '/api/ps') return json(res, 200, { models: [{ name: 'qwen3:8b', model: 'qwen3:8b', size: 6_000_000_000, size_vram: 6_000_000_000, context_length: 32768, expires_at: '2026-11-24T12:00:00Z' }] });
    if (req.url === '/api/show') {
      if (request.model === 'missing:1b') return json(res, 404, { error: 'model not found' });
      return json(res, 200, {
        parameters: 'num_ctx 16384\ntemperature 0.6',
        details: { family: 'qwen3', parameter_size: '8.2B', quantization_level: 'Q4_K_M' },
        model_info: { 'general.architecture': 'qwen3', 'general.parameter_count': 8_190_735_360, 'qwen3.context_length': 40960 },
        capabilities: ['completion', 'tools', 'thinking'],
      });
    }
    if (req.url === '/api/chat') {
      if (request.model === 'missing:1b') return json(res, 404, { error: "model 'missing:1b' not found" });
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write(`${JSON.stringify({ model: request.model, message: { role: 'assistant', content: 'Brake ' }, done: false })}\n`);
      await new Promise((r) => setTimeout(r, 30));
      res.write(`${JSON.stringify({ model: request.model, message: { role: 'assistant', content: 'later.' }, done: false })}\n`);
      res.end(`${JSON.stringify({ model: request.model, message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 21, eval_count: 40, eval_duration: 2_000_000_000, load_duration: 5_000_000, prompt_eval_duration: 10_000_000 })}\n`);
      return;
    }
    if (req.url === '/api/generate') return json(res, 200, { model: request.model, done: true });
    if (req.url === '/api/delete') return request.model === 'gemma3:4b' ? json(res, 200, {}) : json(res, 404, { error: 'not found' });
    if (req.url === '/api/pull') {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write(`${JSON.stringify({ status: 'pulling manifest' })}\n`);
      res.write(`${JSON.stringify({ status: 'pulling abc', total: 1000, completed: 250 })}\n`);
      await new Promise((r) => (pullRelease = r));
      res.write(`${JSON.stringify({ status: 'pulling abc', total: 1000, completed: 1000 })}\n`);
      res.end(`${JSON.stringify({ status: 'success' })}\n`);
      return;
    }
    json(res, 404, { error: 'not found' });
  });

  const webui = createServer(async (req, res) => {
    const body = await read(req);
    webuiCalls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
    if (req.url === '/health') return json(res, 200, { status: true });
    if (req.url === '/api/version') return json(res, 200, { version: '0.13.4' });
    if (req.headers.authorization !== `Bearer ${WEBUI_KEY}`) return json(res, 401, { detail: 'Not authenticated' });
    if (req.url === '/api/v1/memories/') return json(res, 200, [{ id: 'mem-1', user_id: 'u', content: 'I drive the Porsche 992 Cup', type: 'context', created_at: 1, updated_at: 2 }]);
    if (req.url === '/api/v1/memories/add') return json(res, 200, { id: 'mem-2', user_id: 'u', content: JSON.parse(body).content, created_at: 3, updated_at: 3 });
    if (req.url === '/api/v1/memories/query') return json(res, 200, { ids: [['mem-1']], documents: [['I drive the Porsche 992 Cup']], distances: [[0.21]] });
    if (req.url === '/api/v1/memories/mem-1/update') return json(res, 200, { id: 'mem-1', user_id: 'u', content: JSON.parse(body).content, created_at: 1, updated_at: 4 });
    if (req.url === '/api/v1/memories/mem-1' && req.method === 'DELETE') return json(res, 200, true);
    if (req.url === '/api/v1/knowledge/?page=1') return json(res, 200, { items: [{ id: 'kb-1', name: 'Race engineering', description: 'Vehicle dynamics', files: [{}, {}], updated_at: 5 }], total: 1 });
    if (req.url === '/api/v1/knowledge/create') return json(res, 200, { id: 'kb-2' });
    if (req.url === '/api/v1/models/list?page=1') return json(res, 200, { items: [{ id: 'racingcoach-race-engineer', name: 'RacingCoach Race Engineer', base_model_id: 'qwen3:8b', meta: { description: 'x', racingcoachKind: 'configuration', knowledge: [{ id: 'kb-1' }] }, params: { system: 'You are' }, is_active: true }] });
    if (req.url === '/api/v1/models/create') return json(res, 200, { id: JSON.parse(body).id });
    if (req.url === '/api/v1/models/model?id=racingcoach-race-engineer') {
      return json(res, 200, { id: 'racingcoach-race-engineer', meta: { knowledge: [{ id: 'kb-1', name: 'Race engineering', type: 'collection' }, { id: 'f-9', name: 'Notes.txt', type: 'file' }, { id: '../bad' }] } });
    }
    if (req.url === '/api/v1/models/model?id=racingcoach-plain') return json(res, 200, { id: 'racingcoach-plain', meta: {} });
    if (req.url === '/api/v1/knowledge/kb-1/files?page=1') return json(res, 200, { items: [{ id: 'file-1', meta: { name: 'BrakeBias.txt' } }] });
    if (req.url === '/api/v1/retrieval/query/collection') {
      return json(res, 200, {
        documents: [['Brake bias sets the front share', 'A note']],
        distances: [[0.77, 0.4]],
        metadatas: [[{ knowledge_id: 'kb-1', file_id: 'file-1', name: 'Untitled.txt' }, { file_id: 'f-9', name: 'Notes.txt' }]],
      });
    }
    json(res, 404, { detail: 'Not Found' });
  });

  const registry = createServer((req, res) => {
    if (req.url === '/v2/library/gemma3/manifests/27b') return json(res, 200, { config: { size: 500 }, layers: [{ size: 17_000_000_000 }, { size: 1000 }] });
    json(res, 404, { errors: [{ code: 'MANIFEST_UNKNOWN' }] });
  });

  servers = [ollama, webui, registry];
  const [ollamaPort, webuiPort, registryPort] = await Promise.all(servers.map(listen));
  const common = { OLLAMA_URL: `http://127.0.0.1:${ollamaPort}`, OLLAMA_REGISTRY_URL: `http://127.0.0.1:${registryPort}` };
  labUrl = await startGateway({
    ...common,
    LOCAL_AI_LAB: 'on',
    LOCAL_AI_LAB_MANAGE: 'on',
    LOCAL_AI_LAB_MAX_CONTEXT: '8192',
    LOCAL_AI_LAB_MAX_OUTPUT: '512',
    OPEN_WEBUI_URL: `http://127.0.0.1:${webuiPort}`,
    OPEN_WEBUI_API_KEY: WEBUI_KEY,
  });
  offUrl = await startGateway(common);
  readOnlyUrl = await startGateway({ ...common, LOCAL_AI_LAB: 'on' });
});

after(async () => {
  pullRelease?.();
  for (const child of gateways) child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
  for (const server of servers) server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('signatures and switches', () => {
  test('unsigned and production-signed lab requests are refused', async () => {
    const unsigned = await fetch(`${labUrl}/lab/status`);
    assert.equal(unsigned.status, 401);
    const asInference = await call(labUrl, 'GET', '/lab/status', undefined, 'inference');
    assert.equal(asInference.status, 401);
  });

  test('a lab signature is refused by the production routes', async () => {
    const health = await call(labUrl, 'GET', '/health', undefined, 'lab');
    assert.equal(health.status, 401);
  });

  test('lab routes answer 404 unless LOCAL_AI_LAB=on', async () => {
    const r = await call(offUrl, 'GET', '/lab/status');
    assert.equal(r.status, 404);
    assert.equal(r.body.error, 'labDisabled');
  });

  test('downloads and deletions need LOCAL_AI_LAB_MANAGE=on', async () => {
    assert.equal((await call(readOnlyUrl, 'POST', '/lab/pull', { name: 'gemma3:27b' })).status, 403);
    assert.equal((await call(readOnlyUrl, 'POST', '/lab/delete', { name: 'gemma3:4b' })).status, 403);
    // Reading still works
    assert.equal((await call(readOnlyUrl, 'GET', '/lab/status')).status, 200);
  });

  test('model names that could be paths or options are refused before reaching Ollama', async () => {
    const before = ollamaCalls.length;
    for (const name of ['../etc/passwd', '-rf', 'a b', 'http://evil/x', 'x//y', 'qwen3:8b:extra', '']) {
      assert.equal((await call(labUrl, 'POST', '/lab/show', { name })).status, 400, name);
    }
    assert.equal(ollamaCalls.length, before);
  });
});

describe('status and models', () => {
  test('status reports Ollama, models with details, loaded models, Open WebUI and limits', async () => {
    const r = await call(labUrl, 'GET', '/lab/status');
    assert.equal(r.status, 200);
    assert.equal(r.body.ollama.ok, true);
    assert.equal(r.body.ollama.version, '0.13.0');
    assert.equal(r.body.models.length, 2);
    assert.deepEqual(
      { family: r.body.models[0].family, size: r.body.models[0].parameterSize, q: r.body.models[0].quantization },
      { family: 'qwen3', size: '8.2B', q: 'Q4_K_M' }
    );
    assert.equal(r.body.loaded[0].vramBytes, 6_000_000_000);
    assert.equal(r.body.loaded[0].contextLength, 32768);
    assert.deepEqual(r.body.openWebui, { configured: true, ok: true, version: '0.13.4', apiKey: true, error: null });
    assert.equal(r.body.lab.maxContext, 8192);
    assert.deepEqual(r.body.production.models, ['gpt-oss:20b', 'qwen3:8b']);
    assert.ok(r.body.uptimeSeconds >= 0);
  });

  test('show gives the model maximum context and the configured num_ctx apart', async () => {
    const r = await call(labUrl, 'POST', '/lab/show', { name: 'qwen3:8b' });
    assert.equal(r.status, 200);
    assert.equal(r.body.contextLength, 40960);
    assert.equal(r.body.configuredNumCtx, 16384);
    assert.deepEqual(r.body.capabilities, ['completion', 'tools', 'thinking']);
  });

  test('load and unload go through generate with keep_alive', async () => {
    assert.equal((await call(labUrl, 'POST', '/lab/load', { name: 'gemma3:4b', keepAlive: '10m' })).status, 200);
    assert.deepEqual(ollamaCalls.at(-1).body, { model: 'gemma3:4b', keep_alive: '10m' });
    assert.equal((await call(labUrl, 'POST', '/lab/unload', { name: 'gemma3:4b' })).status, 200);
    assert.deepEqual(ollamaCalls.at(-1).body, { model: 'gemma3:4b', keep_alive: 0 });
  });

  test('a production model can never be deleted from the lab', async () => {
    const r = await call(labUrl, 'POST', '/lab/delete', { name: 'qwen3:8b' });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'productionModel');
    assert.equal((await call(labUrl, 'POST', '/lab/delete', { name: 'gemma3:4b' })).status, 200);
  });

  test('remote size adds up the registry manifest, and is unknown for other hosts', async () => {
    const r = await call(labUrl, 'POST', '/lab/remote-size', { name: 'gemma3:27b' });
    assert.equal(r.body.sizeBytes, 17_000_001_500);
    assert.equal((await call(labUrl, 'POST', '/lab/remote-size', { name: 'nope:1b' })).status, 404);
    const hf = await call(labUrl, 'POST', '/lab/remote-size', { name: 'hf.co/user/repo:Q4_K_M' });
    assert.equal(hf.body.known, false);
  });

  test('a pull runs in the background with progress, one at a time', async () => {
    const started = await call(labUrl, 'POST', '/lab/pull', { name: 'gemma3:27b' });
    assert.equal(started.status, 202);
    await new Promise((r) => setTimeout(r, 100));
    let pulls = (await call(labUrl, 'GET', '/lab/pulls')).body.pulls;
    assert.equal(pulls[0].completed, 250);
    assert.equal(pulls[0].finishedAt, null);
    assert.equal((await call(labUrl, 'POST', '/lab/pull', { name: 'llama3.2:3b' })).status, 409);
    // The gateway keeps answering while it pulls
    assert.equal((await call(labUrl, 'GET', '/lab/status')).status, 200);
    pullRelease();
    await new Promise((r) => setTimeout(r, 100));
    pulls = (await call(labUrl, 'GET', '/lab/pulls')).body.pulls;
    assert.equal(pulls[0].status, 'success');
    assert.equal(pulls[0].completed, 1000);
    assert.ok(pulls[0].finishedAt);
  });
});

describe('generation', () => {
  test('a whole answer comes back with Ollama\'s counts and the gateway\'s timings', async () => {
    const r = await call(labUrl, 'POST', '/lab/chat', { model: 'qwen3:8b', system: 'Be brief', prompt: 'When do I brake?', params: { temperature: 0.4, topK: 20, seed: 7 } });
    assert.equal(r.status, 200);
    assert.equal(r.body.text, 'Brake later.');
    assert.equal(r.body.metrics.inputTokens, 21);
    assert.equal(r.body.metrics.outputTokens, 40);
    assert.equal(r.body.metrics.tokensPerSecond, 20);
    assert.ok(r.body.metrics.firstTokenMs !== null && r.body.metrics.firstTokenMs <= r.body.metrics.totalMs);
    const sent = ollamaCalls.at(-1).body;
    assert.deepEqual(sent.messages, [{ role: 'system', content: 'Be brief' }, { role: 'user', content: 'When do I brake?' }]);
    assert.equal(sent.options.temperature, 0.4);
    assert.equal(sent.options.top_k, 20);
    assert.equal(sent.options.seed, 7);
  });

  test('context and output are capped by the Mac\'s lab limits', async () => {
    await call(labUrl, 'POST', '/lab/chat', { model: 'qwen3:8b', prompt: 'x', params: { numCtx: 131072, maxTokens: 8000 } });
    const sent = ollamaCalls.at(-1).body;
    assert.equal(sent.options.num_ctx, 8192);
    assert.equal(sent.options.num_predict, 512);
  });

  test('streaming sends tokens as NDJSON, then the measurements', async () => {
    const r = await call(labUrl, 'POST', '/lab/chat', { model: 'qwen3:8b', prompt: 'x', stream: true });
    assert.equal(r.status, 200);
    assert.match(r.type, /ndjson/);
    const lines = r.raw.trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.filter((l) => l.type === 'token').map((l) => l.text), ['Brake ', 'later.']);
    assert.equal(lines.at(-1).type, 'done');
    assert.equal(lines.at(-1).metrics.outputTokens, 40);
  });

  test('a model that is not installed is reported as such', async () => {
    const r = await call(labUrl, 'POST', '/lab/chat', { model: 'missing:1b', prompt: 'x' });
    assert.equal(r.status, 404);
    assert.equal(r.body.error, 'modelNotInstalled');
  });

  test('streamed, headers go out first, so a missing model is an error line rather than a status', async () => {
    const r = await call(labUrl, 'POST', '/lab/chat', { model: 'missing:1b', prompt: 'x', stream: true });
    assert.equal(r.status, 200);
    const lines = r.raw.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines[0].type, 'started');
    assert.deepEqual({ type: lines.at(-1).type, error: lines.at(-1).error }, { type: 'error', error: 'modelNotInstalled' });
  });

  test('an empty or oversized prompt is refused', async () => {
    assert.equal((await call(labUrl, 'POST', '/lab/chat', { model: 'qwen3:8b', prompt: '  ' })).status, 400);
    assert.equal((await call(labUrl, 'POST', '/lab/chat', { model: 'qwen3:8b', prompt: 'x'.repeat(20_001) })).status, 400);
  });
});

describe('Open WebUI', () => {
  test('memories: list, add, query, update, delete with the Mac\'s API key', async () => {
    const list = await call(labUrl, 'GET', '/lab/webui/memories');
    assert.equal(list.body.memories[0].content, 'I drive the Porsche 992 Cup');
    const added = await call(labUrl, 'POST', '/lab/webui/memories', { content: 'My target lap at Spa is 2:18', extra: 'ignored' });
    assert.equal(added.body.memory.id, 'mem-2');
    assert.deepEqual(webuiCalls.at(-1).body, { content: 'My target lap at Spa is 2:18' });
    assert.equal(webuiCalls.at(-1).auth, `Bearer ${WEBUI_KEY}`);
    const found = await call(labUrl, 'POST', '/lab/webui/memories/query', { content: 'What car?', k: 50 });
    assert.deepEqual(found.body.results, [{ id: 'mem-1', content: 'I drive the Porsche 992 Cup', distance: 0.21 }]);
    assert.equal(webuiCalls.at(-1).body.k, 10);
    assert.equal((await call(labUrl, 'POST', '/lab/webui/memories/update', { id: 'mem-1', content: 'Porsche 992 GT3 R' })).body.memory.content, 'Porsche 992 GT3 R');
    assert.equal((await call(labUrl, 'POST', '/lab/webui/memories/delete', { id: 'mem-1' })).body.deleted, true);
  });

  test('IDs that could change the path are refused', async () => {
    const before = webuiCalls.length;
    assert.equal((await call(labUrl, 'POST', '/lab/webui/memories/delete', { id: '../models/delete' })).status, 400);
    assert.equal((await call(labUrl, 'POST', '/lab/webui/memories/update', { id: 'a/b', content: 'x' })).status, 400);
    assert.equal(webuiCalls.length, before);
  });

  test('knowledge bases and model configurations', async () => {
    const kb = await call(labUrl, 'GET', '/lab/webui/knowledge');
    assert.deepEqual(kb.body.knowledge[0], { id: 'kb-1', name: 'Race engineering', description: 'Vehicle dynamics', files: 2, updatedAt: 5 });
    assert.equal((await call(labUrl, 'POST', '/lab/webui/knowledge', { name: 'Telemetry', description: '' })).body.id, 'kb-2');
    const models = await call(labUrl, 'GET', '/lab/webui/models');
    assert.equal(models.body.models[0].kind, 'configuration');
    assert.equal(models.body.models[0].knowledge, 1);
    const created = await call(labUrl, 'POST', '/lab/webui/models', {
      id: 'racingcoach-driving-coach',
      baseModelId: 'qwen3:8b',
      name: 'RacingCoach Driving Coach',
      description: 'Coach',
      system: 'You are a coach',
      params: { temperature: 0.4, bogus: 1 },
    });
    assert.equal(created.status, 200);
    const sent = webuiCalls.at(-1).body;
    assert.equal(sent.base_model_id, 'qwen3:8b');
    assert.equal(sent.meta.racingcoachKind, 'configuration');
    assert.deepEqual(sent.params, { system: 'You are a coach', temperature: 0.4 });
  });

  test("a configuration's knowledge search takes its collections from the configuration, never the request", async () => {
    const found = await call(labUrl, 'POST', '/lab/webui/models/knowledge-query', {
      id: 'racingcoach-race-engineer',
      query: 'Mid-corner understeer',
      k: 50,
      collection_names: ['someone-elses-kb'],
    });
    assert.equal(found.status, 200);
    const search = webuiCalls.find((c) => c.url === '/api/v1/retrieval/query/collection');
    assert.deepEqual(search.body, { collection_names: ['kb-1', 'file-f-9'], query: 'Mid-corner understeer', k: 10 });
    assert.deepEqual(found.body.knowledge, ['Race engineering', 'Notes.txt']);
    // Named from the knowledge base's file list, not the name it was indexed under
    assert.deepEqual(found.body.results[0], { content: 'Brake bias sets the front share', source: 'BrakeBias.txt', knowledge: 'Race engineering', score: 0.77 });
    assert.equal(found.body.results[1].knowledge, 'Notes.txt');
    // No knowledge: no search at all
    const before = webuiCalls.length;
    assert.deepEqual((await call(labUrl, 'POST', '/lab/webui/models/knowledge-query', { id: 'racingcoach-plain', query: 'x' })).body, { results: [], knowledge: [] });
    assert.equal(webuiCalls.slice(before).some((c) => c.url.startsWith('/api/v1/retrieval')), false);
    assert.equal((await call(labUrl, 'POST', '/lab/webui/models/knowledge-query', { id: '../x', query: 'x' })).status, 400);
    assert.equal((await call(labUrl, 'POST', '/lab/webui/models/knowledge-query', { id: 'racingcoach-plain', query: '' })).status, 400);
  });

  test('unknown Open WebUI routes are not passed through', async () => {
    const before = webuiCalls.length;
    assert.equal((await call(labUrl, 'POST', '/lab/webui/users/delete', {})).status, 404);
    // fetch normalizes the dots away, so this reaches /api/v1/auths, which the gateway doesn't serve at all
    assert.equal((await call(labUrl, 'GET', '/lab/webui/../../api/v1/auths')).status, 404);
    assert.equal(webuiCalls.length, before);
  });
});
