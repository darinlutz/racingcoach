# RacingCoach Website Developer Guidelines

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project Overview

**RacingCoach** is a business automation consulting website specializing in process automation and integration services.

**Tech Stack:**
- Frontend: Next.js 16.2.6 (App Router), React 19.2.4, TypeScript 5, Tailwind CSS 4
- Backend: Node.js API routes, Python automation scripts
- Integrations: Clockify (time tracking), Resend (email), Bitcoin data fetching
- Styling: Tailwind CSS 4 with custom color palette (`powder-*`, `dark-blue`)

## Quick Start

```bash
npm run dev          # Development server on http://localhost:3000
npm run build        # Production build
npm start            # Start production server
npm run lint         # Run ESLint
```

**Environment Variables** (`.env.local`):
- `CLOCKIFY_API_KEY` - Clockify workspace API key (used by `clockify_entry.py`)
- `RESEND_API_KEY` - Resend email service API key
- `RESEND_FROM_EMAIL` - Sender for password reset emails, on a domain verified in Resend (e.g. `Clarivex <no-reply@clarivex.app>`). Defaults to `onboarding@resend.dev`, which only delivers to the Resend account owner
- `SITE_URL` - Public site URL used in password reset links (e.g. `https://clarivex.app`). Set in production; locally it falls back to the request's host
- `OPENAI_API_KEY` - OpenAI API key (Racing page: Debrief Coach, lap summaries, reference points, Race Trends, Racecar Analysis RAG)
- `BOT_API_SECRET` - Shared secret the Discord bot sends to `/api/bot/*` routes (see Discord Bot below); the bot worker has the same value
- `DATABASE_URL` - PostgreSQL connection string, e.g. `postgres://user:pass@host:5432/clarivex`. Passed to `pg` as-is, plus `search_path=racingcoach`. Required; tables are created on first use (`ensureUserSchema()` in `src/lib/users.ts`). Everything lives in the `racingcoach` schema: `"Users"` (role `Admin`, `Coach` or `User`, see `src/lib/roles.ts`; new accounts are `User` except the site owner's, and admins change roles in the Admin page's User Roles section via `PUT /api/admin/users/role`, which won't let an admin change their own role or demote the last Admin), `"Friends"` (each user's own Racing friends list, linked by `user_id`), `"Tracks"` and `"TrackFocusAreas"` (the default tracks, seeded once from `src/lib/defaultTracks.ts` and not tied to a user), `"UsersTracks"` and `"UsersFocusAreas"` (each user's own Track Data, copied from the default tracks at sign-up), `"Cars"` (the default GT3 cars, seeded once from `src/lib/defaultCars.ts` and not tied to a user), `"CarsUsers"` (each user's own Car Data, copied from `"Cars"` at sign-up), `"IRacePlanConnections"` (each user's own iRacePlan API key) and `"RaceResults"` (races synced from iRacePlan for Race Trends, see `src/lib/raceHistory.ts`), `"DiscordConnections"` (each user's linked Discord account, see `src/lib/discord.ts`), `"DebriefSessions"` (each signed-in user's saved Debrief Coach runs, see `src/lib/debriefHistory.ts`), `"CollectorKeys"` (each user's telemetry collector upload key, hashed, see `src/lib/collectorKeys.ts`) and `"CollectorLaps"` (laps the collector uploaded, CSVs gzip-compressed, see `src/lib/collectorLaps.ts`), `"Sessions"`, `"PasswordResets"`, `"CancellationReason"` (why each monthly subscriber canceled, see `src/lib/cancellationReasons.ts`) and `"ActivityLog"` (every page view and click on a link, button or other control, from `src/components/ActivityTracker.tsx` via `POST /api/activity`; see `src/lib/activityLog.ts`. Never records typed text, and secret URL parameters are redacted by `src/lib/redactUrl.ts`. Add `data-no-track` to an element to leave it out, `data-track="name"` to give a control a stable name. Admins read it on the Admin page, `src/app/admin/page.tsx`, which filters through URL parameters and exports CSV from `/api/admin/activity/export`; both are queried by `src/lib/activityReport.ts` and answer 404 for anyone without the Admin role)
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` - OAuth2 credentials of the Discord application (discord.com/developers) behind the Account page's Connect Discord button. Its OAuth2 Redirects must include `<SITE_URL>/api/discord/callback` (and `http://localhost:3000/api/discord/callback` for local development)
- `DISCORD_PROXY_URL`, `DISCORD_PROXY_SECRET` - Optional; the Cloudflare Worker in `discord-proxy/` (e.g. `https://racingcoach-discord-proxy.<account>.workers.dev`) and its shared secret (the Worker's `PROXY_SECRET`). When set, the Connect Discord token exchange goes through the Worker instead of straight to discord.com, because Discord's Cloudflare protection sometimes bans Render's shared outbound IPs (429 "Access denied"). Leave unset locally. Deploy the Worker from `discord-proxy/` with `npx wrangler deploy`; it is not part of the Next.js build (`.dockerignore` excludes it)
- `SATELLITE_TILE_URL` - Optional; the satellite imagery under Lap Compare's driving line maps (`src/components/TrackLineMap.tsx`), as a tile URL template with `{z}`, `{x}`, `{y}` and the provider's key, e.g. Esri World Imagery: `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=<ArcGIS API key>`. Tiles are fetched through `/api/map-tiles/[z]/[x]/[y]` (signed-in users only) so the key stays on the server. Unset, the maps draw the lines on a plain background. iRacing's Lat/Lon lines up with Esri's imagery to within the width of the curbs
- `SATELLITE_ATTRIBUTION` - Optional; the provider's credit line shown on the maps. Defaults to Esri's
- `STRIPE_SECRET_KEY` - Stripe secret key (Checkout Session creation, success page lookup)
- `RACING_COACH_SILVER_MONTHLY_PRODUCT_ID`, `RACING_COACH_SILVER_ANNUAL_PRODUCT_ID`, `RACING_COACH_GOLD_MONTHLY_PRODUCT_ID`, `RACING_COACH_GOLD_ANNUAL_PRODUCT_ID` - Stripe Product IDs for the Pricing page's Monthly and Annual buttons on the Silver and Gold cards (mapped in `src/lib/stripePlans.ts`); each default Price must be recurring monthly or yearly to match. The page shows each level's Annual discount against 12 months of its Monthly price. Buying sets the account status to `Subscribed` and `"Users".membership_level` to the plan's level. Every account starts at `Bronze` (free); a Silver subscriber who buys Gold gets a new subscription, and the webhook then cancels the Silver one (prorated: its unused time is credited to the customer's next invoice) and the end date restarts from the Gold plan. A Gold subscriber can't buy Silver. The level drops back to Bronze once the paid period is over (`getUserById`)
- `STRIPE_WEBHOOK_SECRET` - Signing secret for `/api/stripe-webhook` (syncs `racingcoach."Users".account_status` with the subscription: `Unsubscribed`, `Subscribed`, `Canceled`, `Expired`; see `src/lib/accountStatus.ts`). Must receive `checkout.session.completed`, `invoice.paid` and `customer.subscription.deleted`

## Project Structure

```
src/
├── app/              # App Router root
│   ├── layout.tsx    # Root layout with Navigation
│   ├── page.tsx      # Home page (Bitcoin ticker, hero, CTA)
│   ├── globals.css   # Global Tailwind styles
│   ├── api/
│   │   ├── bitcoin/      # Bitcoin price ticker data
│   │   └── ...           # Racing, auth and Stripe routes
│   ├── racing/       # Racing page (friends, lap/stint analysis, debrief coach)
└── components/       # Reusable React components
    ├── Navigation.tsx
    ├── BitcoinTicker.tsx
```

**Python Components** (backend automation):
- `clockify_entry.py` - Automated Clockify time entry management
- `src/racecar_analysis_rag.py`, `src/simple_rag.py`, `src/chatbot_logging.py`, `src/prompts.py` - invoked as subprocesses by the Racing page's API routes
- `requirements.txt` - Python dependencies installed in the Docker image

## Development Conventions

### File Organization
- **Page components** in `src/app/[route]/page.tsx`
- **API routes** in `src/app/api/[feature]/route.ts`
- **Reusable components** in `src/components/`
- **One component per file** with matching exported name

### Styling
- Use Tailwind CSS utility classes (no CSS-in-JS)
- Custom colors: `powder-500/600` (primary), `dark-blue` (text), `slate-*` (neutrals)
- Gradients common in hero sections and CTAs: `bg-gradient-to-r from-powder-500 to-powder-600`

### API Route Patterns
- Validate input early (required fields, email format)
- Check environment variables before making external calls
- Return `NextResponse.json()` with appropriate status codes
- Handle errors gracefully with clear error messages

**Example API route structure:**
```typescript
export async function POST(request: Request) {
  try {
    const body = await request.json();
    // Validate
    if (!body.requiredField) {
      return NextResponse.json({ error: 'Missing field' }, { status: 400 });
    }
    // Process
    // Return
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
```

## External Integrations

### Clockify API
- **Workspace ID**: `5f5fb2a73ab33d735bc7ca3a`
- **Docs**: https://docs.clockify.me/
- **Python tool** (`clockify_entry.py`): Creates time entries, respects workdays/holidays

### Resend Email Service
- **Docs**: https://resend.com/docs
- **Usage**: Password reset emails sent via Resend
- **Config**: API key in `.env.local`

### Bitcoin Ticker
- Fetches real-time Bitcoin price data
- Component: `BitcoinTicker.tsx`
- No external API—check route implementation for data source

## Discord Bot

The RacingCoach Discord bot lives in `bot/`, a separate Node.js app (plain JavaScript, ES modules, discord.js) with its own `package.json`. It is not part of the Next.js build: `.dockerignore` excludes it, and it can't import from `src/`.

- **Deployed as** the Render Background Worker `racingcoach-bot` (Root Directory `bot`, Node runtime, build `npm ci`, start `npm start`). It redeploys only when files under `bot/` change.
- **Files**: `index.js` (logs in and answers slash commands), `deploy-commands.js` (registers the commands), `db.js` (read-only database access, set up like `src/lib/db.ts`), `api.js` (calls the website's bot-only routes), `coach.js`, `debrief.js` and `recent.js` (build the `/coach results`, `/coach debrief` and `/coach recent` embeds)
- **Commands**: all are subcommands of `/coach` (Discord doesn't let a command with subcommands run on its own, so there is no plain `/coach`): `/coach status` (online check), `/coach whoami` (shows the RacingCoach account linked to the caller's Discord account through `racingcoach."DiscordConnections"`, which the Account page's Connect Discord button fills), `/coach results` (the caller's last 5 races from `RaceResults`, then the coaching agent's top 3 opportunities from the website), `/coach debrief` (the caller's latest saved Debrief Coach run from `DebriefSessions`, no AI call), `/coach recent` (the caller's last 5 saved Debrief Coach sessions from `DebriefSessions`, one line each). New commands go in as another `.addSubcommand` in `deploy-commands.js` and a branch in `index.js`
- **Data vs AI**: the bot reads data straight from the database (`db.js`), and calls the website only for AI.
- **Bot-only API**: AI features stay in the website and are exposed to the bot under `src/app/api/bot/` (e.g. `POST /api/bot/coach` with `{ discordUserId }`), authenticated with `Authorization: Bearer <BOT_API_SECRET>`. The website and the bot worker must have the same `BOT_API_SECRET`
- **Registering commands**: commands are guild commands in the RacingCoach.app server, so changes show up immediately. After adding, renaming or changing a command in `deploy-commands.js`, run `npm run deploy-commands` from `bot/` locally; Render only runs the bot.
- **Running locally**: `cd bot`, `npm install`, then `npm start`. Stop the Render worker or the local bot first; two running copies both receive each command.
- **Environment variables** (`bot/.env` locally, git-ignored; the worker's Environment in Render):
  - `DISCORD_BOT_TOKEN` - Bot token from the Discord application's Bot tab (the same application as `DISCORD_CLIENT_ID`)
  - `DATABASE_URL` - Same database as the website
  - `SITE_URL` - Used for website links in replies, and as the website API's address unless `RACINGCOACH_API_URL` is set
  - `BOT_API_SECRET` - Shared secret for the website's bot-only API (same value as the website's)
  - `RACINGCOACH_API_URL` - Optional; the website address the bot calls, e.g. `http://localhost:3000` to use a local site
  - `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` - Only needed by `deploy-commands.js`. The guild ID is the RacingCoach.app server's ID (digits only)

## Telemetry Collector

`collector/RacingCoach.Collector/` is a Windows desktop app (C#, .NET 10, WPF) that reads live telemetry from iRacing, saves each completed lap as a CSV and uploads it to the user's account. Its window shows the status of iRacing, lap recording, uploads and track positions; the track, car and session; fuel and conditions; live inputs; the session's laps (time, gap to best, incidents, uploaded, positions added); and an activity log, also written to `Documents\RacingCoach\collector.log`. Like `bot/`, it's not part of the Next.js build (`.dockerignore` excludes it).

- **Files**: `Program.cs` (telemetry variable list, options, single-instance check, starts the window), `CollectorEngine.cs` (everything without UI: the SDK client and handlers, recorder, writer, uploader and enricher; the window reads its state ten times a second), `MainWindow.xaml`/`.xaml.cs` (the window, and the upload key prompt), `ActivityLog.cs` (activity messages and the log file), `UpdateCheck.cs` (newer release on GitHub), `LapRecorder.cs` (splits the 60 Hz stream into complete laps and throws away interrupted ones; no I/O), `LapWriter.cs` (writes laps and `session.json` on a background task; the only code that touches `session.json`), `SessionManifest.cs` (the `session.json` format), `LapUploader.cs` (uploads saved laps on its own task, retrying while the site is unreachable), `RacingCoachApi.cs` (calls `/api/collector/*`), `UploadSetup.cs` (checks an upload key with the site), `CollectorSettings.cs` (`%APPDATA%\RacingCoach\collector.json`: site URL and the upload key, DPAPI-encrypted), `IbtFile.cs` (reads track positions straight out of an `.ibt` file), `IbtEnricher.cs` (adds them to live laps after each stint), `OverlayEngine.cs` (runs `scripts/TelemetryEngine.js` for the overlay), `OverlayWindow.xaml`/`.xaml.cs` (the overlay), `SelfUpdater.cs` (downloads and installs a newer release), `SessionDebrief.cs` (the in-session debrief), `Voice.cs` (speaks through Windows' default voice)
- **Uploads**: each saved lap gets a `clientLapId` in `session.json` and is uploaded right after it's saved; `uploaded`/`uploadError` record the result. At startup, laps from earlier runs that aren't uploaded (and weren't refused) are queued too. Laps saved before session info arrived ("Unknown Track") are kept locally only. Played-back `.ibt` files don't upload unless `--upload` is given. Options: `--set-key`, `--no-upload`, `--upload`, `--site <url>` (this run only, e.g. a local dev server), `--no-positions`
- **Track positions (Lat/Lon/Alt)**: iRacing only writes these to its `.ibt` files, never to live telemetry, so live laps are saved and uploaded with empty `Lat`, `Lon`, `Alt` columns first. When live, the collector turns on iRacing's `.ibt` recording (once per connection, so Alt+L to turn it off sticks). When a stint's recording ends (leaving the car, disconnecting, or at the next startup), `IbtEnricher` reads the finished files in `Documents\iRacing\telemetry`, matches each CSV row by `SessionNum`, `SessionTick` and `SessionTime`, fills in the columns and uploads the lap again. A lap the `.ibt` doesn't fully cover (e.g. recording started mid-lap) gets `positionMissing` in `session.json`; `hasPosition` marks enriched laps. Laps older than 14 days are left alone. Played-back `.ibt` laps have positions straight away. `--no-positions` turns all of this off for a run
- **Lap files**: `Documents\RacingCoach\Laps\<date time> <track> - <car>\`, one CSV per lap plus `session.json` (track, car, driver, session IDs, and each lap's time, sample count, incidents, pit road and off-track flags). CSVs use iRacing's variable names and units (Speed in m/s, pedals 0-1), one row per 60 Hz sample from the start/finish line to the first sample of the next lap. File names are `RacingCoach - Driver - Car - Track - 01.50.486 - S0L005.csv` (`S<sessionNum>L<lap>` ID). The Racing page's lap tabs (`src/lib/lapData.ts`) only accept Garage 61 lap exports
- **Uploads to the website**: the Account page's Telemetry Collector card creates the user's upload key (`/api/collector/key`). The collector sends it as `Authorization: Bearer <key>` to `GET /api/collector/me` (checks the key), `GET /api/collector/track` (the overlay's focus areas), `POST /api/collector/debrief` (the in-session debrief) and `POST /api/collector/laps` (multipart: `lap` = JSON per `collectorLapSchema`, `csv` = the gzip-compressed lap CSV; retrying the same `clientLapId` returns `duplicate: true`, except that a CSV with track positions replaces a stored one without them and returns `replaced: true`; `"CollectorLaps".has_position` records which). Laps are stored in `"CollectorLaps"`; only `src/lib/collectorLaps.ts` reads or writes the CSVs, so storage can move out of Postgres later
- **In-session debrief**: once 3 laps of a session (this run's, not pit road laps or re-uploads with track positions) have uploaded, `SessionDebrief.cs` posts their `clientLapId`s to `POST /api/collector/debrief`, which measures the track's first focus area in each with `areaStats` (as Debrief Coach does; `src/lib/collectorDebrief.ts`) and answers the average and the sentence to say, e.g. "Area 1 average time was 12.3 seconds". The collector logs and speaks it, once per session. No AI call
- **Using uploaded laps**: Debrief Coach's "Your recorded laps" list (`src/components/RecordedLaps.tsx`) shows the signed-in user's laps grouped into sessions, with a checkbox per lap. Users only ever see their own laps; Coaches and Admins (`canSeeAllLaps` in `src/lib/roles.ts`) get a Driver box to open any driver's laps, or All Drivers for everyone's (`GET /api/collector/laps?userId=<id|all>`, which also returns the drivers with laps), and `GET /api/collector/laps/[id]` serves them any lap. Both routes enforce this, not just the page. It lists them with `GET /api/collector/laps` and fetches a picked lap's CSV from `GET /api/collector/laps/[id]` (both use the browser sign-in), then analyses it like a dropped CSV. Track names are matched with `sameTrackName` (`src/lib/lapData.ts`), which ignores case, punctuation and a plural "s", because iRacing's names can differ slightly from Track Data's (e.g. "Grand Prix Pit" vs "Grand Prix Pits")

- **Library**: `SVappsLAB.iRacingTelemetrySDK` (NuGet). Before changing collector code, read https://raw.githubusercontent.com/SVappsLAB/iRacingTelemetrySDK/main/docs/ai/SDK_USAGE.md. Telemetry variables are listed in `[RequiredTelemetryVars(...)]`, and the SDK generates the `TelemetryData` struct from that list; don't define it by hand
- **Connection**: `client.Monitor(...)` waits for iRacing, reconnects after it restarts, and reports changes through `OnConnectStateChanged`. Closing the window cancels it, then saves the last laps and gives queued uploads 10 seconds (the rest go next run)
- **Upload key**: asked for in the window the first time (or with `--set-key`, or the Upload Key button, or when the site stops accepting the saved one); laps are recorded either way, and a key entered later takes effect without restarting (`CollectorEngine.UseApi`)
- **Overlay**: the window's Launch Overlay button opens a see-through (70% opacity), always-on-top window with Max Brake (`GetMaximumBrakePressure`) and Min Speed (`GetMinimumSpeed`), then one row per focus area the track has (rows for missing areas are hidden): the name, Brake, Force, Gas (`GetBrakepointDiffTarget`, `GetBrakePressureDiffTarget`, `GetThrottlePickupDiffTarget`, colored by `GetBrakepointColorTarget`, `GetBrakePressureDiffTargetColor`, `GetThrottlePickupColorTarget`), Time (`GetTimeArea`), Exit (`GetSpeedArea`), Coast (`GetCoastingDistance`) and Overlap (`GetControlOverlapDistance`); `GetBrakepointAlertColor` colors the whole row's background while it alerts (the text turns plain light or dark then, as the value colors match the alert colors). It says "Starting new lap" (System.Speech) at the start/finish line. `OverlayEngine.cs` runs `scripts/TelemetryEngine.js` (a SimHub script, built into the exe as an embedded resource; `Documents\RacingCoach\TelemetryEngine.js` replaces it when present) in Jint, providing what the script expects from SimHub: `$prop(...)` answers from live telemetry in SimHub's units (SpeedLocal in mph, which the script labels its speeds; Brake 0-100; TrackLength in meters, preferring Track Data's length), `format(value, "0.00")`, `root` holds its state (emptied at each new session, by SessionUniqueID and SessionNum, and track), and `TrackConfig` holds the user's Track Data track from `GET /api/collector/track?name=<track>` (upload key auth; the Track Data text file's shape, matched with `sameTrackName`). While the overlay is open, every telemetry sample goes through the functions that measure from consecutive samples (`LapBrakePoint`, `GetAreaMaxBrake`, `GetThrottlePickupPoint`, the alert color, exit speed, coast, overlap, max brake, min speed), and the ones that only compare and format run 10 times a second (`TextEvery`); about 3 ms per sample with 8 areas, as Jint is slow. Nothing runs while it's closed. A new `$prop` the script reads must be added to `OverlayEngine.Prop` (and its telemetry variable to `Program.cs`), and a new function the overlay calls to `OverlayEngine.Functions`
- **Running**: `cd collector/RacingCoach.Collector`, then `dotnet run` for live telemetry, or `dotnet run -- path\to\file.ibt [speed]` to play back a recorded iRacing telemetry file (no simulator needed; `speed` defaults to 1 = real time, e.g. 1000 records a whole session in seconds). The SDK's playback crashes on `.ibt` files over 2 GB (`IbtFile.cs` reads them fine)
- **Releases**: push a `collector-v<version>` tag (e.g. `git tag collector-v1.2.0` then `git push origin collector-v1.2.0`) and `.github/workflows/collector-release.yml` builds one compressed, self-contained `RacingCoach.Collector.exe` (about 62 MB, .NET inside, so the sim PC needs nothing installed) and publishes it as the latest GitHub release. The Account page's Download button (`src/components/CollectorKeyCard.tsx`) links to `releases/latest/download/RacingCoach.Collector.exe`, and the collector updates itself: at startup `UpdateCheck.cs` finds a newer release on GitHub, `SelfUpdater.cs` downloads its exe beside the running one (`.new`, checked against the size GitHub lists) and the banner offers Restart Now; otherwise it installs when the window closes, after the last laps are saved. Installing renames the running exe to `.old` (a running exe can be renamed, not overwritten) and moves the new one into place; Restart Now starts it with `--after-update`, which waits up to 60 s for the old one to release the single-instance mutex. The next start deletes `.old` and any half-finished `.download`. Builds that aren't the single-file exe (`dotnet run`), failed downloads and failed installs fall back to the banner's Download button (the release page). Collectors before 1.2.0 only show the banner. The exe isn't code-signed, so Windows SmartScreen warns on first run (More info, Run anyway). Bump `<Version>` in the `.csproj` to match when tagging, for local builds
- **Local build of the exe**: `dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -o bin/publish`

## Linting & Code Quality

**ESLint configuration** (`eslint.config.mjs`):
- Next.js Core Web Vitals rules
- TypeScript support
- Uses modern ESLint flat config format

```bash
npm run lint         # Check all files
```

**Ignored paths**: `.next/`, `out/`, `build/`, `next-env.d.ts`

## Common Tasks

### Add a New Page
1. Create file: `src/app/[page-name]/page.tsx`
2. Export default React component
3. Add route to `Navigation.tsx` if needed

### Add an API Endpoint
1. Create `src/app/api/[feature]/route.ts`
2. Implement `GET`, `POST`, etc. handlers
3. Add env variables to `.env.local` if needed

### Update Tailwind Styles
1. Edit `tailwind.config.ts` for theme/colors
2. Use classes in components (auto-generated)
3. No build step needed—watch mode handles it

## Troubleshooting

**npm run dev fails with "command not found"?**
- Ensure Node.js 18+ is installed
- Run `npm install` first
- Check that `.env.local` exists (can be empty initially)

**ESLint errors on import statements?**
- Verify TypeScript path aliases in `tsconfig.json` (e.g., `@/*` → `src/*`)
- Run `npm run lint -- --fix` to auto-fix common issues

**Build succeeds but `npm start` is slow?**
- Normal for first cold start
- Production bundle includes optimizations
- Subsequent requests are faster

## Related Documentation

- [Next.js Documentation](https://nextjs.org/docs)
- [React 19 Upgrade Guide](https://react.dev/blog/2024/12/19/react-19)
- [Tailwind CSS 4 Changelog](https://tailwindcss.com/docs/v4)
- [TypeScript Configuration](tsconfig.json)
