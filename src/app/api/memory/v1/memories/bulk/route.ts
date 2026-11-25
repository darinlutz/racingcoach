import { ApiError, body, memoryRoute, namespacesFor } from '@/lib/memory/api';
import { kickJobs } from '@/lib/memory/jobs';
import { isUuid } from '@/lib/memory/rules';
import { audit, deleteMemory, getConfig, listMemories, updateMemory, type MemoryPatch } from '@/lib/memory/store';
import { patchInput, str } from '@/lib/memory/validate';

// Bulk operations from the Memory Library (Admins only; the page confirms first): one change to many memories,
// each with its own version check and history entry; failures are listed, the rest still happen
const ACTIONS = ['archive', 'restore', 'delete', 'deletePermanent', 'pin', 'unpin', 'lock', 'unlock', 'enable', 'disable', 'patch'] as const;

export const POST = memoryRoute({ scope: 'memory:admin', perMinute: 30 }, async (request, caller) => {
  const b = await body(request);
  const action = b.action as (typeof ACTIONS)[number];
  if (!ACTIONS.includes(action)) throw new ApiError(400, 'invalid', 'Unknown action');
  const ids = Array.isArray(b.ids) ? b.ids.filter(isUuid).slice(0, 500) : [];
  if (!ids.length) throw new ApiError(400, 'invalid', 'No memories');
  const config = await getConfig();
  const allowed = (await namespacesFor(caller, null)).map((n) => n.id);
  const { items } = await listMemories({ ids, namespaceIds: allowed, limit: 200, statuses: ['Pending', 'Approved', 'Active', 'Archived', 'Superseded', 'Expired', 'Rejected', 'Deleted'] }, config.providers.embeddingModel);
  const patch: Record<string, MemoryPatch> = {
    archive: { status: 'Archived' },
    restore: { status: 'Active' },
    pin: { isPinned: true },
    unpin: { isPinned: false },
    lock: { isLocked: true },
    unlock: { isLocked: false },
    enable: { isActive: true },
    disable: { isActive: false },
    patch: action === 'patch' ? patchInput((b.patch ?? {}) as Record<string, unknown>) : {},
  };
  const done: string[] = [];
  const failed: { id: string; error: string }[] = [];
  const reason = str(b.reason, 200, 'reason') ?? `Bulk ${action}`;
  for (const m of items) {
    try {
      if (action === 'delete' || action === 'deletePermanent') await deleteMemory(m.id, caller.actor, { permanent: action === 'deletePermanent', reason });
      else await updateMemory(m.id, patch[action], m.version, caller.actor, { changeType: `bulk:${action}`, reason });
      done.push(m.id);
    } catch (error) {
      failed.push({ id: m.id, error: error instanceof Error ? error.message.slice(0, 150) : 'failed' });
    }
  }
  for (const id of ids) if (!items.some((m) => m.id === id)) failed.push({ id, error: 'notFound' });
  await audit(caller.actor, `memory.bulk.${action}`, null, 'ok', { done: done.length, failed: failed.length });
  kickJobs();
  return { done, failed };
});
