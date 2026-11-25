import { ApiError, body, memoryRoute } from '@/lib/memory/api';
import { query } from '@/lib/db';
import { memoryFor } from '@/lib/memory/routeShared';
import { ensureMemorySchema } from '@/lib/memory/schema';
import { audit } from '@/lib/memory/store';
import { int, str, uuid } from '@/lib/memory/validate';

// Feedback on a retrieved memory: Helpful, Not helpful, Incorrect, Outdated, Irrelevant or Missing context
const RATINGS = ['helpful', 'notHelpful', 'incorrect', 'outdated', 'irrelevant', 'missingContext'];

export const POST = memoryRoute({ scope: 'memory:feedback', perMinute: 120 }, async (request, caller) => {
  await ensureMemorySchema();
  const b = await body(request, 8 * 1024);
  const rating = String(b.rating ?? '');
  if (!RATINGS.includes(rating)) throw new ApiError(400, 'invalid', 'Unknown rating');
  const memoryId = uuid(b.memoryId, 'memoryId');
  if (!memoryId && rating !== 'missingContext') throw new ApiError(400, 'invalid', 'memoryId is required');
  if (memoryId) await memoryFor(caller, memoryId);
  const accessLogId = int(b.accessLogId, 1, Number.MAX_SAFE_INTEGER, 'accessLogId') ?? null;
  const rows = await query<{ id: string }>(`INSERT INTO ai_memory."MemoryFeedback" (memory_id, access_log_id, user_id, rating, note) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [
    memoryId ?? null,
    accessLogId,
    caller.user.id,
    rating,
    str(b.note, 500, 'note') ?? '',
  ]);
  await audit(caller.actor, 'feedback.create', memoryId ?? null, 'ok', { rating });
  return { id: Number(rows[0].id) };
});
