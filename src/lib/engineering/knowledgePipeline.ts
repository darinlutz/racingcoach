import { normalizeRecord, type NormalizedDocument } from './ingestion';
import { embedPendingChunks, finishJob, ingestDocument, startJob, upsertSource, type IngestOutcome } from './knowledgeStore';
import { invalidateKnowledgeCache } from './knowledgeService';
import { STARTER_CORPUS, STARTER_SOURCES } from './starterCorpus';
import type { KnowledgeSource } from './knowledgeTypes';

// One ingestion run, as `npm run engineering:knowledge` and the Admin page start it: sources first, then each
// document (one failing doesn't stop the rest, and is retried once), then, when asked, embeddings for whatever has
// none, capped at maxEmbedChunks per run. Recorded in "EngineeringIngestionJobs" with every failure.

export type PipelineResult = {
  jobId: number;
  outcomes: IngestOutcome[];
  failures: { key: string; error: string }[];
  embedding: Awaited<ReturnType<typeof embedPendingChunks>> | null;
  embeddingError: string | null;
};

export async function runIngestion(
  kind: string,
  docs: NormalizedDocument[],
  sources: KnowledgeSource[],
  options: { embed?: boolean; maxEmbedChunks?: number } = {}
): Promise<PipelineResult> {
  const jobId = await startJob(kind, { documents: docs.length });
  const outcomes: IngestOutcome[] = [];
  const failures: { key: string; error: string }[] = [];
  try {
    for (const source of sources) await upsertSource(source);
    for (const doc of docs) {
      for (let attempt = 1; ; attempt++) {
        try {
          outcomes.push(await ingestDocument(doc));
          break;
        } catch (error) {
          if (attempt < 2) continue;
          failures.push({ key: doc.key, error: error instanceof Error ? error.message : String(error) });
          break;
        }
      }
    }
    let embedding: PipelineResult['embedding'] = null;
    let embeddingError: string | null = null;
    if (options.embed) {
      try {
        embedding = await embedPendingChunks(options.maxEmbedChunks ?? 2000);
      } catch (error) {
        embeddingError = error instanceof Error ? error.message : String(error);
      }
    }
    invalidateKnowledgeCache();
    const counts = Object.fromEntries(['new', 'updated', 'unchanged'].map((s) => [s, outcomes.filter((o) => o.status === s).length]));
    await finishJob(
      jobId,
      failures.length || embeddingError ? (outcomes.length ? 'partial' : 'failed') : 'succeeded',
      { ...counts, failures, embedding, embeddingError },
      failures.map((f) => `${f.key}: ${f.error}`).concat(embeddingError ? [`embedding: ${embeddingError}`] : []).join('\n') || null
    );
    return { jobId, outcomes, failures, embedding, embeddingError };
  } catch (error) {
    await finishJob(jobId, 'failed', { failures }, error instanceof Error ? error.message : String(error)).catch(() => {});
    throw error;
  }
}

export function starterDocuments(): NormalizedDocument[] {
  return STARTER_CORPUS.map(normalizeRecord);
}

export function ingestStarterCorpus(options: { embed?: boolean } = {}) {
  return runIngestion('starter', starterDocuments(), STARTER_SOURCES, options);
}
