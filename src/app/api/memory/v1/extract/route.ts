import { NextResponse } from 'next/server';
import { ApiError, body, memoryRoute, namespacesFor } from '@/lib/memory/api';
import { kickJobs } from '@/lib/memory/jobs';
import { writeNamespace } from '@/lib/memory/routeShared';
import { enqueueJob, getConfig } from '@/lib/memory/store';
import { str } from '@/lib/memory/validate';

// Queue memory extraction from a conversation (docs/AI_MEMORY_API.md): answers 202 at once with the job, so a
// conversation never waits for it. The same conversation and message (or Idempotency-Key) is queued once.
const MAX_MESSAGES = 40;
const MAX_CHARS = 8_000;

export const POST = memoryRoute({ scope: 'memory:extract', perMinute: 30 }, async (request, caller) => {
  const b = await body(request, 512 * 1024);
  const config = await getConfig();
  if (!config.system.enabled) throw new ApiError(409, 'memoryDisabled');
  const raw = Array.isArray(b.messages) ? b.messages : null;
  if (!raw || !raw.length || raw.length > MAX_MESSAGES) throw new ApiError(400, 'invalid', `messages must be 1-${MAX_MESSAGES} items`);
  const messages = raw.map((m, i) => {
    const r = m as Record<string, unknown>;
    if (!r || !['user', 'assistant', 'system'].includes(String(r.role)) || typeof r.content !== 'string') throw new ApiError(400, 'invalid', `messages[${i}] needs role and content`);
    return { role: r.role as 'user' | 'assistant' | 'system', content: r.content.slice(0, MAX_CHARS), id: typeof r.id === 'string' ? r.id.slice(0, 200) : null };
  });
  const namespaceId = await writeNamespace(caller, b.namespace ?? b.namespaceId);
  // The extraction may also file memories under this namespace's children, which the caller must be allowed too
  const scope = await namespacesFor(caller, [namespaceId], { includeChildren: true, includeGlobal: false });
  const conversationId = str(b.conversationId, 200, 'conversationId') ?? null;
  const messageId = str(b.messageId, 200, 'messageId') ?? null;
  const given = request.headers.get('idempotency-key');
  const key = given && /^[A-Za-z0-9._:-]{8,120}$/.test(given) ? `extract:${caller.clientId ?? caller.user.id}:${given}` : conversationId && messageId ? `extract:${caller.clientId ?? caller.user.id}:${conversationId}:${messageId}` : null;
  const job = await enqueueJob(
    null,
    'extract',
    {
      messages,
      namespaceId,
      allowedNamespaceIds: scope.map((n) => n.id),
      application: caller.client,
      conversationId,
      messageId,
      sourceModel: str(b.model, 100, 'model') ?? null,
      trigger: str(b.trigger, 40, 'trigger') ?? 'explicit',
      // The account the memories belong to: the end user a user-acting key speaks for, else the key's Admin
      userId: caller.actingUserId ?? caller.user.id,
      actingUserId: caller.actingUserId,
      ownerOverride: caller.ownerOverride,
    },
    { idempotencyKey: key, userId: caller.user.id, maxAttempts: config.system.jobMaxAttempts }
  );
  kickJobs();
  return NextResponse.json({ jobId: job.id, duplicate: !job.created, requestId: caller.requestId }, { status: 202 });
});
