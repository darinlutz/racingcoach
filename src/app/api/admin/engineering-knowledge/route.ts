import { NextResponse } from 'next/server';
import { apiText } from '@/lib/i18n/server';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { BodyTooLargeError, readJsonLimited } from '@/lib/requestBody';
import { configuredEmbeddingModel } from '@/lib/engineering/embeddings';
import { IngestionError, normalizeJson, normalizeTextDocument, MAX_DOCUMENT_CHARS } from '@/lib/engineering/ingestion';
import { engineeringContext, invalidateKnowledgeCache, loadKnowledge } from '@/lib/engineering/knowledgeService';
import { ingestStarterCorpus, runIngestion } from '@/lib/engineering/knowledgePipeline';
import {
  clearDocumentEmbeddings,
  embedPendingChunks,
  failStaleJobs,
  listDocuments,
  listJobs,
  listSources,
  readDocumentChunks,
  setDocumentStatus,
  setDocumentVerification,
  upsertSource,
} from '@/lib/engineering/knowledgeStore';
import { LICENSES, SIMULATORS, VERIFICATIONS, type KnowledgeSource, type SimulatorId, type Verification } from '@/lib/engineering/knowledgeTypes';

// The Admin page's Race Engineering Knowledge section (src/components/EngineeringKnowledgeManager.tsx,
// docs/race-engineering-rag.md). GET: documents, sources, ingestion jobs and the embedding model. POST { action }:
// ingestStarter, upload ({ format, text, meta } Markdown, text or JSON records), addSource, embed, reindex ({ id }),
// setStatus ({ id, status, reason }), setVerification ({ id, verification }), chunks ({ id }) and test ({ question,
// car, simulator, fixed }: retrieval and diagnosis only, no chat model). Admin role only; anyone else gets a 404.
// Embedding is the only paid call, capped per run (MAX_EMBED_CHUNKS) and refused by the emergency stop.

const MAX_BODY = MAX_DOCUMENT_CHARS * 2 + 16 * 1024;
const MAX_EMBED_CHUNKS = 2000;

async function admin() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) {
    const t = await apiText(user);
    return { user: null, denied: NextResponse.json({ error: t.adminOnly }, { status: 404 }) };
  }
  return { user, denied: null };
}

export async function GET() {
  const { denied } = await admin();
  if (denied) return denied;
  try {
    await failStaleJobs();
    const [documents, sources, jobs, loaded] = await Promise.all([listDocuments(true), listSources(), listJobs(20), loadKnowledge()]);
    return NextResponse.json({
      documents,
      sources,
      jobs,
      embeddingModel: configuredEmbeddingModel(),
      retrievalSource: loaded.source,
      queryEmbeddingModel: loaded.embeddingModel,
    });
  } catch (error) {
    console.error('Engineering knowledge report error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Failed to load the engineering knowledge base' }, { status: 500 });
  }
}

const id = (value: unknown) => (Number.isInteger(value) && (value as number) > 0 ? (value as number) : null);
const str = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export async function POST(request: Request) {
  const { denied } = await admin();
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = ((await readJsonLimited(request, MAX_BODY)) ?? {}) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof BodyTooLargeError) return NextResponse.json({ error: 'The document is too large' }, { status: 413 });
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  try {
    switch (body.action) {
      case 'ingestStarter':
        return NextResponse.json(await ingestStarterCorpus());
      case 'upload': {
        const text = typeof body.text === 'string' ? body.text : '';
        if (!text.trim()) return NextResponse.json({ error: 'The document is empty' }, { status: 400 });
        const format = body.format === 'json' ? 'json' : body.format === 'text' ? 'text' : 'markdown';
        const meta = body.meta && typeof body.meta === 'object' ? (body.meta as Record<string, unknown>) : {};
        const docs = format === 'json' ? normalizeJson(text) : [normalizeTextDocument(text, format, meta)];
        // An upload is unverified until a person reviews it, whatever its file says
        for (const doc of docs) if (doc.verification === 'reviewed') doc.verification = 'unverified';
        return NextResponse.json(await runIngestion('upload', docs, []));
      }
      case 'addSource': {
        const source: KnowledgeSource = {
          key: str(body.key, 100),
          title: str(body.title, 300),
          url: str(body.url, 1000) || null,
          kind: (['original', 'book', 'simulator_manual', 'manufacturer', 'article', 'other'] as const).find((k) => k === body.kind) ?? 'other',
          license: (LICENSES as readonly string[]).includes(body.license as string) ? (body.license as KnowledgeSource['license']) : 'unknown',
          publisher: str(body.publisher, 300) || null,
        };
        await upsertSource(source);
        return NextResponse.json({ ok: true });
      }
      case 'embed': {
        const result = await embedPendingChunks(MAX_EMBED_CHUNKS);
        invalidateKnowledgeCache();
        return NextResponse.json(result);
      }
      case 'reindex': {
        const docId = id(body.id);
        if (!docId) return NextResponse.json({ error: 'Missing document' }, { status: 400 });
        await clearDocumentEmbeddings(docId);
        const result = await embedPendingChunks(MAX_EMBED_CHUNKS);
        invalidateKnowledgeCache();
        return NextResponse.json(result);
      }
      case 'setStatus': {
        const docId = id(body.id);
        const status = body.status === 'active' ? 'active' : body.status === 'inactive' ? 'inactive' : null;
        if (!docId || !status) return NextResponse.json({ error: 'Missing document or status' }, { status: 400 });
        const changed = await setDocumentStatus(docId, status, str(body.reason, 500) || null);
        invalidateKnowledgeCache();
        return changed ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Another version is active, or nothing changed' }, { status: 409 });
      }
      case 'setVerification': {
        const docId = id(body.id);
        const verification = (VERIFICATIONS as readonly string[]).includes(body.verification as string) ? (body.verification as Verification) : null;
        if (!docId || !verification) return NextResponse.json({ error: 'Missing document or verification' }, { status: 400 });
        await setDocumentVerification(docId, verification);
        invalidateKnowledgeCache();
        return NextResponse.json({ ok: true });
      }
      case 'chunks': {
        const docId = id(body.id);
        if (!docId) return NextResponse.json({ error: 'Missing document' }, { status: 400 });
        return NextResponse.json({ chunks: await readDocumentChunks(docId) });
      }
      case 'test': {
        const question = str(body.question, 500);
        if (!question) return NextResponse.json({ error: 'Missing question' }, { status: 400 });
        const simulator = (SIMULATORS as readonly string[]).includes(body.simulator as string) ? (body.simulator as SimulatorId) : 'iracing';
        const ctx = await engineeringContext({
          question,
          car: str(body.car, 200) || null,
          simulator,
          fixed: body.fixed === true,
          setupKnown: true,
          rotation: null,
        });
        return NextResponse.json({
          source: ctx.source,
          carClass: ctx.capabilities.carClass,
          capabilitiesKnown: ctx.capabilities.known,
          allowed: [...ctx.allowed],
          query: ctx.retrieval.query,
          confidence: ctx.retrieval.confidence,
          excluded: ctx.retrieval.excluded,
          results: ctx.retrieval.results.map((r) => ({ id: r.chunk.id, title: r.chunk.title, score: Number(r.score.toFixed(2)), reasons: r.reasons, authority: r.chunk.authority, verification: r.chunk.verification, sources: r.chunk.sources })),
          diagnosis: ctx.diagnosis,
          context: ctx.context.text,
          tokens: ctx.context.tokens,
        });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof IngestionError) return NextResponse.json({ error: error.message }, { status: 422 });
    const message = error instanceof Error ? error.message : String(error);
    console.error('Engineering knowledge action error:', message);
    return NextResponse.json({ error: message.slice(0, 500) }, { status: 500 });
  }
}
