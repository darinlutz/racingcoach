import { ApiError, body, memoryRoute } from '@/lib/memory/api';
import { kickJobs } from '@/lib/memory/jobs';
import { memoryFor } from '@/lib/memory/routeShared';
import { restoreVersion } from '@/lib/memory/store';
import { int } from '@/lib/memory/validate';

type Ctx = { params: Promise<{ id: string }> };

// Writes an earlier version again as the newest one (Admins only), and re-embeds it
export const POST = memoryRoute<Ctx>({ scope: 'memory:admin', perMinute: 60 }, async (request, caller, ctx) => {
  const { id } = await ctx.params;
  await memoryFor(caller, id);
  const b = await body(request);
  const version = int(b.version, 1, 1e9, 'version');
  const expected = int(b.expectedVersion, 1, 1e9, 'expectedVersion');
  if (version === undefined || expected === undefined) throw new ApiError(400, 'invalid', 'version and expectedVersion are required');
  const memory = await restoreVersion(id, version, expected, caller.actor);
  kickJobs();
  return { memory };
});
