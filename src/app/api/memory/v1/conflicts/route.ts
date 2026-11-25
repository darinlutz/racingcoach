import { memoryRoute, namespacesFor, searchParams } from '@/lib/memory/api';
import { listConflicts } from '@/lib/memory/decisions';

export const GET = memoryRoute({ scope: 'memory:admin' }, async (request, caller) => {
  const sp = searchParams(request);
  const status = sp.str('status') === 'resolved' ? 'resolved' : sp.str('status') === 'all' ? 'all' : 'open';
  const allowed = await namespacesFor(caller, null);
  return { conflicts: await listConflicts({ status, namespaceIds: allowed.map((n) => n.id) }) };
});
