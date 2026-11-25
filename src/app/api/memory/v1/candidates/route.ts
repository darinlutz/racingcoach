import { memoryRoute, namespacesFor, searchParams } from '@/lib/memory/api';
import { listCandidates } from '@/lib/memory/decisions';

// The Approval Queue: candidates by status (Pending by default) in the caller's namespaces
export const GET = memoryRoute({ scope: 'memory:admin' }, async (request, caller) => {
  const sp = searchParams(request);
  const status = ['Pending', 'Approved', 'Rejected', 'Merged', 'Discarded'].includes(sp.str('status') ?? '') ? sp.str('status') : 'Pending';
  const allowed = await namespacesFor(caller, sp.list('namespace').length ? sp.list('namespace') : null);
  return listCandidates({ status, namespaceIds: allowed.map((n) => n.id), limit: sp.num('limit'), offset: sp.num('offset') });
});
