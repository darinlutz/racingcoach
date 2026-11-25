// The Memory Service's live acceptance run (docs/AI_MEMORY_EVALUATION.md): the proof-of-concept tests that need
// real models, on this Mac, with no stand-ins: Ollama (qwen3-embedding:0.6b embeddings, qwen3:8b extraction,
// gpt-oss:20b conflict checks), the Mem0 sidecar (local-ai/mem0/server.py) and Postgres with pgvector.
//   createdb -h 127.0.0.1 racingcoach_memory_live
//   MEMORY_LIVE_DATABASE_URL=postgres://127.0.0.1/racingcoach_memory_live MEMORY_OLLAMA_URL=http://127.0.0.1:11434 \
//     MEMORY_MEM0_URL=http://127.0.0.1:8765 node --experimental-transform-types --no-warnings scripts/memory-acceptance.mjs
// It drops and recreates the racingcoach and ai_memory schemas of that database, so it refuses one that isn't
// local. Prints PASS/FAIL per check and exits 1 on any failure.

import { register } from 'node:module';
import pg from 'pg';

const url = process.env.MEMORY_LIVE_DATABASE_URL;
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  console.error('Set MEMORY_LIVE_DATABASE_URL to a local database');
  process.exit(2);
}
process.env.DATABASE_URL = url;
register(new URL('./ts-resolve-hooks.mjs', import.meta.url));

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query('DROP SCHEMA IF EXISTS ai_memory CASCADE');
await client.query('DROP SCHEMA IF EXISTS racingcoach CASCADE');
const q = async (sql, params) => (await client.query(sql, params)).rows;

const mod = (p) => import(new URL(`../src/lib/memory/${p}.ts`, import.meta.url).href);
const [store, jobs, retrieval, decisions, schema, localServices, intelligence] = await Promise.all(['store', 'jobs', 'retrieval', 'decisions', 'schema', 'localServices', 'intelligence'].map(mod));
await schema.ensureMemorySchema();
const [{ id: adminId }] = await q(`INSERT INTO racingcoach."Users" (user_name, email_address, password, role) VALUES ('Admin', 'live-admin@example.test', 'x', 'Admin') RETURNING id`);
const actor = { userId: Number(adminId) };
const ns = Object.fromEntries((await store.listNamespaces()).map((n) => [n.path, n.id]));
const cat = Object.fromEntries((await store.listCategories()).map((c) => [c.key, c.id]));

let failures = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const drain = async () => {
  for (let i = 0; i < 30; i++) if (!(await jobs.runJobs({ limit: 4 })).ran) return;
};
const extract = async (text, namespace = 'racingcoach', assistant = 'Noted.') => {
  const job = await store.enqueueJob(null, 'extract', { messages: [{ role: 'user', content: text }, { role: 'assistant', content: assistant }], namespaceId: ns[namespace], allowedNamespaceIds: [ns[namespace], ...Object.entries(ns).filter(([p]) => p.startsWith(`${namespace}/`)).map(([, id]) => id)], application: 'acceptance', userId: actor.userId });
  const t = Date.now();
  await drain();
  const [j] = await q(`SELECT status, result, error FROM ai_memory."MemoryJobs" WHERE id = $1`, [job.id]);
  return { job: j, ms: Date.now() - t, id: job.id };
};

const t0 = Date.now();
await store.saveConfig({ providers: { intelligence: 'mem0', fallbackToNative: true } }, actor);

// 1. Manual memory with a real embedding
const { memory: rc } = await store.createMemory({ content: 'RacingCoach is a sim racing AI coaching platform developed by Clarivex.', namespaceId: ns.racingcoach, categoryId: cat.semantic, importance: 8 }, actor);
await drain();
const [emb] = await q(`SELECT model, dimensions FROM ai_memory."MemoryEmbeddings" WHERE memory_id = $1`, [rc.id]);
check('1. manual memory embedded by qwen3-embedding', emb?.dimensions === 1024, emb ? `${emb.model}, ${emb.dimensions} dims` : 'no embedding');
const indexes = await schema.listVectorIndexes();
check('1. HNSW index exists for the model', indexes.length > 0, indexes.map((i) => i.name).join(', '));
const r1 = await retrieval.retrieve({ query: 'What is RacingCoach?', namespaceIds: [ns.racingcoach], client: 'acceptance', userId: actor.userId });
check('1. semantic retrieval finds it', r1.memories[0]?.id === rc.id && r1.mode === 'hybrid', `similarity ${r1.memories[0]?.factors.semantic?.toFixed(3)}, ${r1.timings.totalMs} ms`);
await jobs.processOutbox();
const mem0List = await localServices.mem0Call('list', {});
check('1. synced to Mem0 through the outbox', mem0List.memories.some((m) => m.memory_id === rc.id));

// 4. Extraction with Mem0 and real models
const e4 = await extract('Just so you know: RacingCoach stores uploaded lap telemetry in a private Cloudflare R2 bucket.');
check('4. extraction job completed', e4.job.status === 'Completed', `${e4.job.result?.provider}, ${e4.ms} ms, queued ${e4.job.result?.queued}`);
const pending = (await decisions.listCandidates({ status: 'Pending' })).items;
const r2c = pending.find((c) => /R2/i.test(c.content));
check('4. candidate in the Approval Queue', Boolean(r2c), r2c?.content);
const before = await retrieval.retrieve({ query: 'Where does RacingCoach store lap telemetry?', namespaceIds: [ns.racingcoach], client: 'acceptance', userId: actor.userId });
check('4. not retrieved before approval', !before.memories.some((m) => /R2/.test(m.content)));
if (r2c) {
  const m = await decisions.approveCandidate(r2c.id, {}, actor);
  await drain();
  const afterR = await retrieval.retrieve({ query: 'Where does RacingCoach store lap telemetry?', namespaceIds: [ns.racingcoach], client: 'acceptance', userId: actor.userId });
  check('4. retrieved after approval', afterR.memories.some((x) => x.id === m.id), `rank ${afterR.memories.find((x) => x.id === m.id)?.rank}`);
}

// 5. Duplicate in different words
await jobs.processOutbox();
const e5 = await extract('Our lap telemetry for RacingCoach lives in a Cloudflare R2 bucket that is private.');
const [dup] = await q(`SELECT status, flags FROM ai_memory."MemoryCandidates" WHERE job_id = $1 ORDER BY created_at LIMIT 1`, [e5.id]);
check('5. reworded duplicate detected', dup ? dup.flags.includes('duplicate') : e5.job.result?.proposed === 0, dup ? `${dup.status} ${dup.flags.join(',')}` : `nothing proposed (${JSON.stringify(e5.job.result?.discarded)})`);

// 6. Conflict with a real conflict model
const { memory: host } = await store.createMemory({ content: 'RacingCoach is hosted on Render.', namespaceId: ns['clarivex/infrastructure'], categoryId: cat.technical, importance: 8 }, actor);
await drain();
await jobs.processOutbox();
const e6 = await extract('We have moved RacingCoach hosting off Render; RacingCoach is now hosted on Fly.io.', 'clarivex/infrastructure');
const conflicts = await decisions.listConflicts({ status: 'open' });
const k = conflicts.find((c) => c.existing.id === host.id);
check('6. contradiction proposed', Boolean(k), k ? `${k.detectedBy}: ${k.explanation}` : JSON.stringify(e6.job.result));
const still = await store.getMemory(host.id, 'x');
check('6. existing memory unchanged', still.content === 'RacingCoach is hosted on Render.' && still.version === 1);

// 7. Locked memory against automatic mode
const { memory: locked } = await store.createMemory({ content: 'Collector releases are signed by Clarivex LLC through Azure Artifact Signing.', namespaceId: ns['racingcoach/development'], categoryId: cat.procedural, isLocked: true, importance: 9 }, actor);
await drain();
await store.saveConfig({ system: { defaultMode: 'automatic' } }, actor);
await extract('Correction: collector releases are no longer signed by Clarivex LLC; they are signed by Clarivex Inc.', 'racingcoach/development');
await store.saveConfig({ system: { defaultMode: 'approvalRequired' } }, actor);
const lockedAfter = await store.getMemory(locked.id, 'x');
check('7. locked memory unchanged under automatic mode', lockedAfter.version === 1 && lockedAfter.content === locked.content);

// 13. Ollama offline: point at a dead port
const saved = process.env.MEMORY_OLLAMA_URL;
process.env.MEMORY_OLLAMA_URL = 'http://127.0.0.1:9';
localServices.resetBreakers();
const off = await retrieval.retrieve({ query: 'What is RacingCoach coaching platform?', namespaceIds: [ns.racingcoach], client: 'acceptance', userId: actor.userId });
check('13. keyword retrieval while Ollama is down', off.mode === 'keyword' && off.memories.some((m) => m.id === rc.id), off.degraded);
await store.saveConfig({ providers: { intelligence: 'native' } }, actor);
const e13 = await extract('RacingCoach uses Resend for password reset emails.');
check('13. extraction deferred while Ollama is down', e13.job.status === 'Deferred', e13.job.error);
process.env.MEMORY_OLLAMA_URL = saved;
localServices.resetBreakers();
await q(`UPDATE ai_memory."MemoryJobs" SET run_after = now() WHERE id = $1`, [e13.id]);
await drain();
const [back] = await q(`SELECT status, result FROM ai_memory."MemoryJobs" WHERE id = $1`, [e13.id]);
check('13. deferred extraction completes when Ollama is back', back.status === 'Completed', `native provider, queued ${back.result?.queued}`);

// 14. Mem0 offline
await store.saveConfig({ providers: { intelligence: 'mem0' } }, actor);
const savedMem0 = process.env.MEMORY_MEM0_URL;
process.env.MEMORY_MEM0_URL = 'http://127.0.0.1:9';
localServices.resetBreakers();
const picked = await intelligence.pickProvider(await store.getConfig());
check('14. native provider when Mem0 is down', picked.provider.id === 'native', picked.fellBack);
process.env.MEMORY_MEM0_URL = savedMem0;
localServices.resetBreakers();

// 12. Permanent deletion reaches Mem0
await store.deleteMemory(rc.id, actor, { permanent: true, reason: 'acceptance' });
await jobs.processOutbox();
const listAfter = await localServices.mem0Call('list', {});
check('12. permanent deletion removed from Mem0', !listAfter.memories.some((m) => m.memory_id === rc.id));

console.log(`\n${results.length - failures}/${results.length} passed in ${Math.round((Date.now() - t0) / 1000)} s`);
await client.end();
process.exit(failures ? 1 : 0);
