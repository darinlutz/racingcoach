import { query } from '@/lib/db';
import { ensureMemorySchema } from './schema';
import { audit, deleteMemory, type Actor } from './store';

// AI Memory consent (docs/AI_MEMORY_SECURITY.md, Per-user memory): a customer's memory is processed on the basis of
// their consent, given with the Account page's AI Memory switch (src/components/AiMemoryCard.tsx,
// PUT /api/account/ai-memory) and recorded as racingcoach."Users".ai_memory_opt_in_at, each change also in the memory
// audit log. Without it the customer's data is Disabled (effectiveMode's customerOptedIn ceiling): their own space is
// never retrieved (retrieval.ts's owner guard) and nothing is extracted into it (userMemory.ts, extraction.ts). Turning
// it off deletes everything remembered about them, as consent withdrawn leaves no basis to keep it.

export type MemoryConsent = { optedIn: boolean; optedInAt: string | null };

export async function getMemoryConsent(userId: number): Promise<MemoryConsent> {
  const rows = await query<{ at: Date | null }>(`SELECT ai_memory_opt_in_at AS at FROM racingcoach."Users" WHERE id = $1`, [userId]);
  const at = rows[0]?.at ?? null;
  return { optedIn: at !== null, optedInAt: at ? at.toISOString() : null };
}

// Whether the person behind a piece of customer data opted in: the namespace's owner, else the conversation's user.
// Nobody known means no consent.
export async function customerOptedIn(ownerUserId: number | null | undefined, conversationUserId?: number | null): Promise<boolean> {
  const id = ownerUserId ?? conversationUserId ?? null;
  if (!id) return false;
  return (await getMemoryConsent(id)).optedIn;
}

// Turns AI Memory on (keeping the first opt-in time while it stays on) or off. Off deletes the user's memories
// permanently (tombstoned, so a queued extraction can't bring one back, and their Mem0 copies queued for deletion),
// discards what was waiting for approval and cancels extraction jobs still queued for them.
export async function setMemoryConsent(userId: number, on: boolean, actor: Actor): Promise<MemoryConsent & { deleted: number }> {
  await ensureMemorySchema();
  if (on) {
    await query(`UPDATE racingcoach."Users" SET ai_memory_opt_in_at = COALESCE(ai_memory_opt_in_at, now()) WHERE id = $1`, [userId]);
    await audit(actor, 'consent.optIn', `u${userId}`, 'ok');
    return { ...(await getMemoryConsent(userId)), deleted: 0 };
  }
  await query(`UPDATE racingcoach."Users" SET ai_memory_opt_in_at = NULL WHERE id = $1`, [userId]);
  await query(
    `UPDATE ai_memory."MemoryJobs" SET status = 'Cancelled', finished_at = now(), error = 'AI Memory turned off'
     WHERE status IN ('Pending', 'Deferred', 'Failed') AND (user_id = $1 OR payload->>'actingUserId' = $1::text OR payload->>'userId' = $1::text)`,
    [userId]
  );
  await query(
    `UPDATE ai_memory."MemoryCandidates" c SET status = 'Discarded' FROM ai_memory."MemoryNamespaces" n
     WHERE n.id = c.namespace_id AND c.status = 'Pending' AND (n.owner_user_id = $1 OR (c.user_id = $1 AND n.is_customer_data))`,
    [userId]
  );
  const rows = await query<{ id: string }>(
    `SELECT m.id FROM ai_memory."Memories" m JOIN ai_memory."MemoryNamespaces" n ON n.id = m.namespace_id
     WHERE n.owner_user_id = $1 OR (m.user_id = $1 AND n.is_customer_data)`,
    [userId]
  );
  let deleted = 0;
  for (const r of rows) if ((await deleteMemory(r.id, actor, { permanent: true, reason: 'AI Memory turned off by the user' })).deleted) deleted++;
  await audit(actor, 'consent.withdraw', `u${userId}`, 'ok', { deleted });
  return { optedIn: false, optedInAt: null, deleted };
}
