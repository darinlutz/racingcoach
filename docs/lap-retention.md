# Lap Telemetry Retention: Operations

How the lap retention policy is enforced, deployed and rolled back. The rules and code are summarized in AGENTS.md
(Lap Telemetry Retention); the user-facing text is the Privacy Policy's section 8 and the Terms' section 5 in
`src/lib/legal.ts`.

## Policy

| Membership | Kept after the lap was completed |
|---|---|
| Bronze (free) | 30 days |
| Silver | 60 days |
| Gold | 90 days |
| Any level not listed | 30 days (the shortest, until it's added) |
| Absolute maximum | 90 days |

- The clock starts at the lap's completion: the collector's `recordedAt`, but never later than the time the site
  received it. Saved Debrief Coach runs count from when they were saved. Re-uploads never restart it.
- Upgrades lengthen unexpired laps to the new period. Downgrades shorten them, and laps past the new period expire
  at once.
- A paid membership that is canceled, or not renewed, stays in effect until its paid period ends, then becomes
  Bronze. **Gold grace period:** as a measure of goodwill, laps covered by Gold stay until 7 days after the paid period
  ends, never past 90 days after completion. Silver has no grace period.
- Expired laps are never restored, whether by upgrading, resubscribing or uploading again.
- The periods are business choices, set by the lap history each level includes for comparison and coaching. The
  GDPR doesn't prescribe them. They implement storage limitation and data minimization (Art. 5(1)(c), (e)), they
  are disclosed (Art. 13(2)(a)), and they are enforced by default in the database (Art. 25), with a record of every
  cleanup run (Art. 5(2)). This feature alone doesn't make the application GDPR compliant.

## Inventory of lap telemetry

| Where | What | Handling |
|---|---|---|
| `"CollectorLaps"` (the row and `csv_gzip`) | Raw lap telemetry, every 60 Hz sample | Expires by the rules above, then deleted |
| `"DebriefSessions"` (`session`, `debrief`) | Per-lap measurements and the AI's debrief | Same rules, from `created_at` |
| `"ExpiredLaps"` | User ID, collector lap ID and completion time of deleted laps; no telemetry | Purged 90 days after completion |
| `"LapRetentionRuns"` | Counts and error messages of cleanup runs | Kept 365 days |
| `"Users"."TargetLap"` | One lap the user chose as their target | User-chosen reference content: kept until replaced or removed, or the account is deleted |
| `"ExpertLaps"` | Coaches' reference laps, shared with everyone | Coaching content, kept |
| `"Tracks"` bounds and outline | Track geometry from one lap, with no user | Not personal data, kept |
| `"RaceResults"`, Stripe tables, `"CancellationReason"` | Results and billing, no telemetry | Separate retention (Privacy Policy section 7) |
| `"CollectorLogs"` | Collector activity text, no telemetry | 90 days (existing) |
| Live Racing | Position in server memory | Gone 5 minutes after the last update |
| Render database backups | Everything | Render's backup window; expired rows in a restore are hidden at once and deleted by the next run |
| AI and speech providers | Lap measurements in prompts | The providers' own retention; disclosed, not claimed deleted |
| Collector PC: `Documents\RacingCoach\Laps` | Lap CSVs and `session.json` | Deleted once uploaded with track positions; at once if the site refuses the lap as expired; at 90 days in any case |
| Collector PC: `Documents\iRacing\telemetry\*.ibt` | iRacing's recordings, which the collector turns on | Deleted at 90 days, at collector startup |

## Database changes

All of these are in `LAP_RETENTION_SCHEMA` (`src/lib/lapRetentionDb.ts`), which `ensureUserSchema` runs inside its
transaction on the first database use after a deploy. They can run again safely.

- `"CollectorLaps"`: `completed_at` and `expires_at` (both NOT NULL after the backfill), and an index on `expires_at`
- `"DebriefSessions"`: `expires_at` (NOT NULL after the backfill), and an index on it
- The functions `lap_retention_days`, `lap_level_rank`, `lap_expires_at`, `lap_restamp` and
  `restamp_lap_retention`, and the trigger `users_membership_lap_retention` on `"Users"`
- The new tables `"ExpiredLaps"` and `"LapRetentionRuns"`

The backfill sets `completed_at = LEAST(recorded_at, uploaded_at)` and `expires_at` from the owner's current level.
**Nothing is deleted by the migration.**

Impact on production, from a read-only count on 2026-10-28: 235 laps (177 Gold, 58 Silver) and 26 Debrief Coach
runs. **None would expire today.** The oldest lap is from 2026-10-11. No lap had a completion time after its upload
time.

## Deployment

1. **Deploy the website.** The migration runs on its first request. The cleanup's first run, a minute after start, is
   a dry run. During Render's zero-downtime switch, the old instance's lap uploads fail on the new NOT NULL columns,
   and the collector retries them.
2. **The Discord bot** redeploys from the same push, because `bot/db.js` changed. It reads `expires_at`, so its
   `/coach debrief` and `/coach recent` fail until the website has migrated, which is normally seconds.
3. **Release collector 1.51.0** (`git tag collector-v1.51.0`, push the tag). The Privacy Policy describes its local
   deletion, so release it the same day as the website. Installed collectors update themselves.
4. **Check the Admin page's Lap Telemetry Retention section.** Dry runs show how many laps are due each hour.
5. **Turn deletion on**, after your explicit approval: set `LAP_RETENTION_MODE=delete` in the Render web service's
   environment. Do it before laps start to come due. The canceled Silver account's laps can fall to Bronze's 30 days
   when its paid period ends, which makes laps from 2026-10-11 due from 2026-11-10 at the latest. Until then, expired
   laps are hidden but stay stored, which falls short of the policy's "permanent deletion".

The new policy versions (2026-10-28) ask every user to accept again, on the website and in the collector, without
blocking anything.

## Rollback

**A schema rollback never brings back deleted laps.** Only a Render backup restore could do that, within Render's
backup window, and that restore would itself be subject to these rules.

To roll back the application:

1. Set `LAP_RETENTION_MODE` to anything but `delete`, or remove it, to stop deletion at once.
2. Revert the commit and redeploy. The old code doesn't write the new columns, so first run:

```sql
ALTER TABLE racingcoach."CollectorLaps" ALTER COLUMN completed_at DROP NOT NULL, ALTER COLUMN expires_at DROP NOT NULL;
ALTER TABLE racingcoach."DebriefSessions" ALTER COLUMN expires_at DROP NOT NULL;
DROP TRIGGER IF EXISTS users_membership_lap_retention ON racingcoach."Users";
```

3. To remove the feature from the schema completely, which is optional and loses the expiry data:

```sql
ALTER TABLE racingcoach."CollectorLaps" DROP COLUMN completed_at, DROP COLUMN expires_at;
ALTER TABLE racingcoach."DebriefSessions" DROP COLUMN expires_at;
DROP FUNCTION IF EXISTS racingcoach.restamp_lap_retention(), racingcoach.lap_restamp(TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, TEXT, TIMESTAMPTZ),
  racingcoach.lap_expires_at(TIMESTAMPTZ, TEXT), racingcoach.lap_level_rank(TEXT), racingcoach.lap_retention_days(TEXT);
DROP TABLE IF EXISTS racingcoach."ExpiredLaps", racingcoach."LapRetentionRuns";
```

4. Restore the previous Privacy Policy and Terms text and their versions together. The published policy must match
   what the site does.

## Tests

`npm run test:lap-retention` runs two suites:

- `scripts/lap-retention.test.mjs`: the rules at exact UTC boundaries.
- `scripts/lap-retention-db.test.mjs`: the real `ensureUserSchema`, uploads, reads, membership changes and cleanup,
  against a local Postgres. It needs `LAP_RETENTION_TEST_DATABASE_URL`, and the file's header shows a one-line
  Docker command for the database.
