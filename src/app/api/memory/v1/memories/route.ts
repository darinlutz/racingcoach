import { kickJobs } from '@/lib/memory/jobs';
import { body, memoryRoute, namespacesFor, searchParams } from '@/lib/memory/api';
import { categoryId, writeNamespace } from '@/lib/memory/routeShared';
import { canCreateManually } from '@/lib/memory/rules';
import { createMemory, getConfig, listMemories } from '@/lib/memory/store';
import { createInput, filtersFrom } from '@/lib/memory/validate';
import { ApiError } from '@/lib/memory/api';
import { NextResponse } from 'next/server';

// GET: the Memory Library (filters, sort, pages); POST: a new memory (docs/AI_MEMORY_API.md)
export const GET = memoryRoute({ scope: 'memory:read' }, async (request, caller) => {
  const sp = searchParams(request);
  const config = await getConfig();
  const allowed = await namespacesFor(caller, sp.list('namespace').length ? sp.list('namespace') : null);
  return listMemories({ ...filtersFrom(sp), namespaceIds: allowed.map((n) => n.id) }, config.providers.embeddingModel);
});

export const POST = memoryRoute({ scope: 'memory:write', perMinute: 60 }, async (request, caller) => {
  const b = await body(request);
  const config = await getConfig();
  if (!config.system.enabled) throw new ApiError(409, 'memoryDisabled');
  if (!canCreateManually(config.system.defaultMode)) throw new ApiError(409, 'modeForbidsCreate', `Mode ${config.system.defaultMode} doesn't allow creating memories`);
  const namespaceId = await writeNamespace(caller, b.namespaceId ?? b.namespace);
  const input = createInput(b, namespaceId, await categoryId(b.categoryId ?? b.category));
  const result = await createMemory({ ...input, sourceApplication: caller.client, sourceType: caller.kind === 'admin' ? 'manual' : 'api' }, caller.actor);
  kickJobs();
  return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
});
