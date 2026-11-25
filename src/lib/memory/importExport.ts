import { query } from '@/lib/db';
import { labJson, labServer } from '@/lib/aiLab/gatewayClient';
import { ollamaGenerateJson } from './localServices';
import {
  answerOverlap,
  buildDataset,
  checkContamination,
  excludedRate,
  mean,
  parseImport,
  precisionAtK,
  recallAtK,
  reciprocalRank,
  serialize,
  type ExportMemory,
  type ImportFormat,
  type ImportRow,
} from './portable';
import { retrieve } from './retrieval';
import { detectSensitive, isUuid } from './rules';
import { ensureMemorySchema } from './schema';
import { audit, contentHash, createMemory, getConfig, listCategories, listMemories, listNamespaces, readHistory, SecretContentError, TombstonedError, type Actor } from './store';
import { similarMemories } from './retrieval';
import { OfflineError } from './localServices';

// Import, export, Open WebUI migration, evaluation runs and fine-tuning datasets (docs/AI_MEMORY_OPERATIONS.md,
// docs/AI_MEMORY_OPEN_WEBUI.md, docs/AI_MEMORY_EVALUATION.md). Imports are previewed (a dry run that changes
// nothing), then the Admin commits the rows they picked; tombstoned text never comes back. Exports are files kept in
// the database for 72 hours, downloaded only by whoever made them.

export type ImportMapping = { defaultNamespaceId: string; defaultCategoryId: string; namespaceMap?: Record<string, string>; categoryMap?: Record<string, string> };
export type PreviewRow = ImportRow & {
  verdict: 'new' | 'duplicate' | 'previouslyDeleted' | 'secret' | 'possibleDuplicate' | 'badMapping';
  namespaceId: string | null;
  categoryId: string | null;
  similar: { id: string; title: string; similarity: number } | null;
  sensitive: boolean;
};

export async function previewImport(format: ImportFormat, text: string, mapping: ImportMapping): Promise<{ rows: PreviewRow[]; errors: { line: number; error: string }[]; semantic: boolean }> {
  await ensureMemorySchema();
  const parsed = parseImport(format, text);
  const [namespaces, categories] = await Promise.all([listNamespaces(), listCategories()]);
  const nsByPath = new Map(namespaces.map((n) => [n.path, n.id]));
  const catByKey = new Map(categories.map((c) => [c.key, c.id]));
  const hashes = parsed.rows.map((r) => contentHash(r.content));
  const existing = await query<{ content_hash: string; namespace_id: string }>(`SELECT content_hash, namespace_id FROM ai_memory."Memories" WHERE content_hash = ANY($1) AND status NOT IN ('Deleted', 'Rejected')`, [hashes]);
  const tombs = await query<{ content_hash: string }>(`SELECT content_hash FROM ai_memory."MemoryDeletions" WHERE content_hash = ANY($1)`, [hashes]);
  const tombSet = new Set(tombs.map((t) => t.content_hash));
  let semantic = true;
  const rows: PreviewRow[] = [];
  for (let i = 0; i < parsed.rows.length; i++) {
    const r = parsed.rows[i];
    const namespaceId = (r.namespace && (mapping.namespaceMap?.[r.namespace] ?? nsByPath.get(r.namespace))) || mapping.defaultNamespaceId;
    const categoryId = (r.category && (mapping.categoryMap?.[r.category] ?? catByKey.get(r.category))) || mapping.defaultCategoryId;
    const sensitivity = detectSensitive(`${r.title ?? ''}\n${r.content}`).sensitivity;
    let verdict: PreviewRow['verdict'] = 'new';
    let similar: PreviewRow['similar'] = null;
    if (!isUuid(namespaceId) || !namespaces.some((n) => n.id === namespaceId) || !isUuid(categoryId) || !categories.some((c) => c.id === categoryId)) verdict = 'badMapping';
    else if (sensitivity === 'secret') verdict = 'secret';
    else if (tombSet.has(hashes[i])) verdict = 'previouslyDeleted';
    else if (existing.some((e) => e.content_hash === hashes[i] && e.namespace_id === namespaceId)) verdict = 'duplicate';
    else if (semantic && i < 300) {
      try {
        const top = (await similarMemories(r.content, [namespaceId], 1, { actingUserId: null, override: true }))[0];
        if (top && top.similarity >= (await getConfig()).extraction.duplicateSimilarity) {
          verdict = 'possibleDuplicate';
          similar = { id: top.id, title: top.title, similarity: top.similarity };
        }
      } catch (error) {
        if (error instanceof OfflineError) semantic = false;
        else throw error;
      }
    }
    rows.push({ ...r, verdict, namespaceId, categoryId, similar, sensitive: sensitivity === 'personal' });
  }
  return { rows, errors: parsed.errors, semantic };
}

export type CommitRow = Pick<ImportRow, 'title' | 'content' | 'importance' | 'confidence' | 'expiresAt' | 'pinned' | 'locked' | 'externalId' | 'createdAt'> & { namespaceId: string; categoryId: string };

export async function runImportJob(payload: Record<string, unknown>, userId: number | null): Promise<{ created: number; duplicates: number; refused: { index: number; reason: string }[] }> {
  const rows = (Array.isArray(payload.rows) ? payload.rows : []) as CommitRow[];
  const source = payload.source === 'openWebui' ? 'openWebuiMigration' : 'import';
  const actor: Actor = { userId, system: `import:${String(payload.importId ?? '')}` };
  const out = { created: 0, duplicates: 0, refused: [] as { index: number; reason: string }[] };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const { duplicate } = await createMemory(
        {
          title: r.title,
          content: r.content,
          namespaceId: r.namespaceId,
          categoryId: r.categoryId,
          importance: r.importance ?? undefined,
          confidence: r.confidence ?? undefined,
          expiresAt: r.expiresAt ?? undefined,
          isPinned: r.pinned,
          isLocked: r.locked,
          sourceType: source,
          sourceApplication: source === 'openWebuiMigration' ? 'open-webui' : 'import',
          sourceReference: r.externalId ? `${source === 'openWebuiMigration' ? 'owui' : 'ext'}:${r.externalId}` : null,
          metadata: r.createdAt ? { originalCreatedAt: r.createdAt } : {},
        },
        actor,
        { automated: true }
      );
      if (duplicate) out.duplicates++;
      else out.created++;
    } catch (error) {
      out.refused.push({ index: i, reason: error instanceof TombstonedError ? 'previouslyDeleted' : error instanceof SecretContentError ? 'secret' : error instanceof Error ? error.message.slice(0, 100) : 'failed' });
    }
  }
  await audit(actor, `import.${source}`, String(payload.importId ?? ''), 'ok', { created: out.created, duplicates: out.duplicates, refused: out.refused.length });
  return out;
}

// ---- Exports ----

export type ExportRequest = { format: 'json' | 'jsonl' | 'csv'; namespaceIds?: string[]; categoryIds?: string[]; ids?: string[]; approvedOnly?: boolean; includeHistory?: boolean };

export async function createExport(req: ExportRequest, actor: Actor & { userId: number }): Promise<{ id: string; fileName: string; count: number }> {
  const config = await getConfig();
  const items: ExportMemory[] = [];
  for (let offset = 0; offset < 50_000; offset += 200) {
    const page = await listMemories(
      { namespaceIds: req.namespaceIds, categoryIds: req.categoryIds, ids: req.ids, statuses: req.approvedOnly ? ['Active', 'Approved'] : undefined, limit: 200, offset, sort: 'created', direction: 'asc' },
      config.providers.embeddingModel
    );
    for (const m of page.items) {
      const row: ExportMemory = {
        id: m.id,
        title: m.title,
        content: m.content,
        summary: m.summary,
        category: m.categoryKey,
        namespace: m.namespacePath,
        importance: m.importance,
        confidence: m.confidence,
        status: m.status,
        isPinned: m.isPinned,
        isLocked: m.isLocked,
        isActive: m.isActive,
        isSensitive: m.isSensitive,
        version: m.version,
        sourceApplication: m.sourceApplication,
        sourceType: m.sourceType,
        sourceModel: m.sourceModel,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        expiresAt: m.expiresAt,
        accessCount: m.accessCount,
      };
      if (req.includeHistory) row.history = (await readHistory(m.id)).map((h) => ({ version: h.version, changeType: h.changeType, at: h.at, snapshot: h.snapshot }));
      items.push(row);
    }
    if (page.items.length < 200) break;
  }
  const fileName = `clarivex-memories-${new Date().toISOString().slice(0, 10)}.${req.format}`;
  const content = serialize(req.format, items, { exportedAt: new Date().toISOString(), service: 'Clarivex Memory Service', count: items.length });
  const rows = await query<{ id: string }>(
    `INSERT INTO ai_memory."MemoryExports" (kind, format, file_name, content, stats, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [req.includeHistory ? 'history' : 'memories', req.format, fileName, Buffer.from(content, 'utf8'), JSON.stringify({ count: items.length }), actor.userId]
  );
  await audit(actor, 'export.create', rows[0].id, 'ok', { format: req.format, count: items.length, history: req.includeHistory === true });
  return { id: rows[0].id, fileName, count: items.length };
}

export async function readExport(id: string, userId: number): Promise<{ fileName: string; format: string; content: Buffer } | null> {
  if (!isUuid(id)) return null;
  await ensureMemorySchema();
  const rows = await query<{ file_name: string; format: string; content: Buffer }>(`SELECT file_name, format, content FROM ai_memory."MemoryExports" WHERE id = $1 AND created_by = $2 AND expires_at > now()`, [id, userId]);
  return rows[0] ? { fileName: rows[0].file_name, format: rows[0].format, content: rows[0].content } : null;
}

export async function listExports(userId: number) {
  await ensureMemorySchema();
  const rows = await query<{ id: string; kind: string; format: string; file_name: string; stats: unknown; created_at: Date; expires_at: Date; bytes: number }>(
    `SELECT id, kind, format, file_name, stats, created_at, expires_at, octet_length(content) AS bytes FROM ai_memory."MemoryExports" WHERE created_by = $1 AND expires_at > now() ORDER BY created_at DESC LIMIT 50`,
    [userId]
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, format: r.format, fileName: r.file_name, stats: r.stats, createdAt: r.created_at.toISOString(), expiresAt: r.expires_at.toISOString(), bytes: Number(r.bytes) }));
}

// ---- Open WebUI migration ----

// The owner's native Open WebUI memories, read through the gateway (never changed here: native memory stays as it
// is until the Admin turns it off themselves, docs/AI_MEMORY_OPEN_WEBUI.md)
export async function readOpenWebuiMemories(): Promise<{ id: string; content: string; createdAt: number | null; updatedAt: number | null }[]> {
  const server = await labServer();
  const r = await labJson(server, 'GET /lab/webui/memories');
  if (r.status !== 200) throw new OfflineError('ollama', String(r.body.error ?? `http${r.status}`), 'Open WebUI memories could not be read');
  const list = (r.body.memories ?? []) as { id: string; content: string; updatedAt?: number | null; createdAt?: number | null }[];
  return list.map((m) => ({ id: String(m.id), content: String(m.content ?? ''), createdAt: m.createdAt ?? null, updatedAt: m.updatedAt ?? null }));
}

// Side by side: each native memory, and whether the centralized store has the same text
export async function compareOpenWebui(): Promise<{ native: number; migrated: number; missing: { id: string; content: string }[] }> {
  const native = await readOpenWebuiMemories();
  const hashes = native.map((m) => contentHash(m.content));
  const found = await query<{ content_hash: string }>(`SELECT content_hash FROM ai_memory."Memories" WHERE content_hash = ANY($1) AND status NOT IN ('Deleted', 'Rejected')`, [hashes]);
  const have = new Set(found.map((f) => f.content_hash));
  const missing = native.filter((_, i) => !have.has(hashes[i])).map((m) => ({ id: m.id, content: m.content }));
  return { native: native.length, migrated: native.length - missing.length, missing };
}

// ---- Evaluation ----

export type EvalConfig = { dataset: string; mode: 'hybrid' | 'semantic' | 'keyword'; profileId?: string | null; k: number; compareDisabled: boolean; answerModel?: string | null; params?: Record<string, unknown> };

export async function runEvaluation(cfg: EvalConfig, allowedNamespaceIds: string[], actor: Actor) {
  await ensureMemorySchema();
  const cases = await query<{ id: string; prompt: string; expected_memory_ids: string[]; excluded_memory_ids: string[]; expected_answer: string; namespaces: string[] }>(
    `SELECT * FROM ai_memory."MemoryEvaluationCases" WHERE dataset = $1 ORDER BY created_at LIMIT 200`,
    [cfg.dataset]
  );
  const namespaces = await listNamespaces();
  const results: Record<string, unknown>[] = [];
  for (const c of cases) {
    const caseNs = c.namespaces.length ? namespaces.filter((n) => c.namespaces.includes(n.path) || c.namespaces.includes(n.id)).map((n) => n.id) : allowedNamespaceIds;
    const authorized = caseNs.filter((id) => allowedNamespaceIds.includes(id));
    const started = Date.now();
    const r = await retrieve({ query: c.prompt, namespaceIds: authorized, mode: cfg.mode, profileId: cfg.profileId, params: cfg.params as never, client: 'evaluation', userId: actor.userId, record: false, inspector: false, owner: { actingUserId: null, override: true } });
    const ids = r.memories.map((m) => m.id);
    const relevant = new Set(c.expected_memory_ids);
    const excluded = new Set(c.excluded_memory_ids);
    const row: Record<string, unknown> = {
      caseId: c.id,
      prompt: c.prompt,
      retrieved: ids,
      precision: precisionAtK(ids, relevant, cfg.k),
      recall: recallAtK(ids, relevant, cfg.k),
      mrr: reciprocalRank(ids, relevant),
      unauthorized: excludedRate(ids, excluded),
      tokens: r.tokens,
      latencyMs: Date.now() - started,
      degraded: r.degraded,
      utilization: relevant.size ? ids.filter((id) => relevant.has(id)).length / Math.max(1, ids.length) : null,
    };
    if (cfg.answerModel && c.expected_answer) {
      // A deterministic check of the answer (word overlap with the expected answer), with memory and without
      const ask = async (context: string) => {
        const a = await ollamaGenerateJson(cfg.answerModel!, `${context ? `${context}\n\n` : ''}Answer the question in one or two sentences. Answer JSON {"answer": "..."}.`, c.prompt, { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] });
        const answer = (() => {
          try {
            return String((JSON.parse(a.content) as { answer?: string }).answer ?? '');
          } catch {
            return a.content;
          }
        })();
        return { answer, overlap: answerOverlap(answer, c.expected_answer), ms: a.ms, tokens: (a.promptTokens ?? 0) + (a.outputTokens ?? 0) };
      };
      try {
        row.withMemory = await ask(r.context);
        if (cfg.compareDisabled) row.withoutMemory = await ask('');
      } catch (error) {
        row.answerError = error instanceof Error ? error.message.slice(0, 200) : 'failed';
      }
    }
    results.push(row);
  }
  const pick = (k: string) => mean(results.map((r) => (r as Record<string, number | null>)[k]));
  const overlapOf = (k: 'withMemory' | 'withoutMemory') => mean(results.map((r) => ((r as Record<string, { overlap?: number | null }>)[k]?.overlap ?? null)));
  const metrics = {
    cases: results.length,
    precisionAtK: pick('precision'),
    recallAtK: pick('recall'),
    mrr: pick('mrr'),
    unauthorizedRate: pick('unauthorized'),
    meanTokens: pick('tokens'),
    meanLatencyMs: pick('latencyMs'),
    utilization: pick('utilization'),
    answerOverlapWithMemory: overlapOf('withMemory'),
    answerOverlapWithoutMemory: overlapOf('withoutMemory'),
    k: cfg.k,
    kinds: { precisionAtK: 'deterministic', recallAtK: 'deterministic', mrr: 'deterministic', unauthorizedRate: 'deterministic', answerOverlap: 'deterministic (word overlap, not a judge)' },
  };
  const rows = await query<{ id: string }>(
    `INSERT INTO ai_memory."MemoryEvaluationRuns" (dataset, config, metrics, results, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [cfg.dataset, JSON.stringify(cfg), JSON.stringify(metrics), JSON.stringify(results), actor.userId]
  );
  await audit(actor, 'evaluation.run', rows[0].id, 'ok', { dataset: cfg.dataset, cases: results.length });
  return { id: rows[0].id, metrics, results };
}

// ---- Fine-tuning datasets ----

export type DatasetRequest = { namespaceIds: string[]; categoryKeys: string[]; minImportance: number; split: { train: number; valid: number; test: number }; seed: string; system: string; format: 'chat' | 'instruction'; name: string; preview: boolean };

export async function buildTrainingDataset(req: DatasetRequest, actor: Actor & { userId: number }) {
  const [namespaces, config] = await Promise.all([listNamespaces(), getConfig()]);
  const rows = await query<{ id: string; version: number; title: string; content: string; key: string; path: string; ns: string; is_sensitive: boolean; supersedes: string | null }>(
    `SELECT m.id, m.version, m.title, m.content, c.key, n.path, n.id AS ns, m.is_sensitive, m.supersedes_memory_id AS supersedes
     FROM ai_memory."Memories" m JOIN ai_memory."MemoryCategories" c ON c.id = m.category_id JOIN ai_memory."MemoryNamespaces" n ON n.id = m.namespace_id
     WHERE m.status = 'Active' AND m.namespace_id = ANY($1::uuid[]) AND ($2::text[] = '{}' OR c.key = ANY($2::text[])) AND m.importance >= $3
     ORDER BY m.created_at LIMIT 20000`,
    [req.namespaceIds, req.categoryKeys, req.minImportance]
  );
  const rels = await query<{ from_memory_id: string; to_memory_id: string }>(`SELECT from_memory_id, to_memory_id FROM ai_memory."MemoryRelationships" WHERE status = 'active'`);
  // Groups: memories joined by a relationship or a supersedes chain share one (union-find), so they share a split
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!;
    parent.set(x, root);
    return root;
  };
  const join = (a: string, b: string) => parent.set(find(a), find(b));
  for (const r of rows) parent.set(r.id, r.id);
  for (const r of rows) if (r.supersedes && parent.has(r.supersedes)) join(r.id, r.supersedes);
  for (const r of rels) if (parent.has(r.from_memory_id) && parent.has(r.to_memory_id)) join(r.from_memory_id, r.to_memory_id);
  const customer = new Set(namespaces.filter((n) => n.isCustomerData).map((n) => n.id));
  const { examples, excluded } = buildDataset(
    rows.map((r) => ({ id: r.id, version: Number(r.version), title: r.title, content: r.content, categoryKey: r.key, namespacePath: r.path, isCustomerData: customer.has(r.ns), isSensitive: r.is_sensitive, group: find(r.id) })),
    { system: req.system, split: req.split, seed: req.seed, allowCustomerData: false }
  );
  const contamination = checkContamination(examples);
  const stats = {
    eligible: rows.length,
    examples: examples.length,
    excluded: excluded.reduce<Record<string, number>>((a, e) => ((a[e.reason] = (a[e.reason] ?? 0) + 1), a), {}),
    splits: { train: examples.filter((e) => e.split === 'train').length, valid: examples.filter((e) => e.split === 'valid').length, test: examples.filter((e) => e.split === 'test').length },
    contamination,
    version: `${req.name}-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`,
    embeddingModel: config.providers.embeddingModel,
  };
  if (req.preview) return { stats, preview: examples.slice(0, 20), id: null };
  if (contamination.groupsAcrossSplits.length) throw new Error('Dataset contamination: a group is in more than one split');
  const lines = examples.map((e) => JSON.stringify({ split: e.split, ...(req.format === 'chat' ? e.chat : e.instruction), provenance: e.provenance }));
  const fileName = `${stats.version}.${req.format}.jsonl`;
  const saved = await query<{ id: string }>(
    `INSERT INTO ai_memory."MemoryExports" (kind, format, file_name, content, stats, created_by) VALUES ('fineTuning', 'jsonl', $1, $2, $3, $4) RETURNING id`,
    [fileName, Buffer.from(lines.join('\n') + '\n', 'utf8'), JSON.stringify(stats), actor.userId]
  );
  await audit(actor, 'fineTuning.export', saved[0].id, 'ok', { examples: examples.length, version: stats.version });
  return { stats, preview: examples.slice(0, 20), id: saved[0].id };
}
