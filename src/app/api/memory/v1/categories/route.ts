import { body, memoryRoute } from '@/lib/memory/api';
import { listCategories, saveCategory, type Category } from '@/lib/memory/store';

export const GET = memoryRoute({ scope: 'memory:read' }, async () => ({ categories: await listCategories() }));

export const POST = memoryRoute({ scope: 'memory:admin', perMinute: 60 }, async (request, caller) => {
  const b = await body(request, 16 * 1024);
  return { category: await saveCategory(null, b as Partial<Category> & { key?: string }, caller.actor) };
});
