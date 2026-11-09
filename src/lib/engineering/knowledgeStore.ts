import { query, transaction } from '@/lib/db';
import { ensureEngineeringSchema } from './knowledgeSchema';
import { validateSource, type NormalizedDocument } from './ingestion';
import { configuredEmbeddingModel, embedTexts, EMBEDDING_PRICE_PER_MILLION } from './embeddings';
import type { KnowledgeChunk } from './retrieval';
import type { SetupCapability } from './setupCapabilities';
import type { EngineeringRecord, KnowledgeSource, ParameterId, SimulatorId, Verification } from './knowledgeTypes';

// Every database read and write of the Race Engineering knowledge base (tables in knowledgeSchema.ts). Ingestion is
// idempotent: a document whose content hash matches its active version is left alone; a changed one becomes a new
// version and the old one 'superseded', in one transaction, so readers never see a document without its chunks.
// Embedding happens after, per chunk, so a failed embedding leaves the text searchable by keywords and is retried by
// the next `embed` run.

export type IngestOutcome = { key: string; status: 'new' | 'updated' | 'unchanged'; version: number; chunks: number };

export async function upsertSource(source: KnowledgeSource): Promise<void> {
  await ensureEngineeringSchema();
  const s = validateSource(source);
  await query(
    `INSERT INTO racingcoach."EngineeringSources" (key, title, url, kind, license, publisher) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, url = EXCLUDED.url, kind = EXCLUDED.kind,
       license = EXCLUDED.license, publisher = EXCLUDED.publisher, updated_at = now()`,
    [s.key, s.title, s.url, s.kind, s.license, s.publisher]
  );
}

export async function ingestDocument(doc: NormalizedDocument): Promise<IngestOutcome> {
  await ensureEngineeringSchema();
  return transaction(async (client) => {
    // One ingestion of a key at a time
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`engineering:${doc.key}`]);
    const source = await client.query('SELECT 1 FROM racingcoach."EngineeringSources" WHERE key = $1', [doc.sourceKey]);
    if (source.rowCount === 0) throw new Error(`Unknown source "${doc.sourceKey}": add it first`);
    const current = (
      await client.query<{ id: number; version: number; content_hash: string }>(
        `SELECT id, version, content_hash FROM racingcoach."EngineeringDocuments" WHERE document_key = $1 AND status = 'active'`,
        [doc.key]
      )
    ).rows[0];
    if (current?.content_hash === doc.hash) return { key: doc.key, status: 'unchanged', version: current.version, chunks: doc.chunks.length };
    const [{ max }] = (
      await client.query<{ max: number | null }>('SELECT max(version) AS max FROM racingcoach."EngineeringDocuments" WHERE document_key = $1', [doc.key])
    ).rows;
    const version = Math.max(doc.version, (max ?? 0) + 1);
    if (current) {
      await client.query(
        `UPDATE racingcoach."EngineeringDocuments" SET status = 'superseded', status_reason = $2, updated_at = now() WHERE id = $1`,
        [current.id, `replaced by version ${version}`]
      );
    }
    const [{ id }] = (
      await client.query<{ id: number }>(
        `INSERT INTO racingcoach."EngineeringDocuments"
           (document_key, version, title, source_key, format, authority, verification, simulators, car_classes, cars,
            components, phases, symptoms, content, record, content_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
        [
          doc.key,
          version,
          doc.title,
          doc.sourceKey,
          doc.format,
          doc.authority,
          doc.verification,
          doc.simulators,
          doc.carClasses,
          doc.cars,
          doc.components,
          doc.phases,
          doc.symptoms,
          doc.content,
          doc.record ? JSON.stringify({ ...doc.record, version }) : null,
          doc.hash,
        ]
      )
    ).rows;
    // Chunks unchanged since the old version keep their embeddings, so an edit only pays for what changed
    const reused = current
      ? new Map(
          (
            await client.query<{ content_hash: string; embedding: number[] | null; embedding_model: string | null; embedded_at: Date | null }>(
              `SELECT content_hash, embedding, embedding_model, embedded_at FROM racingcoach."EngineeringChunks" WHERE document_id = $1 AND embedding IS NOT NULL`,
              [current.id]
            )
          ).rows.map((r) => [r.content_hash, r])
        )
      : new Map();
    for (const chunk of doc.chunks) {
      const old = reused.get(chunk.hash);
      await client.query(
        `INSERT INTO racingcoach."EngineeringChunks" (document_id, chunk_index, title, text, token_estimate, content_hash, embedding, embedding_model, embedded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, chunk.index, chunk.title, chunk.text, chunk.tokens, chunk.hash, old?.embedding ?? null, old?.embedding_model ?? null, old?.embedded_at ?? null]
      );
    }
    return { key: doc.key, status: current ? 'updated' : 'new', version, chunks: doc.chunks.length };
  });
}

// Embeds active chunks with no embedding, or one from another model, up to maxChunks (the cost cap of one run)
export async function embedPendingChunks(maxChunks = 2000, model = configuredEmbeddingModel()): Promise<{ embedded: number; tokens: number; costUsd: number; remaining: number }> {
  await ensureEngineeringSchema();
  const rows = await query<{ id: number; title: string; text: string; token_estimate: number }>(
    `SELECT c.id, c.title, c.text, c.token_estimate FROM racingcoach."EngineeringChunks" c
       JOIN racingcoach."EngineeringDocuments" d ON d.id = c.document_id
      WHERE d.status = 'active' AND (c.embedding IS NULL OR c.embedding_model IS DISTINCT FROM $1)
      ORDER BY c.id LIMIT $2`,
    [model, maxChunks]
  );
  let embedded = 0;
  let tokens = 0;
  for (let i = 0; i < rows.length; i += 64) {
    const batch = rows.slice(i, i + 64);
    const vectors = await embedTexts(batch.map((r) => `${r.title}\n${r.text}`), model);
    for (let j = 0; j < batch.length; j++) {
      await query(
        `UPDATE racingcoach."EngineeringChunks" SET embedding = $2, embedding_model = $3, embedded_at = now() WHERE id = $1`,
        [batch[j].id, vectors[j], model]
      );
      embedded++;
      tokens += batch[j].token_estimate;
    }
  }
  const [{ remaining }] = await query<{ remaining: number }>(
    `SELECT count(*)::int AS remaining FROM racingcoach."EngineeringChunks" c JOIN racingcoach."EngineeringDocuments" d ON d.id = c.document_id
      WHERE d.status = 'active' AND (c.embedding IS NULL OR c.embedding_model IS DISTINCT FROM $1)`,
    [model]
  );
  return { embedded, tokens, costUsd: (tokens / 1e6) * (EMBEDDING_PRICE_PER_MILLION[model] ?? 0.13), remaining };
}

type ChunkRow = {
  chunk_index: number;
  title: string;
  text: string;
  embedding: number[] | null;
  embedding_model: string | null;
  document_key: string;
  version: number;
  source_key: string;
  authority: KnowledgeChunk['authority'];
  verification: KnowledgeChunk['verification'];
  simulators: KnowledgeChunk['simulators'];
  car_classes: KnowledgeChunk['carClasses'];
  cars: string[];
  components: KnowledgeChunk['components'];
  phases: KnowledgeChunk['phases'];
  symptoms: KnowledgeChunk['symptoms'];
  record: EngineeringRecord | null;
};

// Every active, not rejected chunk, for retrieval (knowledgeService.ts caches them)
export async function readActiveChunks(): Promise<KnowledgeChunk[]> {
  await ensureEngineeringSchema();
  const rows = await query<ChunkRow>(
    `SELECT c.chunk_index, c.title, c.text, c.embedding, c.embedding_model, d.document_key, d.version, d.source_key,
            d.authority, d.verification, d.simulators, d.car_classes, d.cars, d.components, d.phases, d.symptoms, d.record
       FROM racingcoach."EngineeringChunks" c JOIN racingcoach."EngineeringDocuments" d ON d.id = c.document_id
      WHERE d.status = 'active' AND d.verification <> 'rejected'
      ORDER BY d.document_key, c.chunk_index`
  );
  return rows.map((r) => ({
    id: `${r.document_key}#${r.chunk_index}`,
    documentKey: r.document_key,
    documentVersion: r.version,
    title: r.title,
    text: r.text,
    sources: [r.source_key],
    // the document's verification is the one that counts (the Admin page changes it without a new version)
    record: r.record ? { ...r.record, verification: r.verification } : undefined,
    embedding: r.embedding,
    simulators: r.simulators,
    carClasses: r.car_classes,
    cars: r.cars,
    components: r.components,
    phases: r.phases,
    symptoms: r.symptoms,
    authority: r.authority,
    verification: r.verification,
  }));
}

// The model most active chunks were embedded with, or null when none are embedded (keyword retrieval only)
export async function readEmbeddingModel(): Promise<string | null> {
  await ensureEngineeringSchema();
  const rows = await query<{ embedding_model: string }>(
    `SELECT c.embedding_model FROM racingcoach."EngineeringChunks" c JOIN racingcoach."EngineeringDocuments" d ON d.id = c.document_id
      WHERE d.status = 'active' AND c.embedding_model IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`
  );
  return rows[0]?.embedding_model ?? null;
}

export async function readCapabilityOverrides(): Promise<{ simulator: SimulatorId; car: string; capabilities: SetupCapability[] }[]> {
  await ensureEngineeringSchema();
  const rows = await query<{ simulator: SimulatorId; car: string; parameter: ParameterId; in_car: boolean; garage: boolean; verification: SetupCapability['verification']; note: string | null; range: SetupCapability['range'] }>(
    `SELECT simulator, car, parameter, in_car, garage, verification, note, range FROM racingcoach."EngineeringSetupCapabilities" ORDER BY simulator, car, parameter`
  );
  const byCar = new Map<string, { simulator: SimulatorId; car: string; capabilities: SetupCapability[] }>();
  for (const r of rows) {
    const key = `${r.simulator}\u0000${r.car}`;
    if (!byCar.has(key)) byCar.set(key, { simulator: r.simulator, car: r.car, capabilities: [] });
    byCar.get(key)!.capabilities.push({ parameter: r.parameter, inCar: r.in_car, garage: r.garage, verification: r.verification, ...(r.note ? { note: r.note } : {}), range: r.range });
  }
  return [...byCar.values()];
}

// ---------------------------------------------------------------- Admin

export type DocumentSummary = {
  id: number;
  key: string;
  version: number;
  title: string;
  sourceKey: string;
  format: string;
  authority: string;
  verification: Verification;
  status: string;
  statusReason: string | null;
  simulators: string[];
  carClasses: string[];
  cars: string[];
  symptoms: string[];
  chunks: number;
  embedded: number;
  updatedAt: string;
};

export async function listDocuments(includeInactive = false): Promise<DocumentSummary[]> {
  await ensureEngineeringSchema();
  const rows = await query<Record<string, unknown>>(
    `SELECT d.id, d.document_key, d.version, d.title, d.source_key, d.format, d.authority, d.verification, d.status, d.status_reason,
            d.simulators, d.car_classes, d.cars, d.symptoms, d.updated_at,
            count(c.id)::int AS chunks, count(c.embedding)::int AS embedded
       FROM racingcoach."EngineeringDocuments" d LEFT JOIN racingcoach."EngineeringChunks" c ON c.document_id = d.id
      WHERE $1 OR d.status <> 'superseded'
      GROUP BY d.id ORDER BY d.status, d.document_key, d.version DESC`,
    [includeInactive]
  );
  return rows.map((r) => ({
    id: r.id as number,
    key: r.document_key as string,
    version: r.version as number,
    title: r.title as string,
    sourceKey: r.source_key as string,
    format: r.format as string,
    authority: r.authority as string,
    verification: r.verification as Verification,
    status: r.status as string,
    statusReason: (r.status_reason as string | null) ?? null,
    simulators: r.simulators as string[],
    carClasses: r.car_classes as string[],
    cars: r.cars as string[],
    symptoms: r.symptoms as string[],
    chunks: r.chunks as number,
    embedded: r.embedded as number,
    updatedAt: (r.updated_at as Date).toISOString(),
  }));
}

export async function listSources(): Promise<KnowledgeSource[]> {
  await ensureEngineeringSchema();
  return query<KnowledgeSource>(`SELECT key, title, url, kind, license, publisher FROM racingcoach."EngineeringSources" ORDER BY key`);
}

export async function readDocumentChunks(id: number): Promise<{ index: number; title: string; text: string; embedded: boolean }[]> {
  await ensureEngineeringSchema();
  return query(
    `SELECT chunk_index AS index, title, text, embedding IS NOT NULL AS embedded FROM racingcoach."EngineeringChunks" WHERE document_id = $1 ORDER BY chunk_index`,
    [id]
  );
}

// Deactivate an outdated document (kept, but never retrieved), or bring an inactive one back when no other version is active
export async function setDocumentStatus(id: number, status: 'active' | 'inactive', reason: string | null): Promise<boolean> {
  await ensureEngineeringSchema();
  const rows = await query(
    `UPDATE racingcoach."EngineeringDocuments" d SET status = $2, status_reason = $3, updated_at = now()
      WHERE d.id = $1 AND d.status <> $2
        AND ($2 = 'inactive' OR NOT EXISTS (SELECT 1 FROM racingcoach."EngineeringDocuments" o WHERE o.document_key = d.document_key AND o.status = 'active'))
      RETURNING d.id`,
    [id, status, reason]
  );
  return rows.length > 0;
}

// A person reviewed (or rejected) a document's content
export async function setDocumentVerification(id: number, verification: Verification): Promise<boolean> {
  await ensureEngineeringSchema();
  const rows = await query(
    `UPDATE racingcoach."EngineeringDocuments" SET verification = $2, reviewed_at = CASE WHEN $2 IN ('reviewed', 'rejected') THEN now() ELSE NULL END, updated_at = now()
      WHERE id = $1 RETURNING id`,
    [id, verification]
  );
  return rows.length > 0;
}

// Forget every chunk's embedding of a document, so the next embed run makes them again
export async function clearDocumentEmbeddings(id: number): Promise<void> {
  await ensureEngineeringSchema();
  await query(`UPDATE racingcoach."EngineeringChunks" SET embedding = NULL, embedding_model = NULL, embedded_at = NULL WHERE document_id = $1`, [id]);
}

export type IngestionJob = { id: number; kind: string; status: string; detail: Record<string, unknown>; error: string | null; startedAt: string; finishedAt: string | null };

export async function startJob(kind: string, detail: Record<string, unknown> = {}): Promise<number> {
  await ensureEngineeringSchema();
  const [{ id }] = await query<{ id: number }>(`INSERT INTO racingcoach."EngineeringIngestionJobs" (kind, detail) VALUES ($1, $2) RETURNING id`, [kind, JSON.stringify(detail)]);
  return id;
}

export async function finishJob(id: number, status: 'succeeded' | 'failed' | 'partial', detail: Record<string, unknown>, error: string | null = null): Promise<void> {
  await query(
    `UPDATE racingcoach."EngineeringIngestionJobs" SET status = $2, detail = detail || $3::jsonb, error = $4, finished_at = now() WHERE id = $1`,
    [id, status, JSON.stringify(detail), error?.slice(0, 4000) ?? null]
  );
}

export async function listJobs(limit = 50): Promise<IngestionJob[]> {
  await ensureEngineeringSchema();
  const rows = await query<{ id: number; kind: string; status: string; detail: Record<string, unknown>; error: string | null; started_at: Date; finished_at: Date | null }>(
    `SELECT id, kind, status, detail, error, started_at, finished_at FROM racingcoach."EngineeringIngestionJobs" ORDER BY id DESC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, status: r.status, detail: r.detail, error: r.error, startedAt: r.started_at.toISOString(), finishedAt: r.finished_at?.toISOString() ?? null }));
}

// Mark jobs left running by a server that stopped mid-run as failed, so the Admin page doesn't show them forever
export async function failStaleJobs(): Promise<void> {
  await query(
    `UPDATE racingcoach."EngineeringIngestionJobs" SET status = 'failed', error = coalesce(error, 'The server stopped before the job finished'), finished_at = now()
      WHERE status = 'running' AND started_at < now() - interval '1 hour'`
  );
}
