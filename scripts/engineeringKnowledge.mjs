// The Race Engineering knowledge base's command line (docs/race-engineering-rag.md):
//   npm run engineering:knowledge -- status                     documents, chunks, embeddings and the latest jobs
//   npm run engineering:knowledge -- ingest-starter [--embed]   loads the starter corpus (src/lib/engineering/starterCorpus.ts)
//   npm run engineering:knowledge -- ingest <file|folder>... [--embed]
//                                                                Markdown (.md), text (.txt), JSON records (.json) and
//                                                                PDF (.pdf, needs Python's pypdf); sources from
//                                                                knowledge/race-engineering/sources.json first
//   npm run engineering:knowledge -- embed [--max 2000]         embeds chunks that have none (OpenAI, costs money)
//   npm run engineering:knowledge -- reindex <key>|--all [--embed]   forgets embeddings so they're made again
//   npm run engineering:knowledge -- benchmark [--embeddings]   retrieval quality on the scenario set, in memory: keywords
//                                                                and metadata only, and with --embeddings each model too
//
// DATABASE_URL and OPENAI_API_KEY come from the environment or .env.local. The site's database guard applies
// (src/lib/db.ts): a database the live site marked as production is refused here, so run it against the development
// database, or on the live server's shell.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extname, join, resolve } from 'node:path';
import { register } from 'node:module';

function envLocal(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') || undefined;
  } catch {
    return undefined;
  }
}
for (const name of ['DATABASE_URL', 'OPENAI_API_KEY', 'ENGINEERING_EMBEDDING_MODEL']) {
  const value = envLocal(name);
  if (value) process.env[name] = value;
}

register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
const lib = (file) => import(new URL(`../src/lib/engineering/${file}`, import.meta.url).href);

const [command = 'status', ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(name);
const option = (name, fallback) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : fallback;
};
const positional = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1] === '--max'));

async function close() {
  await globalThis.pgPool?.end();
}

function filesIn(path) {
  const full = resolve(path);
  if (statSync(full).isDirectory()) return readdirSync(full).flatMap((f) => filesIn(join(full, f)));
  return ['.md', '.txt', '.json', '.pdf'].includes(extname(full).toLowerCase()) && !full.endsWith('sources.json') ? [full] : [];
}

// PDF text through Python's pypdf, run isolated (-I) on the file path as an argument
function pdfText(file) {
  const script = 'import sys\nfrom pypdf import PdfReader\nr = PdfReader(sys.argv[1])\nprint("\\n\\n".join((p.extract_text() or "") for p in r.pages))';
  try {
    return execFileSync('python', ['-I', '-c', script, file], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`Could not read ${file} as PDF (pip install pypdf): ${error.message}`);
  }
}

// A PDF has no front matter, so its metadata comes from a sidecar: manual.pdf -> manual.pdf.meta (front matter only)
function pdfDocument(ingestion, file) {
  let meta = '';
  try {
    meta = readFileSync(`${file}.meta`, 'utf8');
  } catch {
    throw new Error(`${file} needs a ${file}.meta front matter file (key, title, source, ...)`);
  }
  return ingestion.normalizeTextDocument(`${meta.trim()}\n${pdfText(file)}`, 'pdf');
}

async function main() {
  if (command === 'benchmark') return benchmark();
  const store = await lib('knowledgeStore.ts');
  const pipeline = await lib('knowledgePipeline.ts');
  const ingestion = await lib('ingestion.ts');

  if (command === 'status') {
    const docs = await store.listDocuments();
    const active = docs.filter((d) => d.status === 'active');
    console.log(`${active.length} active documents, ${active.reduce((n, d) => n + d.chunks, 0)} chunks, ${active.reduce((n, d) => n + d.embedded, 0)} embedded`);
    for (const d of docs) console.log(`  ${d.status.padEnd(10)} ${d.key} v${d.version} [${d.authority}, ${d.verification}] ${d.chunks} chunks, ${d.embedded} embedded`);
    for (const j of await store.listJobs(5)) console.log(`job ${j.id} ${j.kind} ${j.status} ${j.startedAt}${j.error ? `: ${j.error.split('\n')[0]}` : ''}`);
    return;
  }
  if (command === 'ingest-starter') {
    return report(await pipeline.ingestStarterCorpus({ embed: flag('--embed') }));
  }
  if (command === 'ingest') {
    if (positional.length === 0) throw new Error('Name files or folders to ingest');
    let sources = [];
    try {
      sources = JSON.parse(readFileSync(new URL('../knowledge/race-engineering/sources.json', import.meta.url), 'utf8'));
    } catch {
      // no shared sources file
    }
    const docs = [];
    const failures = [];
    for (const file of positional.flatMap(filesIn)) {
      try {
        const ext = extname(file).toLowerCase();
        if (ext === '.json') docs.push(...ingestion.normalizeJson(readFileSync(file, 'utf8')));
        else if (ext === '.pdf') docs.push(pdfDocument(ingestion, file));
        else docs.push(ingestion.normalizeTextDocument(readFileSync(file, 'utf8'), ext === '.md' ? 'markdown' : 'text'));
      } catch (error) {
        failures.push(`${file}: ${error.message}`);
      }
    }
    for (const f of failures) console.error(`refused ${f}`);
    return report(await pipeline.runIngestion('files', docs, sources, { embed: flag('--embed') }));
  }
  if (command === 'embed') {
    const result = await store.embedPendingChunks(Number(option('--max', 2000)));
    console.log(`embedded ${result.embedded} chunks (~${result.tokens} tokens, ~$${result.costUsd.toFixed(4)}), ${result.remaining} left`);
    return;
  }
  if (command === 'reindex') {
    const docs = (await store.listDocuments()).filter((d) => d.status === 'active' && (flag('--all') || positional.includes(d.key)));
    if (docs.length === 0) throw new Error('No active document matches');
    for (const d of docs) await store.clearDocumentEmbeddings(d.id);
    console.log(`cleared embeddings of ${docs.length} documents`);
    if (flag('--embed')) {
      const result = await store.embedPendingChunks(Number(option('--max', 2000)));
      console.log(`embedded ${result.embedded} chunks (~$${result.costUsd.toFixed(4)}), ${result.remaining} left`);
    }
    return;
  }
  throw new Error(`Unknown command ${command}`);
}

function report(result) {
  const count = (s) => result.outcomes.filter((o) => o.status === s).length;
  console.log(`job ${result.jobId}: ${count('new')} new, ${count('updated')} updated, ${count('unchanged')} unchanged, ${result.failures.length} failed`);
  for (const f of result.failures) console.error(`  failed ${f.key}: ${f.error}`);
  if (result.embedding) console.log(`embedded ${result.embedding.embedded} chunks (~$${result.embedding.costUsd.toFixed(4)}), ${result.embedding.remaining} left`);
  if (result.embeddingError) console.error(`embedding failed: ${result.embeddingError}`);
}

// Top-1 and top-3 accuracy over questions with a known best record, keyword/metadata only and with each embedding
// model (each adds the question and corpus embeddings: well under a cent)
async function benchmark() {
  const { STARTER_CORPUS } = await lib('starterCorpus.ts');
  const { recordToChunk, retrieve } = await lib('retrieval.ts');
  const { capabilitiesFor } = await lib('setupCapabilities.ts');
  const { BENCHMARK_QUESTIONS } = await lib('benchmarkQuestions.ts');
  const chunks = STARTER_CORPUS.map(recordToChunk);
  const ctxFor = (car) => {
    const caps = capabilitiesFor('iracing', car);
    return { simulator: 'iracing', carClass: caps.carClass, car, allowed: null };
  };
  const score = (label, embeddingsOf) => {
    let top1 = 0;
    let top3 = 0;
    for (const [i, q] of BENCHMARK_QUESTIONS.entries()) {
      const r = retrieve(chunks, q.question, ctxFor(q.car), { queryEmbedding: embeddingsOf?.questions[i] ?? null });
      const ids = r.results.map((x) => x.chunk.documentKey);
      if (ids[0] === q.expect) top1++;
      if (ids.slice(0, 3).includes(q.expect)) top3++;
      else if (process.env.VERBOSE) console.log(`  miss: "${q.question}" -> ${ids.slice(0, 3).join(', ')} (want ${q.expect})`);
    }
    const n = BENCHMARK_QUESTIONS.length;
    console.log(`${label.padEnd(34)} top-1 ${((top1 / n) * 100).toFixed(0)}%  top-3 ${((top3 / n) * 100).toFixed(0)}%  (${n} questions)`);
  };
  score('keywords + metadata');
  if (!flag('--embeddings')) return;
  const { embedTexts, EMBEDDING_MODELS } = await lib('embeddings.ts');
  for (const model of EMBEDDING_MODELS) {
    const vectors = await embedTexts(chunks.map((c) => `${c.title}\n${c.text}`), model, true);
    chunks.forEach((c, i) => (c.embedding = vectors[i]));
    const questions = await embedTexts(BENCHMARK_QUESTIONS.map((q) => q.question), model, true);
    score(`hybrid with ${model}`, { questions });
    // semantic alone, for comparison
    const saved = chunks.map((c) => c.embedding);
    let top1 = 0;
    for (const [i, q] of BENCHMARK_QUESTIONS.entries()) {
      const { cosine } = await lib('retrieval.ts');
      const best = chunks.map((c, j) => [c.documentKey, cosine(questions[i], saved[j])]).sort((a, b) => b[1] - a[1])[0];
      if (best[0] === q.expect) top1++;
    }
    console.log(`${`vector only, ${model}`.padEnd(34)} top-1 ${((top1 / BENCHMARK_QUESTIONS.length) * 100).toFixed(0)}%`);
  }
}

main()
  .catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
  })
  .finally(close);
