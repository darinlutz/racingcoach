// The Mac's gateway and heartbeat (local-ai/gateway.ts) end to end, with a stand-in for Ollama's API and for the
// website's heartbeat route, on this computer only: what it lets through, what it refuses, its concurrency limit,
// the development switch, its heartbeats' signatures, and the website's own local model client
// (src/lib/localAi/localModel.ts, the OpenAI SDK through LangChain) talking to it. Run with: npm run test:local-ai
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { HumanMessage } from '@langchain/core/messages';
import { localChatModel } from '../src/lib/localAi/localModel.ts';
import { NonceCache, signRequest, verifyRequest } from '../src/lib/localAi/signing.ts';

const SECRET = 'test-secret-'.padEnd(48, 'z');
const dir = mkdtempSync(join(tmpdir(), 'local-ai-gateway-'));
const devFlag = join(dir, 'development');
let ollamaDelayMs = 0;
let ollamaRequests = [];
const heartbeats = [];
let gateway;
let gatewayUrl;
let ollamaServer;
let heartbeatServer;

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const read = (req) =>
  new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });

before(async () => {
  // Ollama's API, as much of it as the gateway uses
  ollamaServer = createServer(async (req, res) => {
    const body = await read(req);
    const json = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (req.url === '/api/tags') return json(200, { models: [{ name: 'qwen3:8b', model: 'qwen3:8b' }, { name: 'llama3:70b', model: 'llama3:70b' }] });
    if (req.url === '/api/ps') return json(200, { models: [{ name: 'qwen3:8b', model: 'qwen3:8b' }] });
    if (req.url === '/v1/chat/completions') {
      const request = JSON.parse(body);
      ollamaRequests.push(request);
      await new Promise((r) => setTimeout(r, ollamaDelayMs));
      const wantsTool = request.tools?.length && request.messages.at(-1).content.includes('tool');
      return json(200, {
        id: 'chatcmpl-1',
        object: 'chat.completion',
        created: 1,
        model: request.model,
        choices: [
          {
            index: 0,
            finish_reason: wantsTool ? 'tool_calls' : 'stop',
            message: wantsTool
              ? { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_lap', arguments: '{"lap":3}' } }] }
              : { role: 'assistant', content: '<think>Brake bias moves...</think>Moving bias rearward helps rotation.' },
          },
        ],
        usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
      });
    }
    json(404, { error: 'not found' });
  });
  const ollamaPort = await listen(ollamaServer);

  // The website's heartbeat route: checks the signature like the real one
  const nonces = new NonceCache();
  heartbeatServer = createServer(async (req, res) => {
    const body = await read(req);
    const verdict = verifyRequest(SECRET, 'heartbeat', { method: 'POST', path: req.url, body }, req.headers, nonces);
    heartbeats.push({ verdict, body: JSON.parse(body) });
    res.writeHead(verdict.ok ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: verdict.ok, mode: 'automatic' }));
  });
  const heartbeatPort = await listen(heartbeatServer);

  const probe = createServer();
  const port = await listen(probe);
  await new Promise((r) => probe.close(r));
  gatewayUrl = `http://127.0.0.1:${port}`;

  const envFile = join(dir, 'empty.env');
  writeFileSync(envFile, '');
  gateway = spawn(process.execPath, ['local-ai/gateway.ts'], {
    env: {
      ...process.env,
      LOCAL_AI_ENV_FILE: envFile,
      LOCAL_AI_SHARED_SECRET: SECRET,
      LOCAL_AI_SERVER_ID: 'test-mac',
      LOCAL_AI_HEARTBEAT_URL: `http://127.0.0.1:${heartbeatPort}/api/local-ai/heartbeat`,
      LOCAL_AI_GATEWAY_PORT: String(port),
      OLLAMA_URL: `http://127.0.0.1:${ollamaPort}`,
      LOCAL_AI_MAX_CONCURRENCY: '2',
      LOCAL_AI_MODELS: 'gpt-oss:20b,qwen3:8b',
      LOCAL_AI_HEARTBEAT_INTERVAL_MS: '200',
      LOCAL_AI_DEV_FLAG: devFlag,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  gateway.stdout.on('data', (c) => (output += c));
  gateway.stderr.on('data', (c) => (output += c));
  for (let i = 0; i < 100 && !output.includes('local AI gateway'); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(output.includes('local AI gateway'), `gateway did not start: ${output}`);
});

after(async () => {
  gateway?.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
  ollamaServer?.close();
  heartbeatServer?.close();
  rmSync(dir, { recursive: true, force: true });
});

const signed = (method, path, body = '') => signRequest(SECRET, 'inference', { method, path, body });
const chatBody = (over = {}) => JSON.stringify({ model: 'qwen3:8b', messages: [{ role: 'user', content: 'hi' }], ...over });
const post = (body, headers = signed('POST', '/v1/chat/completions', body)) =>
  fetch(`${gatewayUrl}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

test('unsigned, wrongly signed and replayed requests are refused', async () => {
  const body = chatBody();
  assert.equal((await post(body, {})).status, 401);
  assert.equal((await post(body, signRequest('w'.repeat(40), 'inference', { method: 'POST', path: '/v1/chat/completions', body }))).status, 401);
  assert.equal((await post(body, signRequest(SECRET, 'heartbeat', { method: 'POST', path: '/v1/chat/completions', body }))).status, 401, 'a heartbeat signature is not an inference one');
  const headers = signed('POST', '/v1/chat/completions', body);
  assert.equal((await post(body, headers)).status, 200);
  assert.equal((await post(body, headers)).status, 401, 'replayed');
});

test("only health and chat completions exist: Ollama's own API is not reachable", async () => {
  for (const [method, path] of [
    ['POST', '/api/pull'],
    ['DELETE', '/api/delete'],
    ['GET', '/api/tags'],
    ['POST', '/api/generate'],
    ['GET', '/v1/models'],
    ['GET', '/../../etc/passwd'],
  ]) {
    const response = await fetch(`${gatewayUrl}${path}`, { method, headers: signed(method, path) });
    assert.equal(response.status, 404, `${method} ${path}`);
  }
});

test('health answers what Ollama has, through a signed request', async () => {
  const response = await fetch(`${gatewayUrl}/health`, { headers: signed('GET', '/health') });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.serverId, 'test-mac');
  assert.equal(body.runtime, 'ok');
  assert.deepEqual(body.loadedModels, ['qwen3:8b']);
});

test('models not on the list and streaming are refused', async () => {
  const notAllowed = await post(chatBody({ model: 'llama3:70b' }));
  assert.equal(notAllowed.status, 400);
  assert.equal((await notAllowed.json()).error.type, 'model_not_allowed');
  const stream = await post(chatBody({ stream: true }));
  assert.equal(stream.status, 400);
});

test('answers come back without the thinking', async () => {
  const response = await post(chatBody());
  const body = await response.json();
  assert.equal(body.choices[0].message.content, 'Moving bias rearward helps rotation.');
});

test('a third request while two run is refused at once as busy', async () => {
  ollamaDelayMs = 400;
  const started = Date.now();
  const results = await Promise.all([post(chatBody()), post(chatBody()), new Promise((r) => setTimeout(r, 100)).then(() => post(chatBody()))]);
  ollamaDelayMs = 0;
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 200, 503]);
  const busy = await results.find((r) => r.status === 503).json();
  assert.equal(busy.error.type, 'local_busy');
  assert.ok(Date.now() - started < 2000);
});

test('heartbeats are signed, verified, and report the server', async () => {
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(heartbeats.length >= 2);
  const last = heartbeats.at(-1);
  assert.deepEqual(last.verdict, { ok: true });
  assert.equal(last.body.serverId, 'test-mac');
  assert.equal(last.body.runtime, 'ok');
  assert.deepEqual(last.body.installedModels, ['qwen3:8b'], 'only allowed models are reported');
  assert.equal(last.body.maxConcurrency, 2);
  assert.equal(last.body.accepting, true);
  assert.equal(last.body.developmentMode, false);
});

test('the development switch refuses new requests and the heartbeat says so', async () => {
  writeFileSync(devFlag, 'on');
  try {
    const response = await post(chatBody());
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.type, 'local_development');
    await new Promise((r) => setTimeout(r, 500));
    const last = heartbeats.at(-1).body;
    assert.equal(last.developmentMode, true);
    assert.equal(last.accepting, false);
  } finally {
    rmSync(devFlag, { force: true });
  }
  assert.equal((await post(chatBody())).status, 200);
});

test("the website's local model client works through the gateway: text, tokens, model and tool calls", async () => {
  process.env.LOCAL_AI_SHARED_SECRET = SECRET;
  ollamaRequests = [];
  const model = localChatModel({ gatewayUrl, model: 'qwen3:8b', temperature: 0.3, maxTokens: 500, timeoutMs: 10_000 });
  const reply = await model.invoke([new HumanMessage('Explain brake bias')]);
  assert.equal(reply.text, 'Moving bias rearward helps rotation.');
  assert.equal(reply.response_metadata.model_name, 'qwen3:8b');
  assert.equal(reply.usage_metadata.input_tokens, 42);
  assert.equal(reply.usage_metadata.output_tokens, 7);
  assert.equal(ollamaRequests[0].model, 'qwen3:8b');

  const withTools = model.bindTools([
    { type: 'function', function: { name: 'get_lap', description: 'A lap', parameters: { type: 'object', properties: { lap: { type: 'number' } } } } },
  ]);
  const call = await withTools.invoke([new HumanMessage('use the tool')]);
  assert.equal(call.tool_calls[0].name, 'get_lap');
  assert.deepEqual(call.tool_calls[0].args, { lap: 3 });
  assert.equal(ollamaRequests.at(-1).tools[0].function.name, 'get_lap');
});

test('a gateway that is down fails fast for the client, so the router can fall back', async () => {
  process.env.LOCAL_AI_SHARED_SECRET = SECRET;
  const model = localChatModel({ gatewayUrl: 'http://127.0.0.1:1', model: 'qwen3:8b', temperature: 0, maxTokens: 50, timeoutMs: 5_000 });
  const started = Date.now();
  await assert.rejects(model.invoke([new HumanMessage('hi')]));
  assert.ok(Date.now() - started < 3000);
});
