import { ApiError, body, memoryRoute, namespacesFor } from '@/lib/memory/api';
import { bulkDecide } from '@/lib/memory/decisions';
import { kickJobs } from '@/lib/memory/jobs';
import { isUuid } from '@/lib/memory/rules';

// Bulk approve (eligible candidates only: no conflict, sensitivity or injection flag) or reject
export const POST = memoryRoute({ scope: 'memory:admin', perMinute: 20 }, async (request, caller) => {
  const b = await body(request);
  if (b.decision !== 'approve' && b.decision !== 'reject') throw new ApiError(400, 'invalid', 'decision is approve or reject');
  const ids = Array.isArray(b.ids) ? b.ids.filter(isUuid).slice(0, 200) : [];
  const allowed = (await namespacesFor(caller, null)).map((n) => n.id);
  const r = await bulkDecide(ids, b.decision, caller.actor, allowed);
  kickJobs();
  return r;
});
