import { body, memoryRoute } from '@/lib/memory/api';
import { query } from '@/lib/db';
import { parseRetrieval } from '@/lib/memory/rules';
import { ensureMemorySchema } from '@/lib/memory/schema';
import { audit } from '@/lib/memory/store';
import { cleanAppliesTo, str } from '@/lib/memory/validate';

// Named retrieval profiles: their parameters and what they apply to (models, applications, namespaces)
export const GET = memoryRoute({ scope: 'memory:admin' }, async () => {
  await ensureMemorySchema();
  const rows = await query<{ id: string; name: string; params: unknown; applies_to: unknown; updated_at: Date }>(`SELECT id, name, params, applies_to, updated_at FROM ai_memory."MemoryRetrievalProfiles" ORDER BY name`);
  return { profiles: rows.map((r) => ({ id: r.id, name: r.name, params: parseRetrieval(r.params), appliesTo: r.applies_to, updatedAt: r.updated_at.toISOString() })) };
});

export const POST = memoryRoute({ scope: 'memory:admin', perMinute: 30 }, async (request, caller) => {
  await ensureMemorySchema();
  const b = await body(request, 16 * 1024);
  const name = str(b.name, 80, 'name', true)!.trim();
  const appliesTo = cleanAppliesTo(b.appliesTo);
  const rows = await query<{ id: string }>(
    `INSERT INTO ai_memory."MemoryRetrievalProfiles" (name, params, applies_to, created_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (name) DO UPDATE SET params = EXCLUDED.params, applies_to = EXCLUDED.applies_to, updated_at = now() RETURNING id`,
    [name, JSON.stringify(parseRetrieval(b.params)), JSON.stringify(appliesTo), caller.user.id]
  );
  await audit(caller.actor, 'profile.save', rows[0].id, 'ok', { name });
  return { id: rows[0].id };
});
