import { query, transaction } from '@/lib/db';
import { isUuid, LIMITS, type ConflictResolution } from './rules';
import { addRelationship, audit, createMemory, getConfig, getMemory, InputError, LockedError, NotFoundError, updateMemory, type Actor, type MemoryRecord } from './store';
import { ensureMemorySchema } from './schema';

// What a person decides (docs/AI_MEMORY_ARCHITECTURE.md, Approval and Conflicts): approving, editing, merging,
// replacing or rejecting candidates, and resolving conflicts. A candidate only ever becomes a memory here (or by
// the automatic modes' own rules in extraction.ts); until then retrieval never sees it, as it isn't in "Memories".
// A locked memory is never changed by a candidate: the Admin unlocks it first, on its own detail page.

export type Candidate = {
  id: string;
  jobId: string | null;
  namespaceId: string;
  namespacePath: string;
  categoryId: string;
  categoryKey: string;
  categoryName: string;
  title: string;
  content: string;
  importance: number;
  confidence: number;
  operation: string;
  targetMemoryId: string | null;
  target: { id: string; title: string; content: string; isLocked: boolean; version: number } | null;
  duplicateOf: string | null;
  duplicate: { id: string; title: string; content: string } | null;
  evidence: string;
  rationale: string;
  speaker: string;
  sensitivity: string;
  flags: string[];
  expiresAt: string | null;
  sourceApplication: string;
  sourceModel: string | null;
  sourceConversationId: string | null;
  provider: string;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  resultMemoryId: string | null;
  conflicts: { id: string; memoryId: string; kind: string; explanation: string; recommended: string; status: string }[];
};

export async function listCandidates(f: { status?: string; namespaceIds?: string[]; limit?: number; offset?: number; ids?: string[] }): Promise<{ items: Candidate[]; total: number }> {
  await ensureMemorySchema();
  const params: unknown[] = [f.status ?? 'Pending'];
  const where = ['c.status = $1'];
  if (f.namespaceIds) {
    params.push(f.namespaceIds);
    where.push(`c.namespace_id = ANY($${params.length}::uuid[])`);
  }
  if (f.ids) {
    params.push(f.ids.filter(isUuid));
    where.push(`c.id = ANY($${params.length}::uuid[])`);
  }
  const limit = Math.min(200, Math.max(1, f.limit ?? 50));
  const rows = await query<Record<string, unknown>>(
    `SELECT c.*, n.path AS namespace_path, cat.key AS category_key, cat.name AS category_name,
            t.title AS t_title, t.content AS t_content, t.is_locked AS t_locked, t.version AS t_version,
            d.title AS d_title, d.content AS d_content,
            (SELECT coalesce(json_agg(json_build_object('id', k.id, 'memoryId', k.existing_memory_id, 'kind', k.kind, 'explanation', k.explanation, 'recommended', k.recommended, 'status', k.status)), '[]')
               FROM ai_memory."MemoryConflicts" k WHERE k.candidate_id = c.id) AS conflicts
     FROM ai_memory."MemoryCandidates" c
     JOIN ai_memory."MemoryNamespaces" n ON n.id = c.namespace_id
     JOIN ai_memory."MemoryCategories" cat ON cat.id = c.category_id
     LEFT JOIN ai_memory."Memories" t ON t.id = c.target_memory_id
     LEFT JOIN ai_memory."Memories" d ON d.id = c.duplicate_of
     WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC LIMIT ${limit} OFFSET ${Math.max(0, f.offset ?? 0)}`,
    params
  );
  const total = await query<{ n: number }>(`SELECT count(*)::int AS n FROM ai_memory."MemoryCandidates" c WHERE ${where.join(' AND ')}`, params);
  return {
    total: total[0]?.n ?? 0,
    items: rows.map((r) => ({
      id: r.id as string,
      jobId: (r.job_id as string) ?? null,
      namespaceId: r.namespace_id as string,
      namespacePath: r.namespace_path as string,
      categoryId: r.category_id as string,
      categoryKey: r.category_key as string,
      categoryName: r.category_name as string,
      title: r.title as string,
      content: r.content as string,
      importance: Number(r.importance),
      confidence: Number(r.confidence),
      operation: r.operation as string,
      targetMemoryId: (r.target_memory_id as string) ?? null,
      target: r.target_memory_id && r.t_title ? { id: r.target_memory_id as string, title: r.t_title as string, content: r.t_content as string, isLocked: r.t_locked as boolean, version: Number(r.t_version) } : null,
      duplicateOf: (r.duplicate_of as string) ?? null,
      duplicate: r.duplicate_of && r.d_title ? { id: r.duplicate_of as string, title: r.d_title as string, content: r.d_content as string } : null,
      evidence: r.evidence as string,
      rationale: r.rationale as string,
      speaker: r.speaker as string,
      sensitivity: r.sensitivity as string,
      flags: (r.flags as string[]) ?? [],
      expiresAt: r.expires_at ? new Date(r.expires_at as Date).toISOString() : null,
      sourceApplication: r.source_application as string,
      sourceModel: (r.source_model as string) ?? null,
      sourceConversationId: (r.source_conversation_id as string) ?? null,
      provider: r.provider as string,
      status: r.status as string,
      createdAt: new Date(r.created_at as Date).toISOString(),
      decidedAt: r.decided_at ? new Date(r.decided_at as Date).toISOString() : null,
      resultMemoryId: (r.result_memory_id as string) ?? null,
      conflicts: (r.conflicts as Candidate['conflicts']) ?? [],
    })),
  };
}

async function loadPending(id: string): Promise<Candidate> {
  const { items } = await listCandidates({ ids: [id], status: 'Pending' });
  if (!items[0]) throw new NotFoundError('candidate');
  return items[0];
}

async function closeCandidate(id: string, status: 'Approved' | 'Rejected' | 'Merged', actor: Actor, resultMemoryId: string | null) {
  await query(`UPDATE ai_memory."MemoryCandidates" SET status = $2, decided_by = $3, decided_at = now(), result_memory_id = $4 WHERE id = $1 AND status = 'Pending'`, [id, status, actor.userId, resultMemoryId]);
  await query(`UPDATE ai_memory."MemoryConflicts" SET status = 'Resolved', resolution = $2, resolved_by = $3, resolved_at = now() WHERE candidate_id = $1 AND status <> 'Resolved'`, [id, `candidate${status}`, actor.userId]);
}

export type ApproveEdits = Partial<{ title: string; content: string; categoryId: string; namespaceId: string; importance: number; expiresAt: string | null; lock: boolean; pin: boolean }>;

// Approve as a new memory (operation add, or "create separate" for any operation)
export async function approveCandidate(id: string, edits: ApproveEdits, actor: Actor, options: { separate?: boolean; allowedNamespaceIds?: string[] } = {}): Promise<MemoryRecord> {
  const c = await loadPending(id);
  if (c.sensitivity === 'secret') throw new InputError('secretCandidate');
  const namespaceId = edits.namespaceId ?? c.namespaceId;
  if (options.allowedNamespaceIds && !options.allowedNamespaceIds.includes(namespaceId)) throw new InputError('namespaceNotAllowed');
  if (c.operation === 'update' && c.target && !options.separate) {
    // Applying an update: the target's own lock is respected
    if (c.target.isLocked) throw new LockedError('The target memory is locked; unlock it first');
    const updated = await updateMemory(c.target.id, { content: edits.content ?? c.content, title: edits.title ?? c.title, importance: edits.importance ?? undefined, isLocked: edits.lock ?? undefined }, c.target.version, actor, {
      changeType: 'candidateUpdate',
      reason: `Approved candidate ${id}`,
    });
    await closeCandidate(id, 'Approved', actor, updated.id);
    return updated;
  }
  const { memory } = await createMemory(
    {
      title: edits.title ?? c.title,
      content: edits.content ?? c.content,
      namespaceId,
      categoryId: edits.categoryId ?? c.categoryId,
      importance: edits.importance ?? c.importance,
      confidence: c.confidence,
      expiresAt: edits.expiresAt !== undefined ? edits.expiresAt : c.expiresAt ?? undefined,
      isLocked: edits.lock === true,
      isPinned: edits.pin === true,
      isSensitive: c.sensitivity === 'personal',
      sourceModel: c.sourceModel,
      sourceConversationId: c.sourceConversationId,
      sourceApplication: c.sourceApplication,
      sourceType: 'extraction',
      sourceReference: `candidate:${id}`,
      metadata: { extraction: { provider: c.provider, rationale: c.rationale, evidence: c.evidence, speaker: c.speaker, flags: c.flags } },
    },
    actor
  );
  await closeCandidate(id, 'Approved', actor, memory.id);
  await audit(actor, 'candidate.approve', id, 'ok', { memoryId: memory.id, edited: Object.keys(edits) });
  return memory;
}

export async function rejectCandidate(id: string, actor: Actor, reason = ''): Promise<void> {
  await loadPending(id);
  await closeCandidate(id, 'Rejected', actor, null);
  await audit(actor, 'candidate.reject', id, 'ok', { reason: reason.slice(0, LIMITS.reason) });
}

// Merge into an existing memory: its text becomes `merged` (written by the Admin, or the candidate's text appended)
export async function mergeCandidate(id: string, targetId: string, merged: string | null, actor: Actor): Promise<MemoryRecord> {
  const c = await loadPending(id);
  const config = await getConfig();
  const target = await getMemory(targetId, config.providers.embeddingModel);
  if (!target) throw new NotFoundError('memory');
  if (target.isLocked) throw new LockedError('The target memory is locked; unlock it first');
  const content = merged?.trim() || `${target.content.replace(/[.\s]*$/, '.')} ${c.content}`;
  const after = await updateMemory(targetId, { content }, target.version, actor, { changeType: 'merge', reason: `Merged candidate ${id}` });
  await closeCandidate(id, 'Merged', actor, after.id);
  await audit(actor, 'candidate.merge', id, 'ok', { memoryId: targetId });
  return after;
}

// Replace an existing memory: the candidate becomes a new memory that supersedes it (the old one is kept as
// Superseded, with a supersedes relationship), so its history stays visible
export async function replaceWithCandidate(id: string, targetId: string, actor: Actor, edits: ApproveEdits = {}): Promise<MemoryRecord> {
  const c = await loadPending(id);
  const config = await getConfig();
  const target = await getMemory(targetId, config.providers.embeddingModel);
  if (!target) throw new NotFoundError('memory');
  if (target.isLocked) throw new LockedError('The target memory is locked; unlock it first');
  const memory = await transaction(async (db) => {
    const old = await updateMemory(targetId, { status: 'Superseded' }, target.version, actor, { changeType: 'superseded', reason: `Replaced by candidate ${id}`, db });
    const { memory } = await createMemory(
      {
        title: edits.title ?? c.title,
        content: edits.content ?? c.content,
        namespaceId: edits.namespaceId ?? target.namespaceId,
        categoryId: edits.categoryId ?? c.categoryId,
        importance: edits.importance ?? Math.max(c.importance, old.importance),
        confidence: c.confidence,
        supersedesMemoryId: targetId,
        sourceApplication: c.sourceApplication,
        sourceModel: c.sourceModel,
        sourceType: 'extraction',
        sourceReference: `candidate:${id}`,
        isLocked: edits.lock === true,
      },
      actor,
      { db }
    );
    await addRelationship({ fromId: memory.id, toId: targetId, type: 'supersedes', origin: 'system' }, actor, db);
    return memory;
  });
  await closeCandidate(id, 'Approved', actor, memory.id);
  await audit(actor, 'candidate.replace', id, 'ok', { memoryId: memory.id, superseded: targetId });
  return memory;
}

// Bulk: only candidates without conflicts, sensitive content or injection flags are eligible
export async function bulkDecide(ids: string[], decision: 'approve' | 'reject', actor: Actor, allowedNamespaceIds?: string[]): Promise<{ done: string[]; skipped: { id: string; reason: string }[] }> {
  const done: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const { items } = await listCandidates({ ids: ids.slice(0, 200), status: 'Pending', limit: 200 });
  for (const id of ids) if (!items.some((c) => c.id === id)) skipped.push({ id, reason: 'notPending' });
  for (const c of items) {
    try {
      if (decision === 'reject') {
        await rejectCandidate(c.id, actor, 'bulk');
        done.push(c.id);
        continue;
      }
      if (c.conflicts.length) skipped.push({ id: c.id, reason: 'hasConflict' });
      else if (c.sensitivity !== 'none') skipped.push({ id: c.id, reason: 'sensitive' });
      else if (c.flags.includes('possibleInjection')) skipped.push({ id: c.id, reason: 'possibleInjection' });
      else if (c.operation !== 'add') skipped.push({ id: c.id, reason: 'notAnAdd' });
      else {
        await approveCandidate(c.id, {}, actor, { allowedNamespaceIds });
        done.push(c.id);
      }
    } catch (error) {
      skipped.push({ id: c.id, reason: error instanceof Error ? error.message.slice(0, 100) : 'failed' });
    }
  }
  await audit(actor, `candidate.bulk.${decision}`, null, 'ok', { done: done.length, skipped: skipped.length });
  return { done, skipped };
}

// ---- Conflicts ----

export type Conflict = {
  id: string;
  kind: string;
  status: string;
  similarity: number | null;
  explanation: string;
  recommended: string;
  detectedBy: string;
  createdAt: string;
  existing: { id: string; title: string; content: string; isLocked: boolean; confidence: number; updatedAt: string; createdAt: string; version: number; sourceApplication: string; namespacePath: string } | null;
  proposed: { kind: 'candidate' | 'memory'; id: string; title: string; content: string; confidence: number; createdAt: string; evidence: string; sourceApplication: string } | null;
  resolution: string | null;
};

export async function listConflicts(f: { status?: 'open' | 'resolved' | 'all'; namespaceIds?: string[]; limit?: number }): Promise<Conflict[]> {
  await ensureMemorySchema();
  const params: unknown[] = [];
  const where: string[] = [];
  if (f.status !== 'all') where.push(f.status === 'resolved' ? `k.status = 'Resolved'` : `k.status <> 'Resolved'`);
  if (f.namespaceIds) {
    params.push(f.namespaceIds);
    where.push(`e.namespace_id = ANY($${params.length}::uuid[])`);
  }
  const rows = await query<Record<string, unknown>>(
    `SELECT k.*, e.title AS e_title, e.content AS e_content, e.is_locked AS e_locked, e.confidence AS e_conf, e.updated_at AS e_updated, e.created_at AS e_created,
            e.version AS e_version, e.source_application AS e_app, n.path AS e_ns,
            c.title AS c_title, c.content AS c_content, c.confidence AS c_conf, c.created_at AS c_created, c.evidence AS c_evidence, c.source_application AS c_app,
            o.title AS o_title, o.content AS o_content, o.confidence AS o_conf, o.created_at AS o_created, o.source_application AS o_app
     FROM ai_memory."MemoryConflicts" k
     JOIN ai_memory."Memories" e ON e.id = k.existing_memory_id
     JOIN ai_memory."MemoryNamespaces" n ON n.id = e.namespace_id
     LEFT JOIN ai_memory."MemoryCandidates" c ON c.id = k.candidate_id
     LEFT JOIN ai_memory."Memories" o ON o.id = k.other_memory_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY k.created_at DESC LIMIT ${Math.min(200, f.limit ?? 100)}`,
    params
  );
  return rows.map((r) => ({
    id: r.id as string,
    kind: r.kind as string,
    status: r.status as string,
    similarity: r.similarity === null ? null : Number(r.similarity),
    explanation: r.explanation as string,
    recommended: r.recommended as string,
    detectedBy: r.detected_by as string,
    createdAt: new Date(r.created_at as Date).toISOString(),
    resolution: (r.resolution as string) ?? null,
    existing: {
      id: r.existing_memory_id as string,
      title: r.e_title as string,
      content: r.e_content as string,
      isLocked: r.e_locked as boolean,
      confidence: Number(r.e_conf),
      updatedAt: new Date(r.e_updated as Date).toISOString(),
      createdAt: new Date(r.e_created as Date).toISOString(),
      version: Number(r.e_version),
      sourceApplication: r.e_app as string,
      namespacePath: r.e_ns as string,
    },
    proposed: r.candidate_id
      ? { kind: 'candidate', id: r.candidate_id as string, title: r.c_title as string, content: r.c_content as string, confidence: Number(r.c_conf), createdAt: new Date(r.c_created as Date).toISOString(), evidence: r.c_evidence as string, sourceApplication: r.c_app as string }
      : r.other_memory_id
        ? { kind: 'memory', id: r.other_memory_id as string, title: r.o_title as string, content: r.o_content as string, confidence: Number(r.o_conf), createdAt: new Date(r.o_created as Date).toISOString(), evidence: '', sourceApplication: r.o_app as string }
        : null,
  }));
}

// A person's resolution. Locked memories refuse anything that would change them; automatic resolution doesn't exist
// unless System Settings turns it on, and even then never touches a locked memory.
export async function resolveConflict(id: string, resolution: ConflictResolution, actor: Actor, options: { mergedContent?: string | null; note?: string } = {}): Promise<{ memoryId: string | null }> {
  const list = await listConflicts({ status: 'all', limit: 200 });
  const k = list.find((x) => x.id === id);
  if (!k || !k.existing) throw new NotFoundError('conflict');
  if (k.status === 'Resolved') throw new InputError('alreadyResolved');
  const changesExisting = ['replace', 'merge', 'supersede'].includes(resolution);
  if (changesExisting && k.existing.isLocked) throw new LockedError('The existing memory is locked; unlock it first');
  let memoryId: string | null = null;
  const candidateId = k.proposed?.kind === 'candidate' ? k.proposed.id : null;
  switch (resolution) {
    case 'defer':
      await query(`UPDATE ai_memory."MemoryConflicts" SET status = 'Deferred' WHERE id = $1`, [id]);
      await audit(actor, 'conflict.defer', id, 'ok');
      return { memoryId: null };
    case 'keepExisting':
    case 'reject':
      if (candidateId) await rejectCandidate(candidateId, actor, `conflict ${resolution}`);
      memoryId = k.existing.id;
      break;
    case 'replace':
    case 'supersede':
      if (candidateId) memoryId = (await replaceWithCandidate(candidateId, k.existing.id, actor)).id;
      else if (k.proposed) {
        await updateMemory(k.existing.id, { status: 'Superseded' }, k.existing.version, actor, { changeType: 'superseded', reason: `Conflict ${id}` });
        await addRelationship({ fromId: k.proposed.id, toId: k.existing.id, type: 'supersedes', origin: 'system' }, actor);
        memoryId = k.proposed.id;
      }
      break;
    case 'merge':
      if (candidateId) memoryId = (await mergeCandidate(candidateId, k.existing.id, options.mergedContent ?? null, actor)).id;
      else if (k.proposed) {
        const content = options.mergedContent?.trim() || `${k.existing.content} ${k.proposed.content}`;
        memoryId = (await updateMemory(k.existing.id, { content }, k.existing.version, actor, { changeType: 'merge', reason: `Conflict ${id}` })).id;
      }
      break;
    case 'keepBoth': {
      // Both stay, each with when it was true, and a relationship saying they disagree
      if (candidateId) {
        const m = await approveCandidate(candidateId, {}, actor, { separate: true });
        memoryId = m.id;
        await addRelationship({ fromId: m.id, toId: k.existing.id, type: 'contradicts', origin: 'manual', note: options.note ?? 'Kept both with temporal context' }, actor);
      } else if (k.proposed) {
        await addRelationship({ fromId: k.proposed.id, toId: k.existing.id, type: 'contradicts', origin: 'manual', note: options.note ?? 'Kept both with temporal context' }, actor);
        memoryId = k.proposed.id;
      }
      break;
    }
  }
  await query(`UPDATE ai_memory."MemoryConflicts" SET status = 'Resolved', resolution = $2, resolved_by = $3, resolved_at = now() WHERE id = $1`, [id, resolution, actor.userId]);
  await audit(actor, 'conflict.resolve', id, 'ok', { resolution, memoryId });
  return { memoryId };
}
