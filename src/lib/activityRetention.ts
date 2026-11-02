// How long IP addresses and browser details are kept, and what's left of a deleted account's website activity
// (Privacy Policy, Section 7). No imports but node's, so users.ts can use it without a cycle and the database tests
// run it directly.
//
// - 13 months after the event, "ActivityLog" rows lose their IP address and browser details (user agent, viewport size,
//   browser language) and "AiUsage" rows their IP address; the rest of each row stays (purgeNetworkDetails, hourly
//   from privacyJobs.ts's sweep).
// - Deleting an account anonymizes its activity rows, and the same browser's signed-out rows, in the same transaction
//   (ANONYMIZE_DELETED_ACCOUNT_ACTIVITY_SQL, run by deleteUserWith): no account, a new random visitor ID so they can't
//   be tied back to the browser's cookie or earlier visits, and none of the IP address, browser details, referrer or
//   the text and link of what was clicked. Another account's rows from a shared browser are untouched.
import { randomUUID } from 'node:crypto';

export const NETWORK_DETAILS_RETENTION_MONTHS = 13;

// $1 the account, $2 a new random visitor ID
export const ANONYMIZE_DELETED_ACCOUNT_ACTIVITY_SQL = `
  UPDATE racingcoach."ActivityLog" SET user_id = NULL, visitor_id = $2, ip_address = NULL, user_agent = NULL,
    viewport_width = NULL, viewport_height = NULL, language = NULL, referrer = NULL, label = NULL, target_href = NULL
  WHERE user_id = $1 OR (user_id IS NULL AND visitor_id IN (
    SELECT DISTINCT visitor_id FROM racingcoach."ActivityLog" WHERE user_id = $1))`;

export const anonymizeParams = (userId: number) => [userId, randomUUID()];

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null }> };

const BATCH = 5000;

// Clears IP addresses and browser details older than the period, in batches (each its own statement, so a large
// backlog never holds long locks). Answers how many rows were cleared.
export async function purgeNetworkDetails(client: Queryable): Promise<number> {
  const cutoff = `now() - make_interval(months => ${NETWORK_DETAILS_RETENTION_MONTHS})`;
  const statements = [
    `UPDATE racingcoach."ActivityLog" SET ip_address = NULL, user_agent = NULL, viewport_width = NULL, viewport_height = NULL, language = NULL
     WHERE id IN (SELECT id FROM racingcoach."ActivityLog" WHERE occurred_at < ${cutoff}
       AND (ip_address IS NOT NULL OR user_agent IS NOT NULL OR viewport_width IS NOT NULL OR viewport_height IS NOT NULL OR language IS NOT NULL)
       LIMIT ${BATCH})`,
    `UPDATE racingcoach."AiUsage" SET ip_address = NULL
     WHERE id IN (SELECT id FROM racingcoach."AiUsage" WHERE occurred_at < ${cutoff} AND ip_address IS NOT NULL LIMIT ${BATCH})`,
  ];
  let cleared = 0;
  for (const sql of statements) {
    // At most 200 batches a run; the next hour carries on
    for (let i = 0; i < 200; i += 1) {
      const { rowCount } = await client.query(sql);
      cleared += rowCount ?? 0;
      if (!rowCount || rowCount < BATCH) break;
    }
  }
  return cleared;
}
