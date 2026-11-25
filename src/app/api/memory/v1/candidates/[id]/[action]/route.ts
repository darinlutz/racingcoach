import { ApiError, body, memoryRoute, namespacesFor } from '@/lib/memory/api';
import { approveCandidate, mergeCandidate, rejectCandidate, replaceWithCandidate, type ApproveEdits } from '@/lib/memory/decisions';
import { kickJobs } from '@/lib/memory/jobs';
import { isUuid } from '@/lib/memory/rules';
import { bool, date, int, str, uuid } from '@/lib/memory/validate';

type Ctx = { params: Promise<{ id: string; action: string }> };

// approve | approveLocked | separate | reject | merge | replace (docs/AI_MEMORY_API.md)
export const POST = memoryRoute<Ctx>({ scope: 'memory:admin', perMinute: 240 }, async (request, caller, ctx) => {
  const { id, action } = await ctx.params;
  if (!isUuid(id)) throw new ApiError(404, 'notFound');
  const b = await body(request);
  const allowed = (await namespacesFor(caller, null)).map((n) => n.id);
  const edits: ApproveEdits = {
    title: str(b.title, 200, 'title'),
    content: str(b.content, 4000, 'content'),
    categoryId: uuid(b.categoryId, 'categoryId'),
    namespaceId: uuid(b.namespaceId, 'namespaceId'),
    importance: int(b.importance, 1, 10, 'importance'),
    expiresAt: date(b.expiresAt, 'expiresAt'),
    lock: action === 'approveLocked' ? true : bool(b.lock, 'lock'),
    pin: bool(b.pin, 'pin'),
  };
  for (const k of Object.keys(edits) as (keyof ApproveEdits)[]) if (edits[k] === undefined) delete edits[k];
  let result: unknown;
  switch (action) {
    case 'approve':
    case 'approveLocked':
      result = { memory: await approveCandidate(id, edits, caller.actor, { allowedNamespaceIds: allowed }) };
      break;
    case 'separate':
      result = { memory: await approveCandidate(id, edits, caller.actor, { separate: true, allowedNamespaceIds: allowed }) };
      break;
    case 'reject':
      await rejectCandidate(id, caller.actor, str(b.reason, 500, 'reason') ?? '');
      result = { rejected: true };
      break;
    case 'merge':
      result = { memory: await mergeCandidate(id, uuid(b.targetId, 'targetId', true)!, str(b.mergedContent, 4000, 'mergedContent') ?? null, caller.actor) };
      break;
    case 'replace':
      result = { memory: await replaceWithCandidate(id, uuid(b.targetId, 'targetId', true)!, caller.actor, edits) };
      break;
    default:
      throw new ApiError(404, 'notFound');
  }
  kickJobs();
  return result;
});
