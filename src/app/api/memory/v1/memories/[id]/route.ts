import { body, memoryRoute, namespacesFor, ApiError } from '@/lib/memory/api';
import { kickJobs } from '@/lib/memory/jobs';
import { memoryFor } from '@/lib/memory/routeShared';
import { deleteMemory, listRelationships, updateMemory } from '@/lib/memory/store';
import { int, patchInput, str } from '@/lib/memory/validate';
import { query } from '@/lib/db';

type Ctx = { params: Promise<{ id: string }> };

// GET one memory with its relationships, recent retrievals and feedback; PATCH changes it (expectedVersion is
// required: optimistic concurrency); DELETE removes it (?permanent=true for a privacy deletion)
export const GET = memoryRoute<Ctx>({ scope: 'memory:read' }, async (_request, caller, ctx) => {
  const { id } = await ctx.params;
  const memory = await memoryFor(caller, id);
  const [relationships, retrievals, feedback] = await Promise.all([
    listRelationships([id]),
    query<{ at: Date; client: string; mode: string }>(`SELECT at, client, mode FROM ai_memory."MemoryAccessLog" WHERE $1::uuid = ANY(memory_ids) ORDER BY at DESC LIMIT 20`, [id]),
    query<{ rating: string; n: number }>(`SELECT rating, count(*)::int AS n FROM ai_memory."MemoryFeedback" WHERE memory_id = $1 GROUP BY rating`, [id]),
  ]);
  const conflicts = await query<{ id: string; status: string; kind: string }>(`SELECT id, status, kind FROM ai_memory."MemoryConflicts" WHERE existing_memory_id = $1 OR other_memory_id = $1 ORDER BY created_at DESC LIMIT 20`, [id]);
  return { memory, relationships, retrievals: retrievals.map((r) => ({ at: r.at.toISOString(), client: r.client, mode: r.mode })), feedback, conflicts };
});

export const PATCH = memoryRoute<Ctx>({ scope: 'memory:write', perMinute: 120 }, async (request, caller, ctx) => {
  const { id } = await ctx.params;
  const before = await memoryFor(caller, id);
  const b = await body(request);
  const expected = int(b.expectedVersion, 1, 1e9, 'expectedVersion');
  if (expected === undefined) throw new ApiError(400, 'invalid', 'expectedVersion is required');
  const patch = patchInput(b);
  if (patch.namespaceId && patch.namespaceId !== before.namespaceId) await namespacesFor(caller, [patch.namespaceId], { includeChildren: false });
  // Only an Admin may unlock a memory (API clients can't touch locks at all)
  if (caller.kind !== 'admin' && patch.isLocked !== undefined) throw new ApiError(403, 'adminOnly', 'Only an Admin can lock or unlock');
  const memory = await updateMemory(id, patch, expected, caller.actor, { automated: caller.kind !== 'admin', reason: str(b.reason, 500, 'reason') ?? null });
  kickJobs();
  return { memory };
});

export const DELETE = memoryRoute<Ctx>({ scope: 'memory:write', perMinute: 120 }, async (request, caller, ctx) => {
  const { id } = await ctx.params;
  await memoryFor(caller, id);
  const sp = new URL(request.url).searchParams;
  const permanent = sp.get('permanent') === 'true';
  const reason = (sp.get('reason') ?? (permanent ? 'Permanent deletion' : 'Deleted')).slice(0, 200);
  const r = await deleteMemory(id, caller.actor, { permanent, reason });
  kickJobs();
  return r;
});
