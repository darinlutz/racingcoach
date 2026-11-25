import { memoryRoute, searchParams } from '@/lib/memory/api';
import { readAudit } from '@/lib/memory/store';

export const GET = memoryRoute({ scope: 'memory:admin' }, async (request) => {
  const sp = searchParams(request);
  return { entries: await readAudit({ action: sp.str('action', 60), target: sp.str('target', 200), limit: sp.num('limit'), offset: sp.num('offset') }) };
});
