// Erasure (GDPR Article 17): Request Data Deletion's categories (eraseCategories, run by privacyJobs.ts) and Delete My
// Account (deleteAccount), each recorded in the erasure ledger ("ErasureLedger"), and re-applied to a database restored
// from a backup (reapplyErasures). Every statement is scoped to one account and can run again with the same result, so
// a retried or repeated job is safe.
//
// The ledger holds no personal data beyond an account's internal ID and creation time. It's also copied to object
// storage when that's configured: a database backup rolls the ledger back with everything else, but the copies stay,
// so the deletions made since the backup are found and made again (docs/privacy-requests.md, Backups).
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, transaction, withClient } from './db';
import { clearLiveUpdate } from './liveRacing';
import { deleteVideoObject, downloadObjectBytes, listObjectKeys, uploadObjectBytes, videoStorageConfigured } from './objectStorage';
import { createRequest, transitionWith, type PrivacyRequest } from './privacyRequests';
import type { ErasableCategory } from './privacyRules';
import { deleteUserWith, ensureUserSchema, type User } from './users';

type Queryable = Pick<PoolClient, 'query'>;

// $1 is the account, $2 the instant before which rows are erased (NULL: all of them; set when re-applying an erasure,
// so what the user added afterwards stays). Statements run in order on one transaction.
const STATEMENTS: Record<ErasableCategory, string[]> = {
  // A tombstone per lap first, so the collector can't upload it again (saveCollectorLap refuses with lapExpired and the
  // collector deletes its copy); the lap retention job purges tombstones once the lap would have expired anyway
  laps: [
    `INSERT INTO racingcoach."ExpiredLaps" (user_id, client_lap_id, completed_at)
     SELECT user_id, client_lap_id, completed_at FROM racingcoach."CollectorLaps"
     WHERE user_id = $1 AND ($2::timestamptz IS NULL OR uploaded_at <= $2)
     ON CONFLICT DO NOTHING`,
    `DELETE FROM racingcoach."CollectorLaps" WHERE user_id = $1 AND ($2::timestamptz IS NULL OR uploaded_at <= $2)`,
  ],
  debriefs: [
    `DELETE FROM racingcoach."DebriefSessions" WHERE user_id = $1 AND ($2::timestamptz IS NULL OR created_at <= $2)`,
    `DELETE FROM racingcoach."LapSummaries" WHERE user_id = $1 AND ($2::timestamptz IS NULL OR created_at <= $2)`,
  ],
  raceResults: [`DELETE FROM racingcoach."RaceResults" WHERE user_id = $1 AND ($2::timestamptz IS NULL OR synced_at <= $2)`],
  targetLap: [], // targetLapStatements, as its columns are added on first use
  profilePicture: [`DELETE FROM racingcoach."UserPictures" WHERE user_id = $1 AND ($2::timestamptz IS NULL OR updated_at <= $2)`],
  // Back to the defaults. Nothing records when these were last changed, so re-applying skips them (see reapply)
  coachSettings: [
    `UPDATE racingcoach."Users" SET in_car_coach_instructions = '', race_announcer_instructions = '',
       coach_pronunciations = '[]'::jsonb, coach_voice = '', coach_spanish_accent = '', announcer_lead_voice = '',
       announcer_color_voice = '', name_pronunciation = '', broadcast_settings = '{}'::jsonb
     WHERE id = $1 AND $2::timestamptz IS NULL`,
  ],
  friends: [
    `DELETE FROM racingcoach."Friends" WHERE user_id = $1 AND ($2::timestamptz IS NULL OR created_at <= $2)`,
    `DELETE FROM racingcoach."LiveRacingWatchers" WHERE (user_id = $1 OR watcher_id = $1) AND ($2::timestamptz IS NULL OR created_at <= $2)`,
  ],
  connections: [
    `DELETE FROM racingcoach."DiscordConnections" WHERE user_id = $1 AND ($2::timestamptz IS NULL OR connected_at <= $2)`,
    `DELETE FROM racingcoach."IRacePlanConnections" WHERE user_id = $1 AND ($2::timestamptz IS NULL OR connected_at <= $2)`,
  ],
  // Paired TVs and the collector's upload key; web sign-ins stay (Change Password signs out everywhere else)
  devices: [
    `DELETE FROM racingcoach."TvSessions" WHERE user_id = $1 AND ($2::timestamptz IS NULL OR created_at <= $2)`,
    `DELETE FROM racingcoach."TvPairings" WHERE user_id = $1 AND ($2::timestamptz IS NULL OR created_at <= $2)`,
    `DELETE FROM racingcoach."CollectorKeys" WHERE user_id = $1 AND ($2::timestamptz IS NULL OR created_at <= $2)`,
  ],
  collectorLogs: [
    `DELETE FROM racingcoach."CollectorLogReviews" WHERE user_id = $1 AND ($2::timestamptz IS NULL OR reviewed_at <= $2)`,
    `DELETE FROM racingcoach."CollectorLogs" WHERE user_id = $1 AND ($2::timestamptz IS NULL OR received_at <= $2)`,
  ],
  // The account's rows and the same browsers' signed-out rows (visitor_id ties them together); never another
  // account's rows from a shared browser
  activityLog: [
    `DELETE FROM racingcoach."ActivityLog" WHERE ($2::timestamptz IS NULL OR logged_at <= $2) AND (user_id = $1 OR (user_id IS NULL AND visitor_id IN (
       SELECT DISTINCT visitor_id FROM racingcoach."ActivityLog" WHERE user_id = $1)))`,
  ],
  aiUsage: [`DELETE FROM racingcoach."AiUsage" WHERE user_id = $1 AND ($2::timestamptz IS NULL OR occurred_at <= $2)`],
};

// The Target Lap's columns are added by src/lib/targetLap.ts on first use, so they may not be there. A Target Lap in the
// telemetry bucket loses its key too, and the trigger on "Users" queues its object for deletion
async function targetLapStatements(client: Queryable): Promise<string[]> {
  const { rows } = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'racingcoach' AND table_name = 'Users'
       AND column_name IN ('TargetLap', 'TargetLapStorageKey')`
  );
  const columns = new Set(rows.map((row) => row.column_name));
  if (!columns.has('TargetLap')) return [];
  const storage = columns.has('TargetLapStorageKey')
    ? `, "TargetLapStorageProvider" = 'postgres', "TargetLapStorageBucket" = NULL, "TargetLapStorageKey" = NULL,
         "TargetLapStoredBytes" = NULL, "TargetLapChecksum" = NULL`
    : '';
  const has = columns.has('TargetLapStorageKey') ? '("TargetLap" IS NOT NULL OR "TargetLapStorageKey" IS NOT NULL)' : '"TargetLap" IS NOT NULL';
  return [
    `UPDATE racingcoach."Users" SET "TargetLap" = NULL, "TargetLapFileName" = NULL, "TargetLapSetAt" = NULL${storage}
     WHERE id = $1 AND ${has} AND ($2::timestamptz IS NULL OR "TargetLapSetAt" <= $2)`,
  ];
}

// Erases one category for an account; answers how many rows it removed or cleared
export async function eraseCategory(client: Queryable, userId: number, category: ErasableCategory, before: Date | null = null): Promise<number> {
  const statements = category === 'targetLap' ? await targetLapStatements(client) : STATEMENTS[category];
  let rows = 0;
  for (const sql of statements) {
    const result = await client.query(sql, [userId, before]);
    if (!sql.trimStart().startsWith('INSERT')) rows += result.rowCount ?? 0;
  }
  return rows;
}

type LedgerEntry = { id: string; userId: number; accountCreatedAt: Date; category: 'account' | ErasableCategory; erasedAt: Date; requestId: string | null };

async function recordLedger(client: Queryable, entry: Omit<LedgerEntry, 'id' | 'erasedAt'>): Promise<LedgerEntry> {
  const id = randomUUID();
  const { rows } = await client.query(
    `INSERT INTO racingcoach."ErasureLedger" (id, user_id, account_created_at, category, request_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING erased_at`,
    [id, entry.userId, entry.accountCreatedAt, entry.category, entry.requestId]
  );
  return { ...entry, id, erasedAt: new Date(rows[0].erased_at as string) };
}

const LEDGER_PREFIX = 'privacy-ledger/';

// Copies ledger rows not yet copied to object storage (after each erasure, and by the job sweep for any that failed)
export async function mirrorLedger(): Promise<number> {
  if (!videoStorageConfigured()) return 0;
  await ensureUserSchema();
  const rows = await query(
    `SELECT id, user_id, account_created_at, category, erased_at, request_id FROM racingcoach."ErasureLedger"
     WHERE mirrored_at IS NULL ORDER BY erased_at LIMIT 500`
  );
  let mirrored = 0;
  for (const row of rows) {
    const entry = {
      id: row.id,
      userId: Number(row.user_id),
      accountCreatedAt: new Date(row.account_created_at as string).toISOString(),
      category: row.category,
      erasedAt: new Date(row.erased_at as string).toISOString(),
      requestId: row.request_id,
    };
    try {
      await uploadObjectBytes(`${LEDGER_PREFIX}${row.id}.json`, Buffer.from(JSON.stringify(entry)), 'application/json');
      await query('UPDATE racingcoach."ErasureLedger" SET mirrored_at = now() WHERE id = $1', [row.id]);
      mirrored += 1;
    } catch (error) {
      console.error('Erasure ledger mirror failed:', error instanceof Error ? error.message : error);
      break;
    }
  }
  return mirrored;
}

async function accountCreatedAt(client: Queryable, userId: number): Promise<Date | null> {
  const { rows } = await client.query('SELECT created_at FROM racingcoach."Users" WHERE id = $1 FOR UPDATE', [userId]);
  return rows[0] ? new Date(rows[0].created_at as string) : null;
}

// Request Data Deletion's job: erases each category for the account and records it in the ledger, in one
// transaction. Answers the rows per category; an account that no longer exists answers null.
export async function eraseCategories(
  userId: number,
  categories: ErasableCategory[],
  requestId: string
): Promise<Record<string, number> | null> {
  await ensureUserSchema();
  const counts = await transaction(async (client) => {
    const createdAt = await accountCreatedAt(client, userId);
    if (!createdAt) return null;
    const result: Record<string, number> = {};
    for (const category of categories) {
      result[category] = await eraseCategory(client, userId, category);
      await recordLedger(client, { userId, accountCreatedAt: createdAt, category, requestId });
    }
    return result;
  });
  if (counts && categories.includes('devices')) clearLiveUpdate(userId);
  await mirrorLedger().catch(() => 0);
  return counts;
}

// What Delete My Account keeps, and why (the requester sees this in their request's outcome)
export const ACCOUNT_DELETION_RETAINED = [
  { category: 'billing', reason: 'Subscription and payment records, kept for accounting and tax, no longer linked to your account.' },
  { category: 'policyRecords', reason: 'Records of your cookie choices, kept as evidence of consent for 3 years, no longer linked to your account.' },
  { category: 'activityLog', reason: 'Website activity log rows (only if you accepted analytics cookies), anonymized: no longer linked to you or your browser, without your IP address or browser details.' },
  { category: 'privacyRequests', reason: 'The record of your privacy requests, without your name and email address, kept 3 years.' },
  { category: 'backups', reason: 'Copies in database backups until the hosting provider’s backup period ends; your account is deleted again from any restored copy.' },
];

// Delete My Account (DELETE /api/account), after any Stripe subscription is canceled: records the request (verified by
// the step-up sign-in), deletes the account and everything tied to it (deleteUserWith), records it in the ledger and
// closes the request as Completed, all in one transaction. Then deletes the account's export files from object storage,
// or queues that for retry. Answers the request.
export async function deleteAccount(user: User): Promise<PrivacyRequest> {
  await ensureUserSchema();
  const { request, objectKeys } = await transaction(async (client) => {
    const createdAt = await accountCreatedAt(client, user.id);
    if (!createdAt) throw new Error('Account not found');
    const request = await createRequest(client, {
      userId: user.id,
      requesterName: null,
      requesterEmail: null,
      type: 'account_deletion',
      details: '',
      verifiedBy: 'reauth',
    });
    const { rows } = await client.query(
      `SELECT object_key FROM racingcoach."PrivacyExports" WHERE user_id = $1 AND object_key IS NOT NULL AND deleted_at IS NULL`,
      [user.id]
    );
    await recordLedger(client, { userId: user.id, accountCreatedAt: createdAt, category: 'account', requestId: request.id });
    await deleteUserWith(client, user.id);
    const done = await transitionWith(client, request.id, {
      to: 'completed',
      actor: 'system',
      resolution: 'Your account and the personal data tied to it were deleted.',
      legalJustification: 'Article 17(1)(b); retained data under Article 17(3)(b) and (e), see retained.',
      retained: ACCOUNT_DELETION_RETAINED,
    });
    return { request: done, objectKeys: rows.map((row) => row.object_key as string) };
  });
  clearLiveUpdate(user.id);
  await purgeObjectsOrQueue(request.id, objectKeys);
  await mirrorLedger().catch(() => 0);
  return request;
}

// Deletes stored files now, or queues a purgeObjects job for the ones that failed (privacyJobs.ts retries it)
export async function purgeObjectsOrQueue(requestId: string | null, keys: string[]): Promise<void> {
  const failed: string[] = [];
  for (const key of keys) {
    try {
      await deleteVideoObject(key);
    } catch {
      failed.push(key);
    }
  }
  if (failed.length) {
    await query(`INSERT INTO racingcoach."PrivacyJobs" (request_id, kind, payload) VALUES ($1, 'purgeObjects', $2)`, [
      requestId,
      JSON.stringify({ keys: failed }),
    ]);
  }
}

// After a restore from a backup (and at every server start): brings back ledger rows only object storage still has,
// then makes every recorded erasure again, for accounts that are the same account (ID and creation time). An erasure
// already made finds nothing, so this changes nothing on a database that wasn't restored. Coaching settings aren't
// re-applied, as nothing says whether they were changed since. Answers how many rows were erased again.
export async function reapplyErasures(): Promise<{ restoredEntries: number; reapplied: number }> {
  await ensureUserSchema();
  let restoredEntries = 0;
  if (videoStorageConfigured()) {
    const keys = await listObjectKeys(LEDGER_PREFIX);
    const known = new Set((await query('SELECT id FROM racingcoach."ErasureLedger"')).map((row) => `${LEDGER_PREFIX}${row.id}.json`));
    for (const key of keys) {
      if (known.has(key)) continue;
      const entry = JSON.parse((await downloadObjectBytes(key)).toString('utf8'));
      await query(
        `INSERT INTO racingcoach."ErasureLedger" (id, user_id, account_created_at, category, erased_at, request_id, mirrored_at)
         VALUES ($1, $2, $3, $4, $5, $6, now()) ON CONFLICT (id) DO NOTHING`,
        [entry.id, entry.userId, entry.accountCreatedAt, entry.category, entry.erasedAt, entry.requestId]
      );
      restoredEntries += 1;
    }
  }
  const entries = await query(
    `SELECT l.user_id, l.category, l.erased_at FROM racingcoach."ErasureLedger" l
     JOIN racingcoach."Users" u ON u.id = l.user_id AND u.created_at = l.account_created_at
     ORDER BY l.erased_at`
  );
  let reapplied = 0;
  await withClient(async (client) => {
    for (const entry of entries) {
      const userId = Number(entry.user_id);
      const category = entry.category as LedgerEntry['category'];
      if (category === 'coachSettings') continue;
      await client.query('BEGIN');
      try {
        if (category === 'account') {
          await deleteUserWith(client, userId);
          reapplied += 1;
        } else {
          reapplied += await eraseCategory(client, userId, category, new Date(entry.erased_at as string));
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  });
  return { restoredEntries, reapplied };
}

// The erasure ledger is kept 3 years, far beyond any backup, then purged
export async function purgeOldLedger(): Promise<number> {
  await ensureUserSchema();
  const rows = await query(`DELETE FROM racingcoach."ErasureLedger" WHERE erased_at < now() - interval '3 years' RETURNING id`);
  for (const row of rows) {
    if (videoStorageConfigured()) await deleteVideoObject(`${LEDGER_PREFIX}${row.id}.json`).catch(() => undefined);
  }
  return rows.length;
}
