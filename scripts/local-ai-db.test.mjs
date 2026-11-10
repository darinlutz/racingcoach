// Local AI against a real database (docs/local-ai.md): the schema, the mode switch (Cloud Only by default),
// the heartbeat route (signature, registration, replay), the router with a stand-in gateway (local answers,
// offline fallback, Development mode), the events it writes and the counts AI Inference Monitoring shows.
//   createdb -h 127.0.0.1 racingcoach_localai_test
//   LOCAL_AI_TEST_DATABASE_URL=postgres://127.0.0.1/racingcoach_localai_test npm run test:local-ai
// Skipped without LOCAL_AI_TEST_DATABASE_URL. It drops and recreates the racingcoach schema, so it refuses any
// database that isn't on this computer.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { register } from 'node:module';
import { after, before, describe, test } from 'node:test';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import pg from 'pg';

const url = process.env.LOCAL_AI_TEST_DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname);
const skip = !url ? 'LOCAL_AI_TEST_DATABASE_URL is not set' : !local ? 'refusing a database that is not local' : false;
const SECRET = 'db-test-secret-'.padEnd(48, 'q');

class FakeCloud extends BaseChatModel {
  constructor() {
    super({});
    this.calls = 0;
  }
  _llmType() {
    return 'fake-cloud';
  }
  async _generate() {
    this.calls += 1;
    const message = new AIMessage({
      content: 'Cloud answer',
      response_metadata: { model_name: 'gpt-4o-mini-2024-07-18' },
      usage_metadata: { input_tokens: 1000, output_tokens: 200, total_tokens: 1200 },
    });
    return { generations: [{ text: message.text, message }] };
  }
}

describe('local AI with a database', { skip }, () => {
  let client, store, router, state, report, signing, heartbeatRoute, gateway, gatewayUrl;
  const q = async (sql, params) => (await client.query(sql, params)).rows;
  const events = () => q('SELECT * FROM racingcoach."AiInferenceEvents" ORDER BY started_at, attempt');
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

  before(async () => {
    process.env.DATABASE_URL = url;
    process.env.LOCAL_AI_SHARED_SECRET = SECRET;
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('DROP SCHEMA IF EXISTS racingcoach CASCADE');
    register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
    const src = new URL('../src/lib/localAi/', import.meta.url);
    store = await import(new URL('store.ts', src).href);
    router = await import(new URL('router.ts', src).href);
    state = await import(new URL('state.ts', src).href);
    report = await import(new URL('report.ts', src).href);
    signing = await import(new URL('signing.ts', src).href);
    heartbeatRoute = await import(new URL('../src/app/api/local-ai/heartbeat/route.ts', import.meta.url).href);
    await store.ensureLocalAiSchema();
    const [{ id }] = await q(
      `INSERT INTO racingcoach."Users" (user_name, email_address, password, role) VALUES ('Admin', 'admin@example.test', 'x', 'Admin') RETURNING id`
    );
    globalThis.adminId = Number(id);

    // A stand-in gateway: checks the signature like the real one and answers as Ollama would
    const nonces = new signing.NonceCache();
    gateway = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const ok = signing.verifyRequest(SECRET, 'inference', { method: req.method, path: req.url, body }, req.headers, nonces).ok;
        res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify(
            ok
              ? {
                  id: 'x',
                  object: 'chat.completion',
                  created: 1,
                  model: 'gpt-oss:20b',
                  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Local answer' } }],
                  usage: { prompt_tokens: 900, completion_tokens: 150, total_tokens: 1050 },
                }
              : { error: { type: 'unauthorized' } }
          )
        );
      });
    });
    await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
    gatewayUrl = `http://127.0.0.1:${gateway.address().port}`;
  });

  after(async () => {
    gateway?.close();
    await client?.end();
    const db = await import(new URL('../src/lib/db.ts', import.meta.url).href).catch(() => null);
    await db?.closePool?.();
  });

  test('a new deployment is Cloud Only, and features route only once Automatic', async () => {
    assert.equal((await store.getLocalAiSettings()).mode, 'cloudOnly');
    assert.deepEqual(await router.localRouteFor('lapSummary'), { kind: 'cloud', reason: 'cloudOnlyMode' });
    await store.saveLocalAiSettings({ ...(await store.getLocalAiSettings()), mode: 'automatic' }, globalThis.adminId);
    assert.equal((await router.localRouteFor('lapSummary')).kind, 'routed');
    assert.deepEqual(await router.localRouteFor('debriefCoach'), { kind: 'cloud', reason: 'notMapped' });
    await store.saveLocalAiSettings({ ...(await store.getLocalAiSettings()), mode: 'development' }, globalThis.adminId);
    assert.deepEqual(await router.localRouteFor('lapSummary'), { kind: 'cloud', reason: 'developmentMode' });
    const [row] = await q(`SELECT value FROM racingcoach."SiteSettings" WHERE key = 'local_ai'`);
    assert.equal(JSON.parse(row.value).mode, 'development', 'kept in Postgres, so it survives restarts');
  });

  const heartbeatBody = (over = {}) =>
    JSON.stringify({
      serverId: 'mbp',
      sentAt: Date.now(),
      agentVersion: '1.0.0',
      runtime: 'ok',
      installedModels: ['gpt-oss:20b', 'qwen3:8b'],
      loadedModels: ['gpt-oss:20b'],
      activeRequests: 0,
      maxConcurrency: 2,
      queueDepth: 0,
      freeMemoryBytes: 1e10,
      totalMemoryBytes: 6.4e10,
      accepting: true,
      developmentMode: false,
      ...over,
    });
  const heartbeat = (body, headers = signing.signRequest(SECRET, 'heartbeat', { method: 'POST', path: '/api/local-ai/heartbeat', body })) =>
    heartbeatRoute.POST(new Request('https://racingcoach.app/api/local-ai/heartbeat', { method: 'POST', headers, body }));

  test('the heartbeat route takes only signed heartbeats from registered servers, once each', async () => {
    const body = heartbeatBody();
    assert.equal((await heartbeat(body, {})).status, 401, 'unsigned');
    assert.equal((await heartbeat(body)).status, 403, 'not registered yet');
    await store.saveLocalAiServer({ id: 'mbp', label: 'MacBook Pro', gatewayUrl, enabled: true, maxConcurrency: 2 });
    const headers = signing.signRequest(SECRET, 'heartbeat', { method: 'POST', path: '/api/local-ai/heartbeat', body });
    const ok = await heartbeat(body, headers);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).mode, 'development');
    assert.equal((await heartbeat(body, headers)).status, 401, 'replayed');
    assert.equal(state.liveServer('mbp').heartbeat.loadedModels[0], 'gpt-oss:20b');
    await settle();
    const [row] = await q(`SELECT last_heartbeat_at FROM racingcoach."LocalAiServers" WHERE id = 'mbp'`);
    assert.ok(row.last_heartbeat_at, 'last seen is kept for after a restart');
    const status = await report.readLocalAiStatus();
    assert.equal(status.servers[0].online, true);
  });

  const routed = (cloud) =>
    router.createRoutedModel({
      context: { feature: 'lapSummary', category: 'Gold', source: 'app' },
      temperature: 0.3,
      cloud,
      cloudModelName: 'gpt-4o-mini',
      maxOutputTokens: 500,
      featureTimeoutMs: 10_000,
    });

  test('Development mode sends calls to the cloud (not a fallback)', async () => {
    const cloud = new FakeCloud();
    const reply = await routed(cloud).invoke([new HumanMessage('hi')]);
    assert.equal(reply.text, 'Cloud answer');
    await settle();
    const [event] = await events();
    assert.equal(event.route_reason, 'developmentMode');
    assert.equal(event.is_fallback, false);
  });

  test('Automatic mode with the Mac online: the local model answers', async () => {
    await store.saveLocalAiSettings({ ...(await store.getLocalAiSettings()), mode: 'automatic' }, globalThis.adminId);
    const cloud = new FakeCloud();
    const reply = await routed(cloud).invoke([new HumanMessage('Explain brake bias')]);
    assert.equal(reply.text, 'Local answer');
    assert.equal(cloud.calls, 0);
    await settle();
    const local = (await events()).at(-1);
    assert.equal(local.provider, 'Local');
    assert.equal(local.server_id, 'mbp');
    assert.equal(local.actual_model, 'gpt-oss:20b');
    assert.equal(local.status, 'completed');
    assert.equal(local.input_tokens, 900);
    assert.equal(Number(local.cost_usd), 0);
  });

  test('the Mac goes quiet: after 30 s calls fall back to the cloud, recorded as fallbacks', async () => {
    // Its last heartbeat arrived 31 s ago (server time)
    state.recordHeartbeat(JSON.parse(heartbeatBody()), Date.now() - 31_000);
    const cloud = new FakeCloud();
    const reply = await routed(cloud).invoke([new HumanMessage('hi')]);
    assert.equal(reply.text, 'Cloud answer');
    await settle();
    const last = (await events()).at(-1);
    assert.equal(last.route_reason, 'localOffline');
    assert.equal(last.is_fallback, true);
    assert.ok(Number(last.cost_usd) > 0, 'cloud tokens are priced');
    assert.equal((await report.readLocalAiStatus()).servers[0].online, false);
  });

  test('the gateway fails mid-request: the cloud answers, and both attempts share one request', async () => {
    state.recordHeartbeat(JSON.parse(heartbeatBody()));
    gateway.closeAllConnections();
    await new Promise((resolve) => gateway.close(resolve));
    const reply = await routed(new FakeCloud()).invoke([new HumanMessage('hi')]);
    assert.equal(reply.text, 'Cloud answer');
    await settle();
    const [failedLocal, cloud] = (await events()).slice(-2);
    assert.equal(failedLocal.provider, 'Local');
    assert.equal(failedLocal.status, 'failed');
    assert.equal(cloud.route_reason, 'localFailed');
    assert.equal(cloud.logical_request_id, failedLocal.logical_request_id);
  });

  test('AI Inference Monitoring counts requests once and attempts per model', async () => {
    const { totals, byModel, recent } = await report.readInferenceReport({ range: 'today', timeZone: 'UTC', provider: null, model: null, feature: null });
    // 4 logical requests: development, local, offline fallback, failed-then-cloud
    assert.equal(totals.requests, 4);
    assert.equal(totals.successfulRequests, 4);
    assert.equal(totals.attempts, 5);
    assert.equal(totals.localRequests, 1);
    assert.equal(totals.cloudRequests, 3);
    assert.equal(totals.fallbacks, 2);
    assert.equal(totals.localShare, 0.25);
    const local = byModel.find((row) => row.provider === 'Local');
    assert.deepEqual([local.attempts, local.completed, local.failed], [2, 1, 1]);
    const cloud = byModel.find((row) => row.provider === 'OpenAI');
    assert.equal(cloud.completed, 3);
    assert.deepEqual(cloud.actualModels, ['gpt-4o-mini-2024-07-18']);
    assert.equal(recent.length, 5);
    const onlyLocal = await report.readInferenceReport({ range: 'all', timeZone: 'UTC', provider: 'Local', model: null, feature: null });
    assert.equal(onlyLocal.totals.attempts, 2);
  });

  test('events older than 90 days are purged', async () => {
    await q(`UPDATE racingcoach."AiInferenceEvents" SET started_at = now() - interval '91 days' WHERE provider = 'Local'`);
    assert.equal(await store.purgeOldInferenceEvents(), 2);
  });
});
