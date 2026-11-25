import { ApiError, body, memoryRoute, namespacesFor } from '@/lib/memory/api';
import { createExport, listExports } from '@/lib/memory/importExport';
import { isUuid } from '@/lib/memory/rules';

export const GET = memoryRoute({ scope: 'memory:admin' }, async (_request, caller) => ({ exports: await listExports(caller.user.id) }));

export const POST = memoryRoute({ scope: 'memory:admin', perMinute: 10 }, async (request, caller) => {
  const b = await body(request, 64 * 1024);
  if (b.format !== 'json' && b.format !== 'jsonl' && b.format !== 'csv') throw new ApiError(400, 'invalid', 'format is json, jsonl or csv');
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter(isUuid) : undefined);
  const allowed = (await namespacesFor(caller, ids(b.namespaceIds)?.length ? ids(b.namespaceIds)! : null)).map((n) => n.id);
  return createExport({ format: b.format, namespaceIds: allowed, categoryIds: ids(b.categoryIds), ids: ids(b.ids), approvedOnly: b.approvedOnly === true, includeHistory: b.includeHistory === true }, { ...caller.actor, userId: caller.user.id });
});
