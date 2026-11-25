import { query } from '@/lib/db';
import { pickProvider, type ChatMessage, type Similar, type Usage } from './intelligence';
import { OfflineError } from './localServices';
import {
  candidateDecision,
  conflictCandidatePairs,
  effectiveMode,
  looksContradictory,
  validateCandidate,
  type MemoryMode,
  type ValidCandidate,
} from './rules';
import { contentHash, createMemory, getConfig, getScoped, listCategories, listNamespaces, TombstonedError, type Actor } from './store';

// The extraction pipeline (docs/AI_MEMORY_ARCHITECTURE.md, Extraction), run by the job worker, never inside a
// conversation's request: eligibility, the provider's candidates, validation, sensitivity, duplicates, conflicts,
// the effective operating mode, then a Pending candidate for the Approval Queue or (Automatic/Hybrid, low risk) an
// approved memory. Every candidate is stored, including the ones discarded (as Discarded, with why), so analytics
// can count duplicates and rejections; secrets are stored only as "[redacted]".

export type ExtractPayload = {
  messages: ChatMessage[];
  namespaceId: string;
  allowedNamespaceIds: string[];
  application: string;
  conversationId?: string | null;
  messageId?: string | null;
  sourceModel?: string | null;
  trigger?: string;
  userId: number | null;
  // Who queued it, for the owner check (the end user a key acts for, or an Admin's override)
  actingUserId?: number | null;
  ownerOverride?: boolean;
};

export type ExtractOutcome = {
  skipped?: string;
  provider?: string;
  fellBack?: string | null;
  mode?: MemoryMode;
  proposed: number;
  queued: number;
  autoSaved: number;
  discarded: Record<string, number>;
  conflicts: number;
  usage: Usage[];
  degraded: string[];
};

export class DeferError extends Error {
  constructor(public reason: string, public delayMs = 120_000) {
    super(reason);
  }
}

export async function runExtraction(jobId: string, payload: ExtractPayload): Promise<ExtractOutcome> {
  const config = await getConfig();
  const outcome: ExtractOutcome = { proposed: 0, queued: 0, autoSaved: 0, discarded: {}, conflicts: 0, usage: [], degraded: [] };
  const discard = (why: string) => (outcome.discarded[why] = (outcome.discarded[why] ?? 0) + 1);
  if (!config.system.enabled) return { ...outcome, skipped: 'memoryDisabled' };
  if (config.extraction.paused) throw new DeferError('extractionPaused', 10 * 60_000);

  // The job's own namespaces, owned ones included (they were authorized when it was queued)
  const namespaces = await listNamespaces({ refs: [payload.namespaceId, ...payload.allowedNamespaceIds] });
  const ns = namespaces.find((n) => n.id === payload.namespaceId);
  const owner = { actingUserId: payload.actingUserId ?? null, override: payload.ownerOverride === true };
  // Defense in depth: a job whose namespace belongs to someone else than who queued it does nothing
  if (ns?.ownerUserId && !owner.override && ns.ownerUserId !== owner.actingUserId) return { ...outcome, skipped: 'notOwner' };
  if (!ns || !ns.enabled) return { ...outcome, skipped: 'namespaceUnavailable' };
  const categories = (await listCategories()).filter((c) => c.enabled);
  const application = await getScoped<{ mode?: MemoryMode }>('application', payload.application);
  const user = payload.userId ? await getScoped<{ mode?: MemoryMode }>('user', String(payload.userId)) : null;
  const layersFor = (categoryMode: MemoryMode | null) => ({ global: config.system.defaultMode, application: application?.mode ?? null, namespace: ns.mode, category: categoryMode, user: user?.mode ?? null });

  // Nothing extracted at all unless the namespace's mode (before category ceilings) allows it
  const baseline = effectiveMode(layersFor(null), {
    memoryEnabled: config.system.enabled,
    customerData: ns.isCustomerData,
    customerCaptureEnabled: config.system.customerCaptureEnabled,
    sensitive: false,
    categoryRequiresApproval: false,
    categoryExtractionEligible: true,
  });
  outcome.mode = baseline.mode;
  if (!['approvalRequired', 'hybrid', 'automatic'].includes(baseline.mode)) return { ...outcome, skipped: `mode:${baseline.mode}` };

  const today = await query<{ n: number }>(`SELECT count(*)::int AS n FROM ai_memory."MemoryCandidates" WHERE created_at >= date_trunc('day', now())`);
  if ((today[0]?.n ?? 0) >= config.extraction.maxPerDay) throw new DeferError('dailyLimit', msUntilTomorrow());

  const messages = payload.messages.filter((m) => typeof m.content === 'string' && m.content.trim()).slice(-40);
  if (!messages.some((m) => m.role === 'user')) return { ...outcome, skipped: 'noUserMessage' };

  // A provider that can't be reached defers the job (local-first: nothing is sent elsewhere unless policy says so)
  let picked;
  try {
    picked = await pickProvider(config);
  } catch (error) {
    if (error instanceof OfflineError) throw new DeferError(`provider:${error.reason}`);
    throw error;
  }
  outcome.provider = picked.provider.id;
  outcome.fellBack = picked.fellBack;
  const scope = namespaces.filter((n) => payload.allowedNamespaceIds.includes(n.id));
  const scopeIds = scope.map((n) => n.id);
  let raw;
  try {
    raw = await picked.provider.extractCandidates({ owner, messages, namespacePath: ns.path, namespaceIds: scopeIds, categories: categories.filter((c) => c.extractionEligible).map((c) => ({ key: c.key, description: c.description })), jobId, config });
  } catch (error) {
    if (error instanceof OfflineError) throw new DeferError(`extraction:${error.reason}`);
    throw error;
  }
  outcome.usage.push(...raw.usage);

  const keys = categories.map((c) => c.key);
  const valid: ValidCandidate[] = [];
  for (const r of raw.candidates) {
    const v = validateCandidate(r, keys);
    if (!v.ok) discard(v.reason);
    else valid.push(v.candidate);
  }
  outcome.proposed = valid.length;
  const seen = new Set<string>();

  for (const c of valid.slice(0, config.extraction.maxPerConversation)) {
    const hash = contentHash(c.content);
    if (seen.has(hash)) {
      discard('repeatedInConversation');
      continue;
    }
    seen.add(hash);
    // The proposed namespace only when it's one the caller may write; otherwise the job's own
    const target = (c.namespacePath && scope.find((n) => n.path === c.namespacePath)) || ns;
    const category = categories.find((x) => x.key === c.categoryKey) ?? categories.find((x) => x.key === 'semantic')!;
    const flags: string[] = [...c.sensitiveKinds.map((k) => `sensitive:${k}`)];
    if (c.injection) flags.push('possibleInjection');
    if (c.speaker === 'assistant') flags.push('assistantStatement');

    if (c.sensitivity === 'secret') {
      await insertCandidate(jobId, payload, target.id, category.id, c, hash, picked.provider.id, 'Discarded', ['secret', ...flags], null, null);
      discard('secret');
      continue;
    }
    if (c.operation === 'delete' && !config.extraction.allowDeleteProposals) {
      discard('deleteProposalsOff');
      continue;
    }
    if (c.operation === 'update' && !config.extraction.allowUpdateProposals) c.operation = 'add';

    // Duplicates and conflicts against what's already known in the caller's namespaces
    let similar: Similar[] = [];
    try {
      similar = await picked.provider.findSimilarMemories(c.content, scopeIds, scope.map((n) => n.path), owner);
    } catch (error) {
      flags.push('similarityUnavailable');
      outcome.degraded.push(error instanceof OfflineError ? `similarity:${error.reason}` : 'similarityFailed');
    }
    // An exact copy of an existing memory is a duplicate whatever the embeddings say
    const exact = await query<{ id: string }>(
      `SELECT id FROM ai_memory."Memories" WHERE content_hash = $1 AND namespace_id = ANY($2::uuid[]) AND status NOT IN ('Deleted', 'Rejected') LIMIT 1`,
      [hash, scopeIds]
    );
    const pairs = conflictCandidatePairs(similar, config.extraction);
    const duplicateOf = exact[0]?.id ?? pairs.duplicates[0]?.id ?? null;
    const target_memory: string | null = c.targetMemoryId && similar.some((s) => s.id === c.targetMemoryId) ? c.targetMemoryId : null;
    if (c.operation !== 'add' && !target_memory) c.operation = 'add';
    if (duplicateOf && c.operation === 'add') {
      await insertCandidate(jobId, payload, target.id, category.id, c, hash, picked.provider.id, 'Discarded', ['duplicate', ...flags], duplicateOf, null);
      discard('duplicate');
      continue;
    }

    // Conflicts: rule pre-check, confirmed by the model; similarity alone never makes one
    const toCheck = pairs.check.filter((s) => looksContradictory(s.content, c.content) || s.id === target_memory);
    const conflicts: { memoryId: string; explanation: string; recommended: string; locked: boolean; by: string }[] = [];
    if (toCheck.length) {
      try {
        const r = await picked.provider.detectPotentialConflicts(c.content, toCheck);
        outcome.usage.push(...r.usage);
        for (const v of r.verdicts) if (v.contradicts) conflicts.push({ memoryId: v.memoryId, explanation: v.explanation, recommended: v.recommended, locked: toCheck.find((s) => s.id === v.memoryId)?.isLocked ?? false, by: 'model' });
      } catch (error) {
        flags.push('conflictCheckUnavailable');
        // Without the model the rule's suspicion stands, for a person to decide
        for (const s of toCheck.filter((x) => looksContradictory(x.content, c.content))) conflicts.push({ memoryId: s.id, explanation: 'Possible contradiction (the conflict model was unavailable to confirm)', recommended: 'defer', locked: s.isLocked, by: 'rule' });
        outcome.degraded.push(error instanceof OfflineError ? `conflicts:${error.reason}` : 'conflictsFailed');
      }
    }
    // An update aimed at a locked memory is never applied: it becomes a conflict for a person
    const lockedTarget = target_memory ? similar.find((s) => s.id === target_memory)?.isLocked === true : false;
    if (lockedTarget && !conflicts.some((x) => x.memoryId === target_memory)) conflicts.push({ memoryId: target_memory!, explanation: 'The extraction proposed changing a locked memory', recommended: 'keepExisting', locked: true, by: 'rule' });

    const ceilings = {
      memoryEnabled: config.system.enabled,
      customerData: target.isCustomerData,
      customerCaptureEnabled: config.system.customerCaptureEnabled,
      sensitive: c.sensitivity === 'personal',
      categoryRequiresApproval: category.requiresApproval,
      categoryExtractionEligible: category.extractionEligible,
    };
    const mode = effectiveMode(layersFor(category.mode), ceilings).mode;
    let decision = candidateDecision(mode, { confidence: c.confidence, importance: c.importance, sensitivity: c.sensitivity, hasConflict: conflicts.length > 0 || lockedTarget, isDuplicate: Boolean(duplicateOf), operation: c.operation }, config.extraction);
    if (decision === 'autoSave' && (c.injection || flags.includes('similarityUnavailable') || c.speaker !== 'user')) decision = 'queue';
    if (decision === 'discard') {
      await insertCandidate(jobId, payload, target.id, category.id, c, hash, picked.provider.id, 'Discarded', ['belowThreshold', ...flags], duplicateOf, target_memory);
      discard('policy');
      continue;
    }

    if (decision === 'autoSave') {
      const actor: Actor = { userId: null, system: `extraction:${jobId}` };
      try {
        const { memory } = await createMemory(
          {
            title: c.title,
            content: c.content,
            namespaceId: target.id,
            categoryId: category.id,
            importance: c.importance,
            confidence: c.confidence,
            expiresAt: c.expiresInDays ? new Date(Date.now() + c.expiresInDays * 86_400_000).toISOString() : undefined,
            sourceModel: payload.sourceModel ?? null,
            sourceConversationId: payload.conversationId ?? null,
            sourceMessageId: payload.messageId ?? null,
            sourceApplication: payload.application,
            sourceType: 'extraction',
            sourceReference: `job:${jobId}`,
            ownerUserId: payload.userId,
            metadata: { extraction: { provider: picked.provider.id, rationale: c.rationale, evidence: c.evidence } },
          },
          actor,
          { automated: true }
        );
        await insertCandidate(jobId, payload, target.id, category.id, c, hash, picked.provider.id, 'Approved', ['autoSaved', ...flags], null, null, memory.id);
        outcome.autoSaved++;
      } catch (error) {
        if (error instanceof TombstonedError) {
          discard('previouslyDeleted');
          continue;
        }
        throw error;
      }
      continue;
    }

    const candidateId = await insertCandidate(jobId, payload, target.id, category.id, c, hash, picked.provider.id, 'Pending', flags, duplicateOf, target_memory);
    outcome.queued++;
    for (const k of conflicts) {
      await query(
        `INSERT INTO ai_memory."MemoryConflicts" (existing_memory_id, candidate_id, kind, similarity, explanation, recommended, detected_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [k.memoryId, candidateId, k.locked ? 'lockedChange' : 'contradiction', similar.find((s) => s.id === k.memoryId)?.similarity ?? null, k.explanation, k.recommended, k.by]
      );
      outcome.conflicts++;
    }
  }
  return outcome;
}

async function insertCandidate(
  jobId: string,
  p: ExtractPayload,
  namespaceId: string,
  categoryId: string,
  c: ValidCandidate,
  hash: string,
  provider: string,
  status: 'Pending' | 'Approved' | 'Discarded',
  flags: string[],
  duplicateOf: string | null,
  targetMemoryId: string | null,
  resultMemoryId: string | null = null
): Promise<string> {
  const rows = await query<{ id: string }>(
    `INSERT INTO ai_memory."MemoryCandidates" (job_id, user_id, namespace_id, category_id, title, content, importance, confidence, operation, target_memory_id,
       duplicate_of, evidence, rationale, speaker, sensitivity, flags, expires_at, source_application, source_model, source_conversation_id, source_message_id,
       provider, content_hash, status, result_memory_id, decided_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26) RETURNING id`,
    [
      jobId,
      p.userId,
      namespaceId,
      categoryId,
      c.title,
      c.content,
      c.importance,
      c.confidence,
      c.operation === 'none' ? 'add' : c.operation,
      targetMemoryId,
      duplicateOf,
      c.evidence,
      c.rationale,
      c.speaker,
      c.sensitivity,
      [...new Set(flags)],
      c.expiresInDays ? new Date(Date.now() + c.expiresInDays * 86_400_000) : null,
      p.application.slice(0, 60),
      p.sourceModel ?? null,
      p.conversationId?.slice(0, 200) ?? null,
      p.messageId?.slice(0, 200) ?? null,
      provider,
      hash,
      status,
      resultMemoryId,
      status === 'Pending' ? null : new Date(),
    ]
  );
  return rows[0].id;
}

function msUntilTomorrow(): number {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5);
  return next - now.getTime();
}
