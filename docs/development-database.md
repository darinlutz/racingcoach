# Development database

`npm run dev` uses a database on your own computer, never the live site's. Three things keep it that way.

## 1. A local database

The development database is Postgres 17 from Homebrew, `racingcoach_dev`, set as `DATABASE_URL` in `.env.local`:

```bash
brew install postgresql@17          # once
brew services start postgresql@17   # starts now and at every login
createdb -h 127.0.0.1 racingcoach_dev
npm run db:dev                       # makes the racingcoach schema and its tables
npm run db:dev -- --copy-from production
```

`.env.local`:

```
DATABASE_URL=postgres://<your Mac user>@127.0.0.1:5432/racingcoach_dev
PRODUCTION_DATABASE_URL=<the live database's URL>   # read only by --copy-from production
```

`--copy-from production` copies the shared reference data, read only, from the database in `PRODUCTION_DATABASE_URL`:
Track Data (`"Tracks"`, `"TrackFocusAreas"`, with their outlines and lengths), Car Data (`"Cars"`), `"TracksNumberOfCorners"`,
the simulator mappings and `"SiteSettings"` (coach instructions, AI model choices, rate limits; not the Stripe portal
configuration or the spend monitor's state). Never an account, lap, log or anything else personal: sign up on the
local site to get an account, and make it an Admin with
`psql -h 127.0.0.1 racingcoach_dev -c "UPDATE racingcoach.\"Users\" SET role = 'Admin' WHERE email_address = '...'"`.
Run it again whenever you want the latest Track Data; it replaces those tables' rows in the development database.

The script refuses a `DATABASE_URL` that isn't on this computer. Without the copy, the tables are seeded from
`src/lib/defaultTracks.ts` and `src/lib/defaultCars.ts` on first use, like any new database.

Scripts that read `DATABASE_URL` from `.env.local` (`scripts/importTracks.mjs`, `scripts/rotation-calibrate.mjs --db`) now
use the development database too. To run one against the live database on purpose, give it the URL for that run:
`DATABASE_URL="$(grep ^PRODUCTION_DATABASE_URL= .env.local | cut -d= -f2-)" node scripts/importTracks.mjs ...`.

## 2. The guard

`src/lib/db.ts` checks the database before its first query (`databaseVerdict` in `src/lib/serverEnvironment.ts`):

- The **live server** (the production build on Render: `NODE_ENV=production` and Render's `RENDER=true`) marks its
  database as production, one row in `racingcoach."DatabaseEnvironment"`, the first time it connects.
- **Any other server** (`npm run dev`, `npm start` on a Mac, the tests) refuses a database marked production: every
  query fails with "Refusing to use the PRODUCTION database from a non-production server", logged once.
- `ALLOW_PRODUCTION_DATABASE=yes` lets a non-production server use it anyway, with a warning, for a deliberate one-off.
  Don't leave it in `.env.local`.

`LIVE_SERVER=on` or `off` overrides the live server test either way (`on` also marks the database, so never set it
against a database you develop with).

## 3. Background jobs

The jobs started from `src/instrumentation.ts` (lap retention, the consent record purge, the broadcast video worker,
privacy jobs and the telemetry storage jobs) delete laps and records and call paid services, so they run on the live
server only (`backgroundJobsEnabled`). A local server logs `Background jobs are off: not the live server` at start.
`BACKGROUND_JOBS=on` turns them on (the browser tests do, against their own database), `off` turns them off anywhere.
Error and spend monitoring likewise run on the live server only, or with `MONITORS=on`.

## What still reaches outside services

The guard covers the database only. `.env.local` still holds live keys, so a local server can send real emails
(Resend), make real AI and speech calls, and reach Stripe with whatever key is there. Use Stripe's test mode keys
(`sk_test_...`, a test webhook secret from `stripe listen`) locally.

## Tests

`npm run test:launch-hardening`: the rules, that every query goes through the guard and every job through the switch,
then (with `LAUNCH_HARDENING_TEST_DATABASE_URL`) the guard against a real local database.
