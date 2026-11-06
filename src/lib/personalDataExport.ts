// Download My Data (GDPR Articles 15 and 20): builds a ZIP of one account's personal data (run by privacyJobs.ts),
// keeps it for EXPORT_TTL_HOURS and lets only its owner download it. Every query is scoped to that one account
// (user_id = $1), and laps and Debrief Coach runs past their retention period are left out like everywhere else.
//
// An access export has every category of personalDataInventory.ts marked access; a portability export only those
// marked portable (what the user provided or their use of the service produced, processed on contract or consent; not
// what was inferred from it, billing or legal records). Never in either: password hashes, token hashes, the iRacePlan
// API key and other credentials, or other users' details beyond the name of an account the user chose to share with.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { readOwnLapCsvBytes } from './collectorLaps';
import { toCsv } from './csvExport';
import { query } from './db';
import { deleteVideoObject, readObjectStream, uploadVideoObject, videoStorageConfigured } from './objectStorage';
import { ARTICLE_15_NOTES, LEGAL_BASIS_TEXT, PERSONAL_DATA_INVENTORY, type InventoryCategory } from './personalDataInventory';
import { EXPORT_TTL_HOURS, type ExportKind } from './privacyRules';
import { ensureUserSchema } from './users';
import { ZipWriter } from './zipWriter';

// Without object storage an export is kept in Postgres, up to this size
const MAX_DATABASE_EXPORT_BYTES = 200 * 1024 * 1024;

const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

const inventory = (key: string) => PERSONAL_DATA_INVENTORY.find((c) => c.key === key)!;

const included = (category: InventoryCategory, kind: ExportKind) => (kind === 'access' ? category.access : category.portable);

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'racingcoach' AND table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length > 0;
}

function readme(kind: ExportKind, generatedAt: Date, categories: InventoryCategory[]): string {
  const lines = [
    'RacingCoach.app personal data export',
    '====================================',
    '',
    `Generated: ${generatedAt.toISOString()}`,
    kind === 'access'
      ? 'Type: access (GDPR Article 15): every category of personal data we hold about your account.'
      : 'Type: portability (GDPR Article 20): the data you provided, or that your use of the service produced, in machine-readable formats (CSV and JSON). It leaves out data we inferred, billing and legal records; ask for an access export for those.',
    '',
    `Controller: ${ARTICLE_15_NOTES.controller}`,
    '',
    'Files are UTF-8. Times are UTC (ISO 8601). Lap files use iRacing’s variable names and units (speed in m/s, pedals 0-1).',
    'manifest.json lists every file and what it holds.',
    '',
    'What we process and why',
    '-----------------------',
  ];
  for (const category of categories) {
    lines.push(
      '',
      category.title,
      `  What: ${category.description}`,
      `  Purpose: ${category.purpose}`,
      `  Legal basis: ${category.legalBasis.map((basis) => LEGAL_BASIS_TEXT[basis]).join('; ')}`,
      `  Source: ${category.source}`,
      `  Stored: ${category.storage}`,
      `  Kept: ${category.retention}`,
      `  Recipients: ${category.recipients.join('; ')}`
    );
    if (category.retainedReason) lines.push(`  Note: ${category.retainedReason}`);
  }
  lines.push(
    '',
    'International transfers',
    '-----------------------',
    ARTICLE_15_NOTES.transfers,
    '',
    'Automated decisions',
    '-------------------',
    ARTICLE_15_NOTES.automatedDecisions,
    '',
    'Your rights',
    '-----------',
    ARTICLE_15_NOTES.rights,
    'Use My Settings > Privacy & Data Rights, or write to support@racingcoach.app.',
    ''
  );
  return lines.join('\r\n');
}

type ManifestFile = { path: string; category: string; rows?: number };

// Writes the account's export to a ZIP file; answers its manifest. Throws when the account doesn't exist.
export async function writeExportZip(userId: number, kind: ExportKind, path: string, generatedAt = new Date()): Promise<ManifestFile[]> {
  await ensureUserSchema();
  const zip = new ZipWriter(path, generatedAt);
  const files: ManifestFile[] = [];
  const want = (key: string) => included(inventory(key), kind);
  const add = async (file: string, category: string, content: string | Buffer, rows?: number) => {
    await zip.add(file, content);
    files.push({ path: file, category, rows });
  };
  const addCsv = async (file: string, category: string, rows: Record<string, unknown>[], columns?: string[]) =>
    add(file, category, toCsv(rows, columns), rows.length);

  try {
    const [account] = await query(
      `SELECT id, user_name, email_address, role, membership_level, account_status, signup_date, subscription_end_date,
              created_at, preferred_language, country, theme, units, brake_beeps, brake_beeps_volume, promo_code, has_password
       FROM racingcoach."Users" WHERE id = $1`,
      [userId]
    );
    if (!account) throw new Error('Account not found');

    if (want('account')) await add('account/profile.json', 'account', json(account));

    if (want('profilePicture')) {
      const [picture] = await query('SELECT image FROM racingcoach."UserPictures" WHERE user_id = $1', [userId]);
      if (picture) await add('account/profile_picture.jpg', 'profilePicture', picture.image as Buffer);
    }

    if (want('authentication')) {
      const [sessions, google, key, tvs] = await Promise.all([
        query('SELECT to_timestamp(expires_at / 1000.0) AS expires_at FROM racingcoach."Sessions" WHERE user_id = $1 ORDER BY expires_at', [userId]),
        query('SELECT google_sub, google_email, connected_at FROM racingcoach."GoogleConnections" WHERE user_id = $1', [userId]),
        query('SELECT key_prefix, created_at, last_used_at FROM racingcoach."CollectorKeys" WHERE user_id = $1', [userId]),
        query(
          'SELECT label, created_at, expires_at, last_seen_at, revoked_at FROM racingcoach."TvSessions" WHERE user_id = $1 ORDER BY created_at',
          [userId]
        ),
      ]);
      await add(
        'account/sign_in_and_devices.json',
        'authentication',
        json({ signInSessions: sessions, googleSignIn: google[0] ?? null, collectorUploadKey: key[0] ?? null, pairedTvs: tvs })
      );
    }

    if (want('laps')) {
      const laps = await query(
        `SELECT id, client_lap_id, simulator, track, track_key, car, driver AS iracing_driver, iracing_session_id,
                iracing_subsession_id, session_num, session_type, lap_number, lap_time_seconds, sample_count, missing_samples,
                incidents, pit_road, off_track, has_position, conditions, recorded_at, completed_at, uploaded_at, expires_at
         FROM racingcoach."CollectorLaps" WHERE user_id = $1 AND expires_at > now() ORDER BY completed_at`,
        [userId]
      );
      await addCsv('laps/laps.csv', 'laps', laps);
      // One lap file at a time, so a long history never sits in memory whole
      for (const lap of laps) {
        // Wherever the lap's CSV is kept, inline or in the telemetry store (collectorLaps.ts)
        const csv = await readOwnLapCsvBytes(userId, Number(lap.id));
        if (csv) await add(`laps/files/${lap.client_lap_id}.csv`, 'laps', csv);
      }
    }

    if (want('debriefs')) {
      const debriefs = await query(
        `SELECT id, track, car, lap_count, best_lap_seconds, session, debrief, created_at, expires_at
         FROM racingcoach."DebriefSessions" WHERE user_id = $1 AND expires_at > now() ORDER BY created_at`,
        [userId]
      );
      await add('coaching/debrief_sessions.json', 'debriefs', json(debriefs), debriefs.length);
      const summaries = await query(
        `SELECT id, kind, track, input, summary, created_at, expires_at
         FROM racingcoach."LapSummaries" WHERE user_id = $1 AND expires_at > now() ORDER BY created_at`,
        [userId]
      );
      await add('coaching/lap_summaries.json', 'debriefs', json(summaries), summaries.length);
    }

    if (want('targetLap') && (await hasColumn('Users', 'TargetLap'))) {
      const [target] = await query(
        'SELECT "TargetLap" AS csv, "TargetLapFileName" AS file_name, "TargetLapSetAt" AS set_at FROM racingcoach."Users" WHERE id = $1',
        [userId]
      );
      if (target?.csv) {
        await add('coaching/target_lap.json', 'targetLap', json({ fileName: target.file_name, setAt: target.set_at }));
        await add('coaching/target_lap.csv', 'targetLap', gunzipSync(target.csv as Buffer));
      }
    }

    if (want('coachSettings')) {
      const [settings] = await query(
        `SELECT in_car_coach_instructions, coach_pronunciations, coach_voice, coach_spanish_accent, announcer_lead_voice,
                announcer_color_voice, race_announcer_instructions, name_pronunciation, broadcast_settings
         FROM racingcoach."Users" WHERE id = $1`,
        [userId]
      );
      await add('coaching/settings.json', 'coachSettings', json(settings));
    }

    if (want('raceResults')) {
      const races = await query(
        `SELECT source, start_time, series, series_id, category, track, car, team_race, official_race, results_final,
                subsession_id, session_num, iracing_customer_id, old_irating, new_irating, old_safety_rating, new_safety_rating,
                start_position, finish_position, laps_complete, laps_led, incidents, best_lap_seconds, average_lap_seconds,
                reason_out, synced_at
         FROM racingcoach."RaceResults" WHERE user_id = $1 AND has_result ORDER BY start_time`,
        [userId]
      );
      await addCsv('racing/race_results.csv', 'raceResults', races);
    }

    if (want('connections')) {
      // The iRacePlan API key is a credential, so it's left out
      const [discord, iracePlan] = await Promise.all([
        query(
          'SELECT discord_user_id, discord_username, discord_global_name, discord_avatar, connected_at FROM racingcoach."DiscordConnections" WHERE user_id = $1',
          [userId]
        ),
        query(
          'SELECT iracing_customer_id, iracing_name, connected_at, synced_at FROM racingcoach."IRacePlanConnections" WHERE user_id = $1',
          [userId]
        ),
      ]);
      await add('account/connections.json', 'connections', json({ discord: discord[0] ?? null, iracePlan: iracePlan[0] ?? null }));
    }

    if (want('friends')) {
      const [friends, watchers, watching] = await Promise.all([
        query('SELECT name, country, created_at FROM racingcoach."Friends" WHERE user_id = $1 ORDER BY seq', [userId]),
        // Only the account name of whom the user chose to share with, never their email address
        query(
          `SELECT u.user_name AS watcher, w.created_at FROM racingcoach."LiveRacingWatchers" w
           JOIN racingcoach."Users" u ON u.id = w.watcher_id WHERE w.user_id = $1 ORDER BY w.created_at`,
          [userId]
        ),
        query(
          `SELECT u.user_name AS driver, w.created_at FROM racingcoach."LiveRacingWatchers" w
           JOIN racingcoach."Users" u ON u.id = w.user_id WHERE w.watcher_id = $1 ORDER BY w.created_at`,
          [userId]
        ),
      ]);
      await addCsv('social/friends.csv', 'friends', friends, ['name', 'country', 'created_at']);
      await addCsv('social/live_racing_watchers_i_allowed.csv', 'friends', watchers, ['watcher', 'created_at']);
      await addCsv('social/live_racing_drivers_i_can_watch.csv', 'friends', watching, ['driver', 'created_at']);
    }

    if (want('collectorLogs')) {
      const logs = await query(
        `SELECT run_id, seq, logged_at, is_error, message, collector_version FROM racingcoach."CollectorLogs"
         WHERE user_id = $1 ORDER BY logged_at, seq`,
        [userId]
      );
      await addCsv('logs/collector_logs.csv', 'collectorLogs', logs, ['run_id', 'seq', 'logged_at', 'is_error', 'message', 'collector_version']);
      // The reviews are inferred by the AI, so only in an access export
      if (kind === 'access') {
        const reviews = await query(
          `SELECT run_id, from_seq, to_seq, reviewed_at, problem, title, explanation, fix, emailed_at
           FROM racingcoach."CollectorLogReviews" WHERE user_id = $1 ORDER BY reviewed_at`,
          [userId]
        );
        await addCsv('logs/collector_log_reviews.csv', 'collectorLogs', reviews);
      }
    }

    if (want('activityLog')) {
      const activity = await query(
        `SELECT occurred_at, logged_at, visitor_id, session_id, event_type, path, page_title, referrer, element, element_id,
                label, target_href, viewport_width, viewport_height, language, ip_address, user_agent
         FROM racingcoach."ActivityLog" WHERE user_id = $1 ORDER BY occurred_at`,
        [userId]
      );
      await addCsv('logs/website_activity.csv', 'activityLog', activity);
    }

    if (want('aiUsage')) {
      const usage = await query(
        `SELECT occurred_at, feature, tier, weight, allowed, reason, counted, failed, model, model_calls, input_tokens,
                cached_input_tokens, output_tokens, ip_address
         FROM racingcoach."AiUsage" WHERE user_id = $1 ORDER BY occurred_at`,
        [userId]
      );
      await addCsv('logs/ai_usage.csv', 'aiUsage', usage);
      const overrides = await query(
        'SELECT mode, limit_count, period, expires_at, created_at FROM racingcoach."RateLimitOverrides" WHERE user_id = $1',
        [userId]
      );
      if (overrides.length) await addCsv('logs/ai_limit_overrides.csv', 'aiUsage', overrides);
    }

    if (want('billing')) {
      const [subscriptions, discounts, cancellations] = await Promise.all([
        query(
          `SELECT stripe_subscription_id, stripe_customer_id, plan, status, currency, original_amount, billing_interval,
                  current_amount, start_date, current_period_start, current_period_end, cancel_at_period_end, canceled_at,
                  ended_at, last_payment_at, last_payment_failed_at
           FROM racingcoach."StripeSubscriptions" WHERE user_id = $1 ORDER BY start_date`,
          [userId]
        ),
        query(
          `SELECT stripe_subscription_id, promotion_code, coupon_name, percent_off, amount_off, amount_off_currency, duration,
                  duration_in_months, at_signup, applied_at, expires_at, removed_at
           FROM racingcoach."StripeDiscounts" WHERE user_id = $1 ORDER BY applied_at`,
          [userId]
        ),
        query(
          `SELECT canceled_at, reason, notes, stripe_subscription_id, subscription_end_date
           FROM racingcoach."CancellationReason" WHERE user_id = $1 ORDER BY canceled_at`,
          [userId]
        ),
      ]);
      await addCsv('billing/subscriptions.csv', 'billing', subscriptions);
      await addCsv('billing/discounts.csv', 'billing', discounts);
      await addCsv('billing/cancellations.csv', 'billing', cancellations);
    }

    if (want('policyRecords')) {
      const [policies, consents] = await Promise.all([
        query('SELECT policy, version, accepted_at, source FROM racingcoach."PolicyAcceptances" WHERE user_id = $1 ORDER BY accepted_at', [userId]),
        query(
          `SELECT recorded_at, action, categories, method, cookie_policy_version, banner_version, purposes_version,
                  notice_language, region, country, browser_id
           FROM racingcoach."CookieConsents" WHERE user_id = $1 ORDER BY recorded_at`,
          [userId]
        ),
      ]);
      await addCsv('records/policy_acceptances.csv', 'policyRecords', policies);
      await addCsv('records/cookie_choices.csv', 'policyRecords', consents);
    }

    if (want('privacyRequests')) {
      const requests = await query(
        `SELECT r.id, r.request_type, r.status, r.submitted_at, r.due_at, r.extended_due_at, r.extension_reason, r.completed_at,
                r.resolution, r.retained,
                (SELECT coalesce(json_agg(json_build_object('at', e.at, 'event', e.event, 'from', e.from_status, 'to', e.to_status, 'note', e.note) ORDER BY e.at), '[]')
                 FROM racingcoach."PrivacyRequestEvents" e WHERE e.request_id = r.id AND e.visible_to_requester) AS history
         FROM racingcoach."PrivacyRequests" r WHERE r.user_id = $1 ORDER BY r.submitted_at`,
        [userId]
      );
      await add('records/privacy_requests.json', 'privacyRequests', json(requests), requests.length);
    }

    const categories = PERSONAL_DATA_INVENTORY.filter((category) => included(category, kind));
    await zip.add('README.txt', readme(kind, generatedAt, categories));
    await zip.add(
      'manifest.json',
      json({
        service: 'RacingCoach.app',
        kind,
        generatedAt: generatedAt.toISOString(),
        accountId: userId,
        files,
        categoriesNotInThisExport: PERSONAL_DATA_INVENTORY.filter((category) => !included(category, kind)).map((c) => ({
          category: c.key,
          title: c.title,
          why: kind === 'portability' && c.access ? 'Not within Article 20 (ask for an access export)' : c.retainedReason ?? 'Not stored in a form that can be exported',
        })),
      })
    );
    await zip.finish();
    return files;
  } catch (error) {
    zip.abort();
    throw error;
  }
}

export type StoredExport = { id: string; sizeBytes: number; expiresAt: Date };

// Builds the export and keeps it: in object storage when configured, else in Postgres (up to 200 MB). The file on disk
// is always removed. Answers the stored export.
export async function createExport(userId: number, kind: ExportKind, requestId: string): Promise<StoredExport> {
  await ensureUserSchema();
  const id = randomUUID();
  const path = join(tmpdir(), `racingcoach-export-${id}.zip`);
  try {
    await writeExportZip(userId, kind, path);
    const hash = createHash('sha256');
    let sizeBytes = 0;
    for await (const chunk of createReadStream(path)) {
      hash.update(chunk as Buffer);
      sizeBytes += (chunk as Buffer).length;
    }
    const sha256 = hash.digest('hex');
    const expiresAt = new Date(Date.now() + EXPORT_TTL_HOURS * 60 * 60 * 1000);
    if (videoStorageConfigured()) {
      // The key holds no personal data
      const objectKey = `privacy-exports/${id}.zip`;
      await uploadVideoObject(objectKey, path, 'application/zip');
      await query(
        `INSERT INTO racingcoach."PrivacyExports" (id, request_id, user_id, kind, expires_at, storage, object_key, size_bytes, sha256)
         VALUES ($1, $2, $3, $4, $5, 'object', $6, $7, $8)`,
        [id, requestId, userId, kind, expiresAt, objectKey, sizeBytes, sha256]
      );
    } else {
      if (sizeBytes > MAX_DATABASE_EXPORT_BYTES) {
        throw new Error('Export is too large to keep without object storage');
      }
      await query(
        `INSERT INTO racingcoach."PrivacyExports" (id, request_id, user_id, kind, expires_at, storage, content, size_bytes, sha256)
         VALUES ($1, $2, $3, $4, $5, 'database', $6, $7, $8)`,
        [id, requestId, userId, kind, expiresAt, await readFile(path), sizeBytes, sha256]
      );
    }
    return { id, sizeBytes, expiresAt };
  } finally {
    await rm(path, { force: true });
  }
}

export type ExportSummary = { id: string; requestId: string; kind: ExportKind; createdAt: string; expiresAt: string; sizeBytes: number; downloads: number };

// The account's exports that can still be downloaded, newest first
export async function listExportsForUser(userId: number): Promise<ExportSummary[]> {
  await ensureUserSchema();
  const rows = await query(
    `SELECT id, request_id, kind, created_at, expires_at, size_bytes, downloads FROM racingcoach."PrivacyExports"
     WHERE user_id = $1 AND deleted_at IS NULL AND expires_at > now() ORDER BY created_at DESC`,
    [userId]
  );
  return rows.map((row) => ({
    id: row.id as string,
    requestId: row.request_id as string,
    kind: row.kind as ExportKind,
    createdAt: new Date(row.created_at as string).toISOString(),
    expiresAt: new Date(row.expires_at as string).toISOString(),
    sizeBytes: Number(row.size_bytes),
    downloads: Number(row.downloads),
  }));
}

// The export's file for its owner, while it hasn't expired; null for anyone else, so another account's export can't
// be told apart from one that doesn't exist. Counts the download.
export async function openExportForUser(
  userId: number,
  exportId: string
): Promise<{ body: ReadableStream | Buffer; sizeBytes: number; fileName: string } | null> {
  await ensureUserSchema();
  if (!/^[0-9a-f-]{36}$/i.test(exportId)) return null;
  const [row] = await query(
    `UPDATE racingcoach."PrivacyExports" SET downloads = downloads + 1, last_downloaded_at = now()
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND expires_at > now()
     RETURNING kind, storage, object_key, content, size_bytes, created_at`,
    [exportId, userId]
  );
  if (!row) return null;
  const fileName = `racingcoach-${row.kind}-export-${new Date(row.created_at as string).toISOString().slice(0, 10)}.zip`;
  if (row.storage === 'object') {
    const { body } = await readObjectStream(row.object_key as string);
    return { body, sizeBytes: Number(row.size_bytes), fileName };
  }
  return { body: row.content as Buffer, sizeBytes: Number(row.size_bytes), fileName };
}

// Deletes the files of expired exports (the job sweep runs it hourly); the rows stay, marked deleted, as the record
// that the export was made. Answers how many.
export async function expireExports(): Promise<number> {
  await ensureUserSchema();
  const rows = await query(
    `SELECT id, storage, object_key FROM racingcoach."PrivacyExports" WHERE deleted_at IS NULL AND expires_at <= now() LIMIT 200`
  );
  let expired = 0;
  for (const row of rows) {
    try {
      if (row.storage === 'object' && row.object_key) await deleteVideoObject(row.object_key as string);
      await query('UPDATE racingcoach."PrivacyExports" SET content = NULL, deleted_at = now() WHERE id = $1', [row.id]);
      expired += 1;
    } catch (error) {
      console.error('Export expiry failed:', error instanceof Error ? error.message : error);
    }
  }
  return expired;
}

// How much of each Request Data Deletion category the account has, for Privacy & Data Rights (one query)
export async function countPersonalData(userId: number): Promise<Record<string, number>> {
  await ensureUserSchema();
  const targetLap = (await hasColumn('Users', 'TargetLap'))
    ? `(SELECT count(*) FROM racingcoach."Users" WHERE id = $1 AND "TargetLap" IS NOT NULL)`
    : '0';
  const [row] = await query(
    `SELECT
       (SELECT count(*) FROM racingcoach."CollectorLaps" WHERE user_id = $1 AND expires_at > now())::int AS laps,
       ((SELECT count(*) FROM racingcoach."DebriefSessions" WHERE user_id = $1 AND expires_at > now())
        + (SELECT count(*) FROM racingcoach."LapSummaries" WHERE user_id = $1 AND expires_at > now()))::int AS debriefs,
       (SELECT count(*) FROM racingcoach."RaceResults" WHERE user_id = $1 AND has_result)::int AS "raceResults",
       ${targetLap}::int AS "targetLap",
       (SELECT count(*) FROM racingcoach."UserPictures" WHERE user_id = $1)::int AS "profilePicture",
       (SELECT (in_car_coach_instructions <> '' OR race_announcer_instructions <> '' OR coach_pronunciations <> '[]'::jsonb OR name_pronunciation <> ''
                OR broadcast_settings <> '{}'::jsonb OR coach_voice <> '' OR announcer_lead_voice <> '' OR announcer_color_voice <> '')::int
        FROM racingcoach."Users" WHERE id = $1) AS "coachSettings",
       ((SELECT count(*) FROM racingcoach."Friends" WHERE user_id = $1)
        + (SELECT count(*) FROM racingcoach."LiveRacingWatchers" WHERE user_id = $1 OR watcher_id = $1))::int AS friends,
       ((SELECT count(*) FROM racingcoach."DiscordConnections" WHERE user_id = $1)
        + (SELECT count(*) FROM racingcoach."IRacePlanConnections" WHERE user_id = $1))::int AS connections,
       ((SELECT count(*) FROM racingcoach."TvSessions" WHERE user_id = $1)
        + (SELECT count(*) FROM racingcoach."CollectorKeys" WHERE user_id = $1))::int AS devices,
       (SELECT count(*) FROM racingcoach."CollectorLogs" WHERE user_id = $1)::int AS "collectorLogs",
       (SELECT count(*) FROM racingcoach."ActivityLog" WHERE user_id = $1)::int AS "activityLog",
       (SELECT count(*) FROM racingcoach."AiUsage" WHERE user_id = $1)::int AS "aiUsage"`,
    [userId]
  );
  return Object.fromEntries(Object.entries(row ?? {}).map(([key, value]) => [key, Number(value ?? 0)]));
}
