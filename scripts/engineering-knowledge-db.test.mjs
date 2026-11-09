// The Race Engineering knowledge base against a real database: npm run test:engineering
//
// Runs src/lib/engineering/knowledgeStore.ts, knowledgePipeline.ts and knowledgeService.ts against a disposable
// local Postgres, e.g.
//   docker run -d --rm --name rc-engineering-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rctest -p 127.0.0.1:55450:5432 postgres:17
//   ENGINEERING_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55450/rctest npm run test:engineering
// Skipped without ENGINEERING_TEST_DATABASE_URL. It drops and recreates the racingcoach schema, so it refuses any
// database that isn't on this computer. No embeddings are made (no OpenAI call): retrieval runs on keywords.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import pg from 'pg';

const url = process.env.ENGINEERING_TEST_DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname);
const skip = !url ? 'ENGINEERING_TEST_DATABASE_URL is not set' : !local ? 'refusing a database that is not local' : false;

describe('engineering knowledge database', { skip }, () => {
  let client, store, pipeline, service, ingestion;

  before(async () => {
    process.env.DATABASE_URL = url;
    delete process.env.OPENAI_API_KEY;
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('DROP SCHEMA IF EXISTS racingcoach CASCADE');
    register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
    const src = new URL('../src/lib/engineering/', import.meta.url);
    store = await import(new URL('knowledgeStore.ts', src).href);
    pipeline = await import(new URL('knowledgePipeline.ts', src).href);
    service = await import(new URL('knowledgeService.ts', src).href);
    ingestion = await import(new URL('ingestion.ts', src).href);
  });

  after(async () => {
    await client?.end();
    await globalThis.pgPool?.end();
  });

  test('the starter corpus ingests, and a second run changes nothing', async () => {
    const first = await pipeline.ingestStarterCorpus();
    assert.equal(first.failures.length, 0);
    assert.ok(first.outcomes.every((o) => o.status === 'new'));
    const second = await pipeline.ingestStarterCorpus();
    assert.ok(second.outcomes.every((o) => o.status === 'unchanged'));
    const docs = await store.listDocuments();
    assert.equal(docs.length, first.outcomes.length);
  });

  test('the schema can be applied again (safe on every start)', async () => {
    const { ENGINEERING_SCHEMA } = await import(new URL('../src/lib/engineering/knowledgeSchema.ts', import.meta.url).href);
    for (const statement of ENGINEERING_SCHEMA) await client.query(statement);
  });

  test('a changed document becomes a new version and supersedes the old', async () => {
    await store.upsertSource({ key: 'test-source', title: 'Test', url: null, kind: 'original', license: 'original', publisher: null });
    const text = '---\nkey: test-brake-notes\ntitle: Test brake notes\nsource: test-source\nsimulators: [iracing]\nsymptoms: [brakeLocking]\nphases: [braking]\n---\n# Locking\nThe fronts lock when the bias is too far forward.';
    const v1 = await store.ingestDocument(ingestion.normalizeTextDocument(text, 'markdown'));
    assert.equal(v1.status, 'new');
    const v2 = await store.ingestDocument(ingestion.normalizeTextDocument(text + '\n\nMore detail on ABS.', 'markdown'));
    assert.equal(v2.status, 'updated');
    assert.equal(v2.version, 2);
    const rows = (await client.query(`SELECT version, status FROM racingcoach."EngineeringDocuments" WHERE document_key = 'test-brake-notes' ORDER BY version`)).rows;
    assert.deepEqual(rows.map((r) => r.status), ['superseded', 'active']);
  });

  test('an unknown licence is refused', async () => {
    await assert.rejects(store.upsertSource({ key: 'bad', title: 'Bad', url: null, kind: 'book', license: 'unknown', publisher: null }), /licence/);
  });

  test('retrieval reads the database, and deactivated or rejected documents disappear', async () => {
    service.invalidateKnowledgeCache();
    const found = await service.engineeringContext({ question: 'understeer on entry', car: 'Ferrari 296 GT3', fixed: false, setupKnown: true, rotation: null });
    assert.equal(found.source, 'database');
    assert.equal(found.retrieval.results[0].chunk.documentKey, 'dx-entry-understeer');

    const [doc] = (await store.listDocuments()).filter((d) => d.key === 'dx-entry-understeer');
    assert.ok(await store.setDocumentStatus(doc.id, 'inactive', 'test'));
    service.invalidateKnowledgeCache();
    const without = await service.engineeringContext({ question: 'understeer on entry', car: 'Ferrari 296 GT3', fixed: false, setupKnown: true, rotation: null });
    assert.ok(!without.retrieval.results.some((r) => r.chunk.documentKey === 'dx-entry-understeer'));
    assert.ok(await store.setDocumentStatus(doc.id, 'active', null));

    const [bias] = (await store.listDocuments()).filter((d) => d.key === 'cmp-brake-bias');
    await store.setDocumentVerification(bias.id, 'rejected');
    service.invalidateKnowledgeCache();
    const rejected = await service.engineeringContext({ question: 'brake bias', car: 'Ferrari 296 GT3', fixed: false, setupKnown: true, rotation: null });
    assert.ok(!rejected.retrieval.results.some((r) => r.chunk.documentKey === 'cmp-brake-bias'));
  });

  test('a per-car capability override replaces the class default', async () => {
    await client.query(
      `INSERT INTO racingcoach."EngineeringSetupCapabilities" (simulator, car, parameter, in_car, garage) VALUES ('iracing', 'ferrari 296 gt3', 'brakeBias', true, true)`
    );
    service.invalidateKnowledgeCache();
    const ctx = await service.engineeringContext({ question: 'understeer', car: 'Ferrari 296 GT3', fixed: true, setupKnown: true, rotation: null });
    assert.deepEqual([...ctx.allowed], ['brakeBias']);
  });

  test('embedding without an API key fails the run partly, never the ingestion', async () => {
    const result = await pipeline.ingestStarterCorpus({ embed: true });
    assert.ok(result.embeddingError);
    const [job] = await store.listJobs(1);
    assert.equal(job.status, 'partial');
  });
});
