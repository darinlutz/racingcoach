import { ApiError, body, createApiClient, listApiClients, memoryRoute, SCOPES, type Scope } from '@/lib/memory/api';
import { isUuid } from '@/lib/memory/rules';
import { str } from '@/lib/memory/validate';

// API clients (Open WebUI's filter, future apps). The key is shown once, when it's made; only its hash is kept.
export const GET = memoryRoute({ scope: 'memory:admin' }, async (_request, caller) => {
  if (caller.kind !== 'admin') throw new ApiError(403, 'adminOnly');
  return { clients: await listApiClients(), scopes: SCOPES.filter((s) => s !== 'memory:admin') };
});

export const POST = memoryRoute({ scope: 'memory:admin', perMinute: 10 }, async (request, caller) => {
  if (caller.kind !== 'admin') throw new ApiError(403, 'adminOnly');
  const b = await body(request, 8 * 1024);
  const subjects = Array.isArray(b.subjects) ? b.subjects.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim()) : [];
  return createApiClient(
    {
      name: str(b.name, 80, 'name', true)!,
      application: str(b.application, 40, 'application', true)!,
      scopes: (Array.isArray(b.scopes) ? b.scopes : []) as Scope[],
      namespaceIds: Array.isArray(b.namespaceIds) ? b.namespaceIds.filter(isUuid) : [],
      subjects,
      globalRead: b.globalRead === true,
    },
    caller.user,
    caller.actor
  );
});
