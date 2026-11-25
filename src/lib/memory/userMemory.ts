import { query } from '@/lib/db';
import type { ChatMessage } from './intelligence';
import { retrieve, type RetrieveResult } from './retrieval';
import { canRetrieve, effectiveMode, USER_APPLICATION, type MemoryMode } from './rules';
import { ensureMemorySchema } from './schema';
import { enqueueJob, ensureUserNamespace, getConfig, getScoped, listNamespaces, type Actor } from './store';
import { kickJobs } from './jobs';

// Per-user memory for the site's own features (docs/AI_MEMORY_SECURITY.md, Per-user memory). Each signed-in user
// has their own space per application, users/u<id>/<application>; these helpers take the user's ID from the
// session (never from a request body) and reach only that space, plus approved global namespaces. Nothing here can
// name another user's space, and every query also carries the owner check in SQL (retrieval.ts, ownerGuard).
//
// Customer capture stays off until System Settings turns it on (customerCaptureEnabled): until then a user's
// space is read-only to extraction, so these return nothing new, and the user's own mode (MemorySettings user
// scope, e.g. Disabled when they opt out) always wins over the application's.

export type UserMemoryContext = Pick<RetrieveResult, 'context' | 'tokens' | 'degraded'> & { memoryIds: string[] };

async function userMode(userId: number, namespaceMode: MemoryMode | null): Promise<MemoryMode> {
  const config = await getConfig();
  const user = await getScoped<{ mode?: MemoryMode }>('user', String(userId));
  return effectiveMode(
    { global: config.system.defaultMode, namespace: namespaceMode, user: user?.mode ?? null },
    { memoryEnabled: config.system.enabled, customerData: true, customerCaptureEnabled: config.system.customerCaptureEnabled, sensitive: false, categoryRequiresApproval: false, categoryExtractionEligible: true }
  ).mode;
}

// The memory context for one of this user's requests, or empty when memory is off for them
export async function retrieveForUser(userId: number, text: string, application = 'racingcoach', options: { includeGlobal?: boolean } = {}): Promise<UserMemoryContext> {
  if (!USER_APPLICATION.test(application)) throw new Error('Bad application');
  const space = await ensureUserNamespace(userId, application);
  if (!canRetrieve(await userMode(userId, space.mode))) return { context: '', tokens: 0, degraded: 'disabledForUser', memoryIds: [] };
  const globals = options.includeGlobal === false ? [] : (await listNamespaces()).filter((n) => n.kind === 'global' && n.globalApproved && n.enabled).map((n) => n.id);
  const r = await retrieve({ query: text, namespaceIds: [space.id, ...globals], client: application, userId, owner: { actingUserId: userId, override: false } });
  return { context: r.context, tokens: r.tokens, degraded: r.degraded, memoryIds: r.memories.map((m) => m.id) };
}

// Queues extraction of this user's conversation into their own space (it waits for approval, or is discarded while
// customer capture is off: the extraction job applies the same ceilings)
export async function proposeForUser(userId: number, messages: ChatMessage[], application = 'racingcoach', source: { conversationId?: string; messageId?: string; model?: string } = {}): Promise<{ jobId: string } | null> {
  if (!USER_APPLICATION.test(application)) throw new Error('Bad application');
  const space = await ensureUserNamespace(userId, application);
  const mode = await userMode(userId, space.mode);
  if (!['approvalRequired', 'hybrid', 'automatic'].includes(mode)) return null;
  const key = source.conversationId && source.messageId ? `extract:user${userId}:${source.conversationId}:${source.messageId}` : null;
  const job = await enqueueJob(
    null,
    'extract',
    {
      messages: messages.slice(-20),
      namespaceId: space.id,
      allowedNamespaceIds: [space.id],
      application,
      conversationId: source.conversationId ?? null,
      messageId: source.messageId ?? null,
      sourceModel: source.model ?? null,
      trigger: 'turn',
      userId,
      actingUserId: userId,
      ownerOverride: false,
    },
    { idempotencyKey: key, userId }
  );
  kickJobs();
  return { jobId: job.id };
}

// The user's own memory spaces and how many memories each holds (their Account page, a privacy request)
export async function userSpaces(userId: number) {
  return (await listNamespaces({ owners: [userId] })).filter((n) => n.ownerUserId === userId).map((n) => ({ id: n.id, path: n.path, memoryCount: n.memoryCount }));
}

// Before an account is deleted: every Mem0 copy of the user's memories is queued for deletion (the rows themselves
// go with the account's cascade, and the outbox has no foreign key, so these deletions still run afterwards; a
// daily reconciliation removes anything missed). Never throws: Delete Account must not fail on the memory service.
export async function purgeUserMemory(userId: number, actor: Actor): Promise<{ queued: number }> {
  try {
    await ensureMemorySchema();
    const rows = await query<{ id: string; version: number }>(
      `SELECT m.id, m.version FROM ai_memory."Memories" m JOIN ai_memory."MemoryNamespaces" n ON n.id = m.namespace_id
       WHERE m.user_id = $1 OR n.owner_user_id = $1`,
      [userId]
    );
    for (const r of rows) {
      await query(`INSERT INTO ai_memory."MemoryProviderSync" (memory_id, provider, operation, memory_version) VALUES ($1, 'mem0', 'delete', $2)`, [r.id, Number(r.version) + 1]);
    }
    await query(`INSERT INTO ai_memory."MemoryAuditLog" (actor_user_id, action, target, outcome, detail) VALUES ($1, 'user.purge', $2, 'ok', $3)`, [actor.userId, `u${userId}`, JSON.stringify({ memories: rows.length })]);
    return { queued: rows.length };
  } catch (error) {
    console.error('Memory: could not queue the deleted account’s Mem0 copies for deletion:', error);
    return { queued: 0 };
  }
}
