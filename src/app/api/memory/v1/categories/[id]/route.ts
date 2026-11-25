import { ApiError, body, memoryRoute } from '@/lib/memory/api';
import { isUuid } from '@/lib/memory/rules';
import { saveCategory, type Category } from '@/lib/memory/store';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = memoryRoute<Ctx>({ scope: 'memory:admin', perMinute: 60 }, async (request, caller, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) throw new ApiError(404, 'notFound');
  const b = await body(request, 16 * 1024);
  delete b.key;
  return { category: await saveCategory(id, b as Partial<Category>, caller.actor) };
});
