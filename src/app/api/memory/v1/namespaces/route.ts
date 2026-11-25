import { query } from '@/lib/db';
import { ApiError, body, memoryRoute, namespacesFor, searchParams } from '@/lib/memory/api';
import { NAMESPACE_KINDS, type NamespaceKind } from '@/lib/memory/rules';
import { ensureMemorySchema } from '@/lib/memory/schema';
import { audit, createNamespace, listNamespaces } from '@/lib/memory/store';
import { str } from '@/lib/memory/validate';

// GET: the shared namespaces this caller may read (an Admin: all of them, with how many users have their own
// space); ?user=<id> (Admins only) lists one user's own spaces, audited. A user-acting key sees its user's space.
// POST: a new shared namespace (users/ is reserved for users' own spaces).
export const GET = memoryRoute({ scope: 'memory:read' }, async (request, caller) => {
  await ensureMemorySchema();
  const sp = searchParams(request);
  const userId = sp.num('user');
  if (userId !== undefined) {
    if (caller.kind !== 'admin' || !Number.isInteger(userId)) throw new ApiError(404, 'notFound');
    const spaces = (await listNamespaces({ owners: [userId] })).filter((n) => n.ownerUserId === userId);
    await audit(caller.actor, 'namespace.userLookup', `u${userId}`, 'ok', { spaces: spaces.length });
    return { namespaces: spaces };
  }
  if (caller.kind === 'admin') {
    const [{ n }] = await query<{ n: number }>(`SELECT count(DISTINCT owner_user_id)::int AS n FROM ai_memory."MemoryNamespaces" WHERE owner_user_id IS NOT NULL`);
    return { namespaces: await listNamespaces(), userSpaces: n };
  }
  const allowed = await namespacesFor(caller, null);
  return { namespaces: allowed.map((n) => ({ id: n.id, path: n.path, kind: n.kind })) };
});

export const POST = memoryRoute({ scope: 'memory:admin', perMinute: 30 }, async (request, caller) => {
  const b = await body(request, 8 * 1024);
  if (!(NAMESPACE_KINDS as readonly unknown[]).includes(b.kind)) throw new ApiError(400, 'invalid', 'Unknown kind');
  return {
    namespace: await createNamespace(
      { path: str(b.path, 300, 'path', true)!.toLowerCase(), name: str(b.name, 100, 'name', true)!, kind: b.kind as NamespaceKind, description: str(b.description, 500, 'description'), isCustomerData: b.isCustomerData === true },
      caller.actor
    ),
  };
});
