import { ApiError, body, memoryRoute, namespacesFor, searchParams } from '@/lib/memory/api';
import { query } from '@/lib/db';
import { memoryFor } from '@/lib/memory/routeShared';
import { RELATIONSHIP_TYPES, type RelationshipType } from '@/lib/memory/rules';
import { addRelationship, listRelationships } from '@/lib/memory/store';
import { str, uuid } from '@/lib/memory/validate';

// The relationship graph: memories (nodes) and relationships (edges) in the caller's namespaces
export const GET = memoryRoute({ scope: 'memory:admin' }, async (request, caller) => {
  const sp = searchParams(request);
  const allowed = (await namespacesFor(caller, sp.list('namespace').length ? sp.list('namespace') : null)).map((n) => n.id);
  const nodes = await query<{ id: string; title: string; key: string; color: string; path: string; status: string; importance: number }>(
    `SELECT m.id, m.title, c.key, c.color, n.path, m.status, m.importance FROM ai_memory."Memories" m
     JOIN ai_memory."MemoryCategories" c ON c.id = m.category_id JOIN ai_memory."MemoryNamespaces" n ON n.id = m.namespace_id
     WHERE m.namespace_id = ANY($1::uuid[]) AND m.status <> 'Deleted'
       AND (EXISTS (SELECT 1 FROM ai_memory."MemoryRelationships" r WHERE r.from_memory_id = m.id OR r.to_memory_id = m.id) OR $2::boolean)
     ORDER BY m.importance DESC, m.updated_at DESC LIMIT 400`,
    [allowed, sp.bool('all') === true]
  );
  const ids = nodes.map((n) => n.id);
  const edges = (await listRelationships(ids)).filter((e) => ids.includes(e.fromId) && ids.includes(e.toId));
  return { nodes: nodes.map((n) => ({ id: n.id, title: n.title, category: n.key, color: n.color, namespace: n.path, status: n.status, importance: Number(n.importance) })), edges };
});

export const POST = memoryRoute({ scope: 'memory:admin', perMinute: 60 }, async (request, caller) => {
  const b = await body(request, 8 * 1024);
  if (!(RELATIONSHIP_TYPES as readonly unknown[]).includes(b.type)) throw new ApiError(400, 'invalid', 'Unknown relationship type');
  const fromId = uuid(b.fromId, 'fromId', true)!;
  const toId = uuid(b.toId, 'toId', true)!;
  await memoryFor(caller, fromId);
  await memoryFor(caller, toId);
  return { relationship: await addRelationship({ fromId, toId, type: b.type as RelationshipType, note: str(b.note, 500, 'note') }, caller.actor) };
});
