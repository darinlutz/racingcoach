// The AI Lab against a real database (docs/AI_LAB_SETUP.md): the schema (including AiInferenceEvents' source check
// on a table made before the lab existed), settings, saved prompts and results, the audit log (and what deleting
// an account does to it), the day's lab cloud spend and the budget refusals, and a local playground run end to end
// through a stand-in gateway that checks the 'lab' signature, recorded as an aiLab inference event.
//   createdb -h 127.0.0.1 racingcoach_ailab_test
//   AI_LAB_TEST_DATABASE_URL=postgres://127.0.0.1/racingcoach_ailab_test npm run test:ai-lab
// Skipped without AI_LAB_TEST_DATABASE_URL. It drops and recreates the racingcoach schema, so it refuses any
// database that isn't on this computer.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { register } from 'node:module';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';

const url = process.env.AI_LAB_TEST_DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname);
const skip = !url ? 'AI_LAB_TEST_DATABASE_URL is not set' : !local ? 'refusing a database that is not local' : false;
const SECRET = 'ailab-db-secret-'.padEnd(48, 'w');

describe('AI Lab with a database', { skip }, () => {
  let client, store, localStore, playground, signing, gateway, adminId;
  const q = async (sql, params) => (await client.query(sql, params)).rows;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
  const labCalls = [];

  before(async () => {
    process.env.DATABASE_URL = url;
    process.env.LOCAL_AI_SHARED_SECRET = SECRET;
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('DROP SCHEMA IF EXISTS racingcoach CASCADE');
    register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
    localStore = await import(new URL('../src/lib/localAi/store.ts', import.meta.url).href);
    signing = await import(new URL('../src/lib/localAi/signing.ts', import.meta.url).href);

    // AiInferenceEvents as deployments before the AI Lab have it: source allows only app and testConsole
    await localStore.ensureLocalAiSchema();
    await client.query(`ALTER TABLE racingcoach."AiInferenceEvents" DROP CONSTRAINT "AiInferenceEvents_source_check"`);
    await client.query(`ALTER TABLE racingcoach."AiInferenceEvents" ADD CONSTRAINT "AiInferenceEvents_source_check" CHECK (source IN ('app', 'testConsole'))`);
    delete globalThis.localAiSchema;

    store = await import(new URL('../src/lib/aiLab/store.ts', import.meta.url).href);
    playground = await import(new URL('../src/lib/aiLab/playground.ts', import.meta.url).href);
    await store.ensureAiLabSchema();
    const [{ id }] = await q(
      `INSERT INTO racingcoach."Users" (user_name, email_address, password, role) VALUES ('Admin', 'lab-admin@example.test', 'x', 'Admin') RETURNING id`
    );
    adminId = Number(id);

    // A stand-in gateway: checks the lab signature, streams NDJSON like local-ai/lab.ts
    const nonces = new signing.NonceCache();
    gateway = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const ok = signing.verifyRequest(SECRET, 'lab', { method: req.method, path: req.url, body }, req.headers, nonces).ok;
        labCalls.push({ url: req.url, ok, body: body ? JSON.parse(body) : null });
        if (!ok) {
          res.writeHead(401, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: { type: 'unauthorized' } }));
        }
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.write(`${JSON.stringify({ type: 'token', text: 'Trail ' })}\n`);
        res.write(`${JSON.stringify({ type: 'token', text: 'brake.' })}\n`);
        res.end(
          `${JSON.stringify({ type: 'done', metrics: { actualModel: 'gemma3:4b', firstTokenMs: 40, inputTokens: 12, outputTokens: 30, tokensPerSecond: 55.5, doneReason: 'stop', params: { temperature: 0.2 } } })}\n`
        );
      });
    });
    await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
    await localStore.saveLocalAiServer({ id: 'test-mac', label: 'Test Mac', gatewayUrl: `http://127.0.0.1:${gateway.address().port}`, enabled: false, maxConcurrency: 2 });
  });

  after(async () => {
    gateway?.close();
    await client?.end();
    const db = await import(new URL('../src/lib/db.ts', import.meta.url).href).catch(() => null);
    await db?.closePool?.();
  });

  test("the inference events' source check is brought up to date once, keeping the old values", async () => {
    const [{ def }] = await q(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'AiInferenceEvents_source_check'`);
    assert.match(def, /aiLab/);
    assert.match(def, /testConsole/);
    // Running it again changes nothing
    delete globalThis.aiLabSchema;
    delete globalThis.localAiSchema;
    await store.ensureAiLabSchema();
    assert.equal((await q(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'AiInferenceEvents_source_check'`))[0].n, 1);
  });

  test('settings round trip, cleaned', async () => {
    assert.equal((await store.getAiLabSettings()).dailyCloudBudgetUsd, 2);
    await store.saveAiLabSettings({ openWebuiUrl: 'https://ai-lab.example.test', dailyCloudBudgetUsd: 3, defaultModel: 'qwen3:8b', modelParams: { 'qwen3:8b': { temperature: 0.4, bogus: 1 } } }, adminId);
    const s = await store.getAiLabSettings();
    assert.equal(s.openWebuiUrl, 'https://ai-lab.example.test');
    assert.deepEqual(s.modelParams, { 'qwen3:8b': { temperature: 0.4 } });
    // Production's local AI settings are a different row, untouched
    assert.equal((await localStore.getLocalAiSettings()).mode, 'cloudOnly');
  });

  test('saved prompts and benchmark results', async () => {
    const id = await store.savePrompt({ name: 'Brake bias', system: 'Be brief', prompt: 'Rear or forward?', params: { temperature: 0.3 }, models: ['Local|qwen3:8b', 'Cloud|gpt-4o-mini'] });
    await store.savePrompt({ id, name: 'Brake bias v2', system: '', prompt: 'Rear or forward?', params: {}, models: [] });
    const prompts = await store.listPrompts();
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].name, 'Brake bias v2');
    const b = await store.saveBenchmark({ name: 'Run 1', system: '', prompt: 'x', results: [{ model: 'qwen3:8b', provider: 'Local', text: 'y', error: null, metrics: { totalMs: 10 } }] });
    assert.equal((await store.listBenchmarks())[0].results[0].metrics.totalMs, 10);
    await store.deleteBenchmark(b);
    await store.deletePrompt(id);
    assert.equal((await store.listPrompts()).length, 0);
  });

  test("the audit log names the Admin, and keeps the entry without them once the account is deleted", async () => {
    const [{ id: other }] = await q(`INSERT INTO racingcoach."Users" (user_name, email_address, password, role) VALUES ('Other', 'other@example.test', 'x', 'Admin') RETURNING id`);
    await store.audit(Number(other), { action: 'models.delete', target: 'gemma3:4b', outcome: 'ok' });
    assert.equal((await store.readAudit())[0].user, 'Other');
    await client.query('DELETE FROM racingcoach."Users" WHERE id = $1', [other]);
    const [entry] = await store.readAudit();
    assert.equal(entry.user, null);
    assert.equal(entry.target, 'gemma3:4b');
  });

  test("a local run goes through the registered server (even with production routing off), signed 'lab', recorded as aiLab", async () => {
    const events = [];
    for await (const e of playground.runPlayground({ target: { provider: 'Local', model: 'gemma3:4b' }, system: '', prompt: 'How do I trail brake?', params: { temperature: 0.2, bogus: 9 }, signal: new AbortController().signal })) {
      events.push(e);
    }
    assert.deepEqual(events.filter((e) => e.type === 'token').map((e) => e.text), ['Trail ', 'brake.']);
    const done = events.at(-1);
    assert.equal(done.type, 'done');
    assert.equal(done.metrics.fallback, false);
    assert.equal(done.metrics.actualModel, 'gemma3:4b');
    assert.equal(done.metrics.macFirstTokenMs, 40);
    assert.equal(done.metrics.costUsd, 0);
    assert.ok(done.metrics.firstTokenMs !== null);
    assert.equal(labCalls.at(-1).url, '/lab/chat');
    assert.equal(labCalls.at(-1).ok, true);
    assert.deepEqual(labCalls.at(-1).body.params, { temperature: 0.2 });
    await settle();
    const [row] = await q(`SELECT * FROM racingcoach."AiInferenceEvents" WHERE source = 'aiLab'`);
    assert.equal(row.provider, 'Local');
    assert.equal(row.feature, 'aiLabPlayground');
    assert.equal(row.server_id, 'test-mac');
    assert.equal(row.is_fallback, false);
    assert.equal(row.output_tokens, 30);
  });

  test("cloud runs are refused by the lab budget before any model is called", async () => {
    const run = async (model) => {
      const out = [];
      for await (const e of playground.runPlayground({ target: { provider: 'Cloud', model }, system: '', prompt: 'x', params: { maxTokens: 1000 }, signal: new AbortController().signal })) out.push(e);
      return out.at(-1);
    };
    await store.saveAiLabSettings({ ...(await store.getAiLabSettings()), dailyCloudBudgetUsd: 0 }, adminId);
    assert.deepEqual([(await run('gpt-4o-mini')).error], ['cloudOff']);

    // $0.05 of lab cloud spend today; a budget of $0.05 leaves nothing for a gpt-4o run
    await q(
      `INSERT INTO racingcoach."AiInferenceEvents" (id, logical_request_id, attempt, feature, source, provider, requested_model, status, route_reason, latency_ms, cost_usd, started_at)
       VALUES ($1, $2, 1, 'aiLabPlayground', 'aiLab', 'OpenAI', 'gpt-4o', 'completed', 'aiLab', 100, 0.05, now()),
              ($3, $4, 1, 'lapSummary', 'app', 'OpenAI', 'gpt-4o', 'completed', 'cloudOnlyMode', 100, 9, now())`,
      [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
    );
    assert.ok(Math.abs((await store.labCloudSpendTodayUsd()) - 0.05) < 1e-9, 'only the lab cloud rows count');
    await store.saveAiLabSettings({ ...(await store.getAiLabSettings()), dailyCloudBudgetUsd: 0.05 }, adminId);
    const refused = await run('gpt-4o');
    assert.equal(refused.error, 'budget');
    // Refusals before a model is called aren't inferences
    assert.equal((await q(`SELECT count(*)::int AS n FROM racingcoach."AiInferenceEvents" WHERE source = 'aiLab' AND status <> 'completed'`))[0].n, 0);
  });
});
