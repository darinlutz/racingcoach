import { ApiError, body, memoryRoute } from '@/lib/memory/api';
import { query } from '@/lib/db';
import { isUuid, parseRetrieval } from '@/lib/memory/rules';
import { audit } from '@/lib/memory/store';
import { cleanAppliesTo } from '@/lib/memory/validate';

type Ctx = { params: Promise<{ id: string }> };

export const PUT = memoryRoute<Ctx>({ scope: 'memory:admin', perMinute: 30 }, async (request, caller, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) throw new ApiError(404, 'notFound');
  const b = await body(request, 16 * 1024);
  const r = await query(`UPDATE ai_memory."MemoryRetrievalProfiles" SET params = $2, applies_to = $3, updated_at = now() WHERE id = $1 RETURNING id`, [id, JSON.stringify(parseRetrieval(b.params)), JSON.stringify(cleanAppliesTo(b.appliesTo))]);
  if (!r.length) throw new ApiError(404, 'notFound');
  await audit(caller.actor, 'profile.update', id, 'ok');
  return { ok: true };
});

export const DELETE = memoryRoute<Ctx>({ scope: 'memory:admin', perMinute: 30 }, async (_request, caller, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) throw new ApiError(404, 'notFound');
  await query(`DELETE FROM ai_memory."MemoryRetrievalProfiles" WHERE id = $1`, [id]);
  await audit(caller.actor, 'profile.delete', id, 'ok');
  return { ok: true };
});
