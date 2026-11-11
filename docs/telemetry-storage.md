# Lap Telemetry Storage: Cloudflare R2

How uploaded lap telemetry moves out of Postgres into a private Cloudflare R2 bucket: design, setup, rollout,
rollback and verification. The summary is in AGENTS.md (Lap Telemetry Storage).

## Why

Measured on 2026-11-05: the database was 519 MB of Render's 1 GB, and `"CollectorLaps"` was 483 MB of it, all but
320 kB of that being the gzip-compressed CSVs in `csv_gzip` (TOAST). 595 laps from 5 drivers, all from the 25 days
before; about 2.26 MB per lap uncompressed and 0.81 MB compressed, about 19 MB a day. With Gold laps kept 90 days the
database would have filled within weeks at that rate. Everything else (logs, debriefs, the activity log) was small.

## What moves and what stays

| Data | Where |
|---|---|
| Each lap's gzip-compressed CSV (`"CollectorLaps".csv_gzip`) | **R2**, one object per lap |
| The lap's row: details, `completed_at`/`expires_at`, `has_position`, conditions, and where its CSV is | Postgres |
| Each Expert Lap's gzip-compressed CSV (`"ExpertLaps".csv_gzip`) | **R2**, `expert-laps/{sha256}.csv.gz` (see Expert Laps below) |
| Each user's Target Lap (`"Users"."TargetLap"`) | **R2**, `target-laps/u{userId}/{sha256}.csv.gz` (see Target Laps below) |
| `"CollectorLogs"`, `"DebriefSessions"`, `"LapSummaries"`, `"UserPictures"` | Postgres (small, or queried by column) |

## Design

- **Store** (`src/lib/telemetryStorage.ts`): an interface (`TelemetryObjectStore`: put, get, head, delete, list) with
  the S3 implementation (AWS SDK v3, `src/lib/s3Client.ts`, shared with the Broadcast Video Library's store) and an
  in-memory one for tests. Every request has a timeout, the SDK retries throttling, 5xx and network errors with
  exponential backoff, at most `TELEMETRY_STORAGE_CONCURRENCY` requests run at once per server, reads are size-capped
  (10 MB) and checked against the row's SHA-256. Uploads send `Content-MD5`, so R2 refuses a body damaged in
  transit, and are followed by a HEAD to check the stored size. No `Content-Encoding` is set on objects: with `gzip`
  there, Cloudflare may decompress on the way out.
- **Private**: the bucket has no public access or custom domain. Only the web server has the token. Browsers and the
  collector never get credentials or signed URLs to lap objects: every read goes through the existing authorization
  (`LapViewer` in `collectorLaps.ts`, the collector's upload key) and the server returns the CSV as before.
- **Keys** (`src/lib/telemetryStorageRules.ts`): `telemetry/{simulator}/u{userId}/{clientLapId}/{sha256}.csv.gz`, from
  server-side IDs only, validated so nothing can climb out of the user's prefix. The checksum in the name makes
  objects immutable: a re-upload with track positions is a new object and the row moves to it in one UPDATE. That's
  also why a cache of objects by key (`TELEMETRY_CACHE_MB`) can't be stale. Sessions aren't in the key: offline
  sessions have no stable ID, and the collector's lap ID is already unique per user. Other simulators' CSV columns
  differ (`ChannelGate.cs`); the store doesn't care, and the simulator is in the key and the object's metadata.
- **Object metadata**: `sha256`, `csv-bytes` (original size), `user-id`, `client-lap-id`, `simulator`, `compression`;
  content type `text/csv`.
- **Database** (`src/lib/telemetryStorageSchema.ts`, run by `ensureUserSchema`, additions only):
  - `"CollectorLaps"`: `storage_provider` (`postgres` or `r2`; reads follow it), `storage_status` (`inline`, `stored`,
    `missing`), `storage_bucket`, `storage_key`, `stored_bytes`, `checksum_sha256`, `content_type`, `compression`,
    `stored_at`, `verified_at`, and the backfill's `migration_attempts`, `migration_error`,
    `migration_next_attempt_at`. `csv_bytes` stays the original size. `csv_gzip` becomes nullable, and the check
    `collector_laps_storage_check` keeps every row readable: a `postgres` row always has `csv_gzip`, any other a key.
    The collector sends no file name (its CSV names are built from these same details), so none is kept.
  - `"TelemetryObjectCleanup"`: the queue of objects to delete (`pending`, `deleted`, `replaced`, `orphan`), with
    retries. No foreign key to `"Users"`, so an account's objects are still deleted after the account is gone.
  - Triggers `collector_laps_object_deleted` (AFTER DELETE) and `collector_laps_object_replaced` (AFTER UPDATE of the
    key) queue the old object in the same statement as the row change, whatever made it.
  - `"TelemetryStorageCounters"` (daily counts for the Admin page) and `"TelemetryStorageRuns"` (one row per backfill,
    verification, cleanup, reconciliation or purge run).

### R2 and Postgres have no shared transaction

- **Upload**: a `pending` cleanup entry first, then the object, then the lap row and the removal of the `pending`
  entry in one transaction. If anything fails or the server dies half way, the entry remains, and the cleanup worker
  deletes the object after an hour unless a row references it. A row is only ever written after its object is
  confirmed, so no row points at a missing object.
- **Retries**: a duplicate upload (same collector lap ID) is recognised before anything is written to R2. The key is
  content-addressed, so a retried backfill or upload can't make a second copy.
- **R2 outage**: uploads fall back to storing the lap in Postgres, and the backfill moves it later. Reads of R2 laps
  fail with an error until R2 is back.
- **Deletion**: rows are deleted first (retention, erasure, Delete Account), and the triggers queue their objects in
  the same statement. The cleanup worker deletes them with backoff until they're gone. Between the two, the object
  exists but nothing can read it: every read goes through a row.
- **Missing objects** (a database restored from a backup can bring back rows whose objects were already deleted):
  the lap is treated as not found and marked `missing`. Those rows expire as they would have; the erasure ledger's
  re-application deletes erased ones.
- **Cleanup race**: the worker checks no row references a key and then deletes it. A row could only start using that
  key in between by uploading the same lap's same bytes again after it was deleted, which the expired-lap tombstones
  refuse.
- **Orphans**: the weekly reconciliation lists the bucket and queues objects no row references. It's the only
  bucket listing; the Admin page's figures all come from Postgres.

### Retention and privacy

The retention rules, their SQL and the hourly job (`lapRetentionDb.ts`) are unchanged: one system. Expired rows were
already hidden from every read, and the job's deletes now queue their objects through the trigger. The same goes for
Request Data Deletion's `laps` category, Delete Account's cascade, and erasures re-applied after a restore. Download My
Data reads lap CSVs through `collectorLaps.ts`, from wherever each one is.

## Expert Laps

The Coach page's Expert Laps (`src/lib/expertLaps.ts`) use the same bucket, token and cleanup queue, for consistency
rather than size: there's at most one per car and track.

- **Keys**: `expert-laps/{sha256 of the compressed bytes}.csv.gz` (`expertLapObjectKey`), as an Expert Lap belongs to no
  user. Outside `telemetry/`, so the weekly reconciliation never lists one or takes it for an orphan. Two Expert Laps with
  the same bytes share an object
- **Columns** (added by `ensureExpertLapSchema`): `storage_provider`, `storage_bucket`, `storage_key`, `stored_bytes`,
  `checksum_sha256`, `stored_at`; `csv_gzip` nullable, with `expert_laps_storage_check` like `"CollectorLaps"`'
- **Writes**: with `TELEMETRY_STORAGE_MODE=r2` and the store configured, a new Expert Lap is a 'pending' cleanup entry, the
  object (size checked), then the row and the entry's removal in one transaction; otherwise, or when the bucket fails, inline.
  A car and track that already has one is answered before anything is written
- **Reads** follow each row; a missing object reads as no lap (logged), a checksum mismatch or a bucket error fails
- **Deletes and replacements**: the triggers `expert_laps_object_deleted` and `expert_laps_object_replaced` queue the old
  object; the cleanup worker deletes it once no Expert Lap references its key (`referenced` in `telemetryCleanup.ts`
  looks in `"ExpertLaps"` for `expert-laps/` keys)
- **Moving the existing ones**: Admin > Telemetry Storage > Expert Laps > **Move Expert Laps to object storage**
  (`moveExpertLapsToObjectStorage`): copies each inline one, checks the object's size and checksum, then points the row at
  it and clears `csv_gzip` in one statement. No separate verify or purge step: there are only a few. **Move Expert Laps
  back to PostgreSQL** is the rollback: it downloads each object, stores it inline, and queues the object for deletion

## Target Laps

Each user's Target Lap (`src/lib/targetLap.ts`) works the same way as an Expert Lap, with its columns on `"Users"`:
`"TargetLapStorageProvider"`, `"TargetLapStorageBucket"`, `"TargetLapStorageKey"`, `"TargetLapStoredBytes"`,
`"TargetLapChecksum"` (added by `ensureTargetLapSchema`, with `users_target_lap_storage_check`).

- **Keys**: `target-laps/u{userId}/{sha256}.csv.gz` (`targetLapObjectKey`), outside `telemetry/`, so the reconciliation
  never lists them
- **Writes, reads, moves**: as Expert Laps (the shared helper is `src/lib/lapObjects.ts`); Admin > Telemetry Storage >
  Target Laps has **Move Target Laps to object storage** and **Move Target Laps back to PostgreSQL**
- **Deletion**: the triggers `users_target_lap_object_replaced` (a new Target Lap, Remove, a privacy erasure, which clears
  the key with the rest, `targetLapStatements` in `dataErasure.ts`) and `users_target_lap_object_deleted` (Delete
  Account) queue the old object with the user's ID; the cleanup worker deletes it once no user references the key
- **Download My Data** reads it from wherever it is (`readTargetLapForExport`)

## Cloudflare setup

1. R2 > Create bucket: `racingcoach-telemetry` (any name), location hint near Render's region (Oregon: Western North
   America). Leave **Public access off** and add no custom domain. No CORS rule is needed: browsers never talk to it.
2. Optionally an object lifecycle rule deleting objects under `telemetry/` older than **100 days**, as a backstop:
   nothing is kept more than 90 days after completion, and laps are uploaded within days. The site deletes them itself;
   this only catches something missed.
3. R2 > Manage API tokens > Create API token: permission **Object Read & Write**, **applied to that bucket only**, no
   expiry or one you'll rotate. Copy the Access Key ID and Secret Access Key. Don't reuse the Broadcast Video token.
4. The S3 endpoint is `https://<account id>.r2.cloudflarestorage.com` (the bucket's Settings page shows it).

## Environment variables (Render web service)

| Variable | Value |
|---|---|
| `TELEMETRY_S3_ENDPOINT` | `https://<account id>.r2.cloudflarestorage.com` |
| `TELEMETRY_S3_BUCKET` | `racingcoach-telemetry` |
| `TELEMETRY_S3_ACCESS_KEY_ID`, `TELEMETRY_S3_SECRET_ACCESS_KEY` | The bucket-scoped token |
| `TELEMETRY_S3_REGION` | Optional, default `auto` |
| `TELEMETRY_STORAGE_MODE` | `postgres` (default) or `r2`: where **new** laps are written |
| `TELEMETRY_STORAGE_TIMEOUT_MS` | Optional, each request's timeout, default 15000 |
| `TELEMETRY_STORAGE_MAX_ATTEMPTS` | Optional, the SDK's attempts per request, default 4 |
| `TELEMETRY_STORAGE_CONCURRENCY` | Optional, requests at once per server, default 8 |
| `TELEMETRY_CACHE_MB` | Optional, lap objects kept in memory per server, default 100 (0: none) |

## Rollout

Each phase is a deploy or an Admin page action, and each can be stopped and resumed.

| Phase | Do | Effect |
|---|---|---|
| A | Deploy this code. Leave `TELEMETRY_STORAGE_MODE` unset | Schema added on first database use; behavior unchanged |
| B | Set the `TELEMETRY_S3_*` variables and `TELEMETRY_STORAGE_MODE=r2` | New laps go to R2 (Postgres growth stops); old laps still read from Postgres |
| C | Admin > Telemetry Storage > **Copy laps** | Old laps copied to R2, checked by size and SHA-256; reads still from Postgres |
| D | **Verify copies**, then **Switch reads** | Each copy downloaded again and its checksum matched; then verified laps are read from R2 |
| E | Take a backup (below), then **Remove legacy copies** (type PURGE and tick the backup box) | `csv_gzip` cleared for verified laps read from R2; then reclaim the space |

Phase B is the urgent one: it stops the database growing. C and D can follow at any pace.

### Backup checkpoint before Phase E

Until Phase E nothing is lost: every migrated lap still has its `csv_gzip`. Before purging, take a backup you can
restore: Render Dashboard > the database > Recovery (on paid plans: point-in-time recovery; note the time) or
Export, or `pg_dump --format=custom --table='racingcoach."CollectorLaps"' "$DATABASE_URL" > collector-laps.dump` from a
computer with enough disk (about 0.5 GB today). Keep it until the switch has run cleanly for a while.

### Reclaiming Postgres space (after Phase E)

Clearing `csv_gzip` deletes the TOAST rows, but Postgres keeps the files' space:

- Autovacuum (or `VACUUM (ANALYZE) racingcoach."CollectorLaps";`) marks the space reusable, so the database stops
  growing, but `pg_database_size` and Render's disk figure don't drop.
- To give the space back: `VACUUM FULL racingcoach."CollectorLaps";` from `psql` (Render Dashboard > Connect > the
  external URL). It rewrites the table and holds an exclusive lock while it does, blocking lap uploads and reads for
  that time, and needs free disk for the new copy. After the purge only about 1 kB per lap remains, so it takes
  seconds and needs very little space. Run it at a quiet time; the collector retries uploads that fail meanwhile.
- Render: a database's storage can be increased but **never decreased**, so this frees room inside the current
  allocation; it doesn't lower the plan's disk. Check whether storage autoscaling is on (Dashboard > the database),
  as it would grow the disk if a phase runs late. WAL is included in Render's figure: a large purge generates WAL,
  which is why it runs in batches.

## Rollback

| From | Do |
|---|---|
| B (writes to R2) | Unset `TELEMETRY_STORAGE_MODE` (or set `postgres`): new laps go back to Postgres. Laps already in R2 keep being read from it, so leave the `TELEMETRY_S3_*` variables set |
| C (copies made) | Nothing to undo: reads were never moved. Copies are harmless; re-uploads and deletions clean up their objects |
| D (reads switched) | Admin > Telemetry Storage > **Roll back reads**: every lap that still has `csv_gzip` is read from Postgres again; its object is kept |
| E (purged) | Only from the backup taken before it. Laps uploaded in R2 mode never had `csv_gzip`; they stay in R2 |

Expert Laps and Target Laps: **Move Expert Laps back to PostgreSQL** and **Move Target Laps back to PostgreSQL** (and unset
`TELEMETRY_STORAGE_MODE` so new ones stay there).

Never delete the bucket or unset `TELEMETRY_S3_*` while any row (laps, Expert Laps or Target Laps) has `storage_provider = 'r2'`.

## Verification checklist

- After A: `SELECT storage_provider, count(*) FROM racingcoach."CollectorLaps" GROUP BY 1` shows only `postgres`; laps
  upload and open in Debrief Coach as before.
- After B: drive a lap. Its row has `storage_provider = 'r2'`, a `storage_key`, `csv_gzip` NULL; the object is in the
  bucket; it opens in Debrief Coach and Lap Compare; the In-Car AI Coach's lap feedback and the Race Engineer work in
  a session; the lap's CSV downloads. The Admin page shows puts and no put failures.
- After C: the Admin page shows no inline laps left without a copy, and the failures (if any) with their errors.
- After D: verified equals copied; mismatches 0; after the switch, Debrief Coach, Lap Compare (Target vs Compare
  laps, 3D view), Multi-Lap and Stint Analysis, Rotation, Download My Data and the collector's in-session debrief all
  work on old laps.
- Retention: with `LAP_RETENTION_MODE=delete`, expired laps' objects appear in the cleanup queue and are gone after
  the next cleanup run. The same for Request Data Deletion (laps) and Delete Account.
- After E: `pg_total_relation_size('racingcoach."CollectorLaps"')` drops after `VACUUM FULL`; the reconciliation
  finds no orphans or missing objects.

## Expected savings and costs

After Phase E and `VACUUM FULL`, `"CollectorLaps"` drops from about 483 MB to well under 1 MB (about 1 kB per lap
row), and grows by about 1 kB per lap instead of about 0.8 MB.

R2 estimate. Assumptions: 0.81 MB per compressed lap (measured); 120 laps per active driver per month (today's
drivers average about 140); membership mix 60% Bronze (30 days), 30% Silver (60), 10% Gold (90), so laps are kept 1.5
months on average and each driver holds about 180 laps, 146 MB. Prices: R2 Standard, $0.015 per GB-month after 10 GB
free; Class A (writes) $4.50 per million after 1 million free; Class B (reads) $0.36 per million after 10 million
free; no egress fees. About 2 writes per lap (live, then with track positions) and up to about 40 reads per lap (the
In-Car AI Coach re-reads a session's laps; the in-memory cache absorbs most). Check current prices at
cloudflare.com/r2/pricing.

| Active drivers | Stored | Writes / month | Reads / month (before cache) | R2 / month |
|---|---|---|---|---|
| 100 | ~15 GB | ~24k | ~0.5M | ~$0.07 |
| 500 | ~73 GB | ~120k | ~2.4M | ~$1 |
| 1,000 | ~146 GB | ~240k | ~4.8M | ~$2 |

For comparison, the same data in Postgres would need a database disk of that size, plus backups of it.
