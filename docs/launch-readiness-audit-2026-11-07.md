# RacingCoach.app Pre-Launch Production Readiness Audit

**Date:** 2026-11-07
**Commit:** `8887b5d` (main)
**Method:** eight specialist agents ran in parallel: FinOps, AppSec, Billing, Infrastructure, Frontend/UX, Privacy, Collector and Reliability/QA. They reviewed the source read-only. The lead reviewer then re-checked the most severe claims against the code; those checks are marked ✔ below.

**What was not done:** no production access, no Render dashboard, no Stripe dashboard, no database, no billable calls, no load tests, no code changes.

**Confidence labels:**
- **CONFIRMED:** traced in code.
- **PLAUSIBLE:** likely, but it depends on behaviour or configuration that wasn't seen.
- **NOT VERIFIED:** needs dashboard or production access.

---

## A. Executive summary

### Verdict

**Not ready for paying customers yet. It can be made ready in about 1.5 to 2 engineer-weeks.**

The foundations are better than most pre-launch SaaS:
- AI routes have a server-side, concurrency-safe gate (`aiRateLimit`, which takes an advisory lock and runs before the call).
- Paid tiers are enforced on the server, never only in the UI.
- Access to laps by ID (IDOR) is checked in SQL.
- The Stripe webhook verifies signatures and deduplicates events.
- R2 keys are built from server IDs only.
- Cookie consent is properly gated.
- Data erasure is ledgered.
- 294/294 unit tests pass, and `tsc` and lint are clean.

What blocks launch is a small number of concrete defects:

1. **A single free account can generate an unbounded AI bill** through the collector log review, which runs gpt-4o, isn't metered, and is triggered by any upload key. The worst case is tens of thousands of dollars per day.
2. **Paying subscribers can be silently downgraded to Bronze at renewal.** Their laps are then expired, which loses data permanently.
3. **The installed Next.js (16.3.8) has a published unauthenticated RCE advisory** in the Image Optimizer, and this app uses that optimizer.
4. **Lap retention deletes nothing unless `LAP_RETENTION_MODE=delete` is set.** Until then the Privacy Policy's 90-day promise is not kept.
5. **Account takeover before the real owner signs up.** There is no email verification, and Google sign-in links to any existing account with the same email. Owner privileges (Admin role, the owner's iRacePlan key, the cloned voice) are granted by matching hard-coded email addresses at signup.

### Top 10 risks

| # | Risk | Area | Severity |
|---|---|---|---|
| 1 | The collector log review can be triggered by any free account, unmetered, on gpt-4o (F-01) | Cost | Critical |
| 2 | Renewal leaves a paying member on Bronze and expires their laps (F-02) | Billing / data loss | Critical |
| 3 | Next.js 16.3.8 has an RCE advisory (`/_next/image`) (F-03) | Security | Critical |
| 4 | Retention is a dry run by default, so the policy promise is broken (F-04) | Legal | Critical (config) |
| 5 | No email verification, Google auto-linking, and privileges by email match (F-05) | Security / cost | High |
| 6 | Map tile proxy has no rate limit or cache, so Esri bills are unbounded (F-06) | Cost | High |
| 7 | No dollar, token or character budget. LangChain retries up to 6× and has no `maxTokens`. Enable AI Features doesn't cover the Debrief Coach, summaries or speech (F-07, F-08, F-09) | Cost / ops | High |
| 8 | Client IP is taken from the spoofable leftmost `X-Forwarded-For`, so every per-IP limit can be bypassed (F-10) | Security / cost | High |
| 9 | Any user can permanently poison shared Track Data (outlines, lengths, locations) (F-11) | Integrity | High |
| 10 | pg Pool has no `error` handler (crash on DB blip); schema migrates at boot under exclusive locks; no CI (F-14, F-15, F-20) | Reliability | High |

### Answers to your questions

| Question | Answer | Findings |
|---|---|---|
| What could cause me to lose money? | The log review, map tiles, speech character volume, LangChain retries, a rate limiter that fails open, refunds after tokens are spent, and multi-accounting with spoofed IPs. Also: renewals that downgrade members, which drives churn and refunds. | F-01, F-06, F-07, F-08, F-10, F-12, F-13, F-02 |
| What could compromise customer data? | The Next.js RCE, account takeover before signup, reset-link host poisoning if `SITE_URL` is unset, and no security headers. | F-03, F-05, F-17, F-24 |
| What could bypass subscription restrictions? | Little. Tiers are enforced on the server. The gaps: the recorded-stint limit is enforced only in the UI; Bronze watchers can still use ElevenLabs radio playback; promo codes are shared with TalkNinja; disputes and refunds don't revoke access. | F-26, F-22, F-23 |
| What could cause outages? | A Postgres blip with no Pool error handler, the boot-time migration lock, connection-budget overflow, unbounded request bodies, synchronous gunzip on the event loop, and a Python process per Racecar Analysis question. | F-14 to F-19 |
| What could prevent scaling? | All live state is in one process's memory, polling costs about 4 DB queries per viewer per second, there's no session cache, and lap visibility queries can't use their indexes. | F-29, F-30, F-31 |
| What is the legal or operational exposure? | Retention isn't deleting, radio transcripts are stored despite the policy, logs outlive their stated period, Cloudflare's lap-storage role isn't disclosed, and there's no age attestation, postal address or EU representative. | F-04, F-21, Section 9 |
| What must be fixed before launch? | The P0 list in Section E. | |

---

## B. Findings register

**Columns:**
- **ID:** consolidated finding. The original agent IDs are in brackets.
- **Effort:** XS < 1 h · S ≈ ½ day · M ≈ 1–3 days · L > 3 days.

### Critical

**F-01: Unmetered gpt-4o collector log review that any free account can trigger** [FIN-1, COL-2, REL-4] (Cost, Critical, CONFIRMED ✔)

Evidence:
- `src/app/api/collector/log/route.ts:13-25` accepts any upload key and calls `scheduleCollectorLogReview`.
- `src/lib/collectorLogs.ts:14` allows `runId: z.uuid()` chosen by the client, with 500 lines × 4,000 characters per batch (`:9-10`).
- `src/lib/collectorLogReview.ts:38-39` deduplicates only on `userId:runId`. It sends up to 200 lines to the model (`:118-140`) through `siteAiCall` (weight 0, not limited; `src/lib/rateLimits.ts:359-380`).
- The model is `gpt-4o` (`src/lib/aiModelList.ts:15`).
- It ignores Enable AI Features, rate limits and overrides.
- The email cap (20/day) is global, so it can be used up to hide real alerts.

Exploit:
1. Sign up free.
2. Create an upload key.
3. Loop POSTs, each with a fresh UUID `runId`, one `isError:true` line and long lines.

Each review is about 120k input tokens, roughly $0.30. At 1 request per second that is about $26k/day. The attacker also writes the text of the "COLLECTOR ERROR" emails sent to the owner, which is a phishing channel.

Remediation:
- A per-user review cap (e.g. 3/day) and a global cap (e.g. 100/day), both counted in `AiUsage`.
- At most one review per user per 10 minutes.
- Truncate lines to 500 characters and the prompt to 20k characters.
- Use gpt-4o-mini.
- Skip the review when AI is disabled.
- Quote log text as untrusted in emails.

Effort: S. Test: 50 batches with distinct runIds produce ≤3 reviews.

**F-02: Renewal can permanently drop paying members to Bronze and expire their laps** [BILL-1, BILL-3] (Billing / data loss, Critical, CONFIRMED ✔)

Evidence:
- `startSubscription` sets `subscription_end_date = oneMonthFrom(now)` (`src/lib/users.ts:1265`) rather than Stripe's `current_period_end`.
- Stripe finalizes and charges the renewal about 1 h after the period ends.
- In that window, `END_LAPSED_MEMBERSHIPS_SQL` (`src/lib/lapRetentionDb.ts:119-125`) runs on every `getUserById` and hourly. It sets the account to Expired and Bronze.
- `renewSubscription` (`users.ts:1275-1282`) then sets Subscribed but **never restores `membership_level`**. The only other writers are the Admin page and checkout.
- The retention trigger re-stamps the laps to Bronze's 30 days. Silver gets no grace period, and expired rows are never un-expired.
- The same happens after a Smart Retry recovers a past-due payment.
- `invoice.paid` arriving after `customer.subscription.deleted` revives a canceled account (BILL-3).

Impact:
- Paying members lose every paid feature.
- Their laps disappear, permanently once deletion is on.
- The UI then offers them an "upgrade" to the plan they already pay for, and buying it cancels the subscription they have.

Remediation: make the Users billing columns a projection of the Stripe subscription, written inside `syncSubscription` (already under a per-subscription lock):
- status
- level from the price
- `current_period_end`
- a 48–72 h grace while the status is `active`/`past_due`

Remove the ad-hoc writes in `startSubscription` and `renewSubscription`.

Effort: M. Test: simulate checkout → period end + 30 min → page load → `invoice.paid`. The member should still be Silver/Gold with laps unexpired. Run a Silver variant too.

**F-03: Next.js 16.3.8 with Critical advisories** [SEC-1] (Security, Critical, version CONFIRMED ✔, exploitability PLAUSIBLE)

Evidence:
- `node_modules/next/package.json` is 16.3.8.
- `npm audit` lists GHSA-2464-fhr4-w9xw, an unauthenticated RCE in the Image Optimization API with SVG (≤16.4.0).
- `/_next/image` is enabled (`next.config.js` doesn't disable `images`), `next/image` is used, and SVGs are in `public/`.
- Also reported: a Server Actions DoS, and zod 4.4.3 (memory exhaustion, < 4.6.6), which is used on every request body.

Impact: server takeover exposes `DATABASE_URL`, Stripe and every AI key.

Remediation: upgrade `next` (> 16.4.0) and `zod` (≥ 4.6.6), run `npm audit --omit=dev`, and redeploy.

Effort: S. Test: `npm audit --omit=dev` shows no critical or high server-side advisories.

**F-04: Lap retention never deletes unless an env var is set** [PRIV-1] (Legal, Critical until verified, CONFIRMED in code; production value NOT VERIFIED)

Evidence:
- `src/lib/lapRetention.ts:15` treats anything other than `delete` as a dry run.
- Every DELETE in `lapRetentionDb.ts:199-230` is skipped in a dry run.
- R2 cleanup is triggered only by row deletes, so no objects are removed either.
- The Privacy Policy (`src/lib/legal.ts:215,217`) and the Terms (`:409`) promise deletion within 90 days.
- `docs/lap-retention.md` says laps start falling due around **2026-11-10**.

Remediation:
- Set `LAP_RETENTION_MODE=delete` on Render, then confirm the Admin → Lap Telemetry Retention runs show deletions.
- Consider making delete the production default, with an explicit `dryrun` to stop it.

Effort: XS.

### High

**F-05: Account pre-takeover; owner privileges granted by email match** [SEC-2, UX-4] (Security / cost, High, CONFIRMED ✔)

Evidence:
- Signup creates the account and a session with no verification (`src/app/api/auth/signup/route.ts:57-67`).
- Google sign-in links to any existing account with the same email (`src/lib/googleAuth.ts:143-146`). It doesn't clear the attacker's password or sessions.
- The Google routes are live whenever `GOOGLE_CLIENT_*` is set. `SHOW_GOOGLE_SIGN_IN=false` only hides the button.
- `initialRole` makes `OWNER_EMAIL` an Admin (`users.ts:71,1041`).
- `IRACEPLAN_SHARED_ACCOUNTS` gives the owner's iRacePlan key (`users.ts:74,1089`).
- `MY_VOICE_ACCOUNTS` gives the owner's cloned voice (`src/lib/driverRadio.ts:14`).
- `MODEL_LEARNING_ACCOUNTS` (`src/lib/modelLearning.ts:6`).

Exploit:
- Register a victim's email with your own password. When the victim later uses Google sign-in, they land in the attacker's account.
- Register any owner-listed address that isn't registered yet, or the owner address after a database restore, to get Admin, the API key or the voice clone.
- Unverified signups also multiply free AI quotas.

Remediation:
1. Email verification before AI features, upload keys, checkout and Google linking.
2. When Google links to an unverified password account, clear the password and sessions.
3. Grant owner privileges by role in the database, not by email at signup. Confirm that every listed address is registered and owned now.

Effort: M.

**F-06: Map tile proxy has no rate limit, area limit or server cache** [FIN-2, COL-6, SEC-9] (Cost, High, CONFIRMED ✔)

Evidence:
- `src/app/api/map-tiles/[z]/[x]/[y]/route.ts:17-50` accepts any session, TV or upload key.
- It accepts any z ≤ 19 and any x/y on Earth.
- It fetches ArcGIS every time, with only `Cache-Control: private`.

Impact: about $650/day at 50 tiles per second (assuming about $0.15 per 1,000 tiles). Bulk downloading also breaks Esri's terms of service.

Remediation:
- Serve only tiles inside known `Tracks` bounds plus a margin.
- A per-user daily tile cap (Bronze 1,000, Silver 3,000, Gold 5,000).
- A server LRU cache, or R2, if Esri's terms allow it.

Effort: S–M.

**F-07: No dollar, token or character budget; no output-token cap; retries multiply cost** [FIN-3, REL-3, REL-6, REL-7] (Cost, High, CONFIRMED ✔)

Evidence:
- Limits count weighted calls only. Tokens are recorded but never enforced.
- `src/lib/aiModels.ts:160-181` builds OpenAI and DeepSeek models with no `maxTokens`, `maxRetries` or `timeout`. LangChain's default is 6 retries. Only Claude has `maxTokens: 16000`.
- Only the Debrief Coach and In-Car Coach pass an `AbortSignal`.
- These have none:
  - `raceAnnouncer.ts:379`
  - `raceEngineer.ts:313`
  - `setupEngineer.ts:200`
  - `lapSummary.ts:158,231`
  - `collectorLogReview.ts:125`
  - `ragRoute.ts:167`
- The Debrief Coach allows 2 invokes × `recursionLimit: 40` and doubles that on fallback (`debriefCoach.ts:1144-1165`).
- No route passes `request.signal`, so a closed tab doesn't stop billing.
- `maxDuration` is ignored on Render.
- There is no global or provider spend cap anywhere.

Impact:
- During an OpenAI incident, each call can make 7 attempts.
- An Admin switching a model to a premium one raises cost 10–30× with no guard.
- One Gold debrief can cost about $1–2 in the worst case.

Remediation:
- In `chatModel`: `maxRetries: 1` (0 for live features), `timeout`, and a per-feature `maxTokens` (e.g. 1,500).
- `AbortSignal.any([request.signal, AbortSignal.timeout(n)])` on every invoke.
- `recursionLimit` around 15.
- A per-user daily dollar budget computed from `AiUsage` tokens × `aiModelPrices`, plus a global daily ceiling that auto-disables and emails at 50%, 80% and 100%.

Effort: M.

**F-08: Enable AI Features is not a real kill switch** [REL-5, FIN-e] (Ops / cost, High, CONFIRMED ✔)

Evidence: `getEnableAiFeatures` is checked by only 7 routes:
- `account/in-car-coach-instructions`
- `account/race-announcers`
- `collector/in-car-coach`
- `collector/radio`
- `live/announcer`
- `live/voice-message`
- `tv/announcer`

Plus `ragRoute` and the Director.

It is **not** checked by:
- `debrief-coach`
- `lap-summary`
- `multi-lap-summary`
- `stint-summary`
- `collector/speech`
- `live/radio-speech`
- `account/coach-voice/sample`
- `account/race-announcers/sample`
- the log review
- map tiles

Admins are exempt from rate limits by default. Settings are cached for 15 s.

Remediation: one `assertMeteredAllowed(feature)` check inside `aiRateLimit`, `siteAiCall`, `synthesizeSpeech`, `transcribeRadio` and the tile proxy, so no route can miss it. Add per-feature switches.

Effort: S.

**F-09: Speech is limited by call count, not characters; the default voice is ElevenLabs, including for Bronze** [FIN-4, COL-8] (Cost, High, CONFIRMED)

Evidence:
- `/api/collector/speech` accepts any text up to 500 characters (`src/lib/coachVoice.ts:57`).
- The default voice is ElevenLabs (`coachVoice.ts:96`).
- The live limits are 30/500/2000 calls per day (`src/lib/rateLimitConfig.ts:187-195`).
- The ElevenLabs cache holds 64 entries.

Impact:
- Bronze: about 15k characters/day ≈ $3/day ≈ **$90/month per free account**, multiplied by multi-accounting.
- Gold: 1M characters/day ≈ $200/day.

Remediation:
- Cap text at about 200 characters.
- A character budget per tier.
- Bronze gets Chirp or the Windows voice only.
- A server cache keyed on text and voice.

Effort: S.

**F-10: Spoofable client IP** [FIN-5, SEC-3] (Security / cost, High, CONFIRMED ✔ code; Render header behaviour PLAUSIBLE)

Evidence: `clientIp` uses the first `X-Forwarded-For` entry (`src/lib/rateLimits.ts:75-77`). It feeds:
- the signup, login, forgot-password, support, privacy-form and TV-pairing guards (`src/lib/abuseGuards.ts:61-63`)
- the anonymous AI limits
- IP overrides

Impact:
- Unlimited signups, which multiplies every free quota.
- Password-reset email floods.
- Brute-force limits bypassed per IP. The per-email limits still hold, but they let an attacker lock victims out.

Remediation: use the hop Render appends (the right-most), or Cloudflare's `CF-Connecting-IP` if fronted by Cloudflare. Add Turnstile on signup.

Effort: S.

**F-11: Any user can poison shared Track Data for everyone** [COL-1] (Integrity, High, CONFIRMED)

Evidence:
- Every iRacing lap upload calls `saveTrackLength` and `saveTrackLocation`, last write wins (`src/lib/collectorLaps.ts:550-552`, `trackLengths.ts:34-40`, `trackLocations.ts:40-51`).
- Bounds and outline are first write wins, permanent, with no reset (`trackLocations.ts:65-72`, `trackOutlines.ts:74-80`).
- `trackKey` is free text from the client.

Impact: wrong lengths, maps, outlines and satellite pictures for every user, on Live Racing, the TV, the overlay fallback and My Dashboard. Hundreds of layouts nobody has driven yet can be pre-seeded.

Remediation:
- Accept these values only from Coach or Admin accounts, or promote them after N agreeing laps from different users.
- Check the length against the lap's own LapDist/LapDistPct.
- Check that the outline's perimeter roughly equals the length.
- An Admin action to reset a track.

Effort: M.

**F-12: Rate limiter fails open** [FIN-7] (Cost, High, CONFIRMED ✔)

Evidence: any error in the limit transaction allows the call untracked (`src/lib/rateLimits.ts:319-321`). During a database incident, every AI route becomes unlimited.

Remediation:
- Fail closed for live, Debrief and other expensive features.
- Fail open only for cheap ones, with an in-memory per-user fallback counter.

Effort: S.

**F-13: Uploads have no rate limit or quota, and body size isn't enforced before buffering** [COL-3, FIN-10, INFRA-8, SEC-6] (Availability / cost, High, CONFIRMED)

Evidence:
- `collector/laps` checks only the declared `content-length`; a chunked body skips it, and `formData()` buffers everything (`route.ts:80-92`).
- These read the whole body before checking size:
  - `collector/radio` (`:51`)
  - `live/voice-message` (`:38`)
  - `account/picture` (`:45-50`)
  - `account/target-lap` (`:55`)
  - `coach/expert-laps` (`:20`)
- Unauthenticated JSON routes (login, signup, support, privacy, consent, activity) have no cap.
- No per-user lap count, byte quota or log-line quota.
- `gunzipSync` of up to 25 MB runs on the event loop (`collectorLaps.ts:121,186`).

Impact:
- A multi-GB POST can exhaust memory on the single instance.
- A buggy collector that mints new lap IDs fills R2.

Remediation:
- A shared `readBodyLimited(request, maxBytes)` helper that streams with a hard cap.
- Per-user token buckets:
  - laps: e.g. 120/hour, 500/day, a daily byte quota by tier
  - logs: lines per day
- Async gunzip.

Effort: M.

**F-14: The pg Pool has no `error` listener** [INFRA-1] (Reliability, High, CONFIRMED ✔)

Evidence: `src/lib/db.ts:22-27`; `bot/db.js:17`.

Impact: a Postgres maintenance window or failover kills idle clients, the Pool emits an unhandled `error`, and the Node process exits. This affects both the web app and the bot.

Remediation: `pool.on('error', …)` in both. Add `statement_timeout` and `idle_in_transaction_session_timeout` in the pool's `options`.

Effort: XS.

**F-15: Schema migration at boot: one transaction, about 200 statements, ACCESS EXCLUSIVE locks** [INFRA-2, REL-10] (Reliability, High, CONFIRMED)

Evidence:
- `ensureUserSchema` (`src/lib/users.ts:121-979`) runs on the first request.
- `ALTER TABLE … ADD COLUMN IF NOT EXISTS` takes ACCESS EXCLUSIVE even when the column already exists. This happens about 20 times on `CollectorLaps`, and also on `Users` and `Sessions`.
- Triggers are dropped and recreated every boot.
- Full-table backfill `UPDATE`s run while those locks are held.
- It also contains destructive `DROP`s.
- No `lock_timeout`.
- On failure the next request retries the whole thing.

Impact:
- A stall on every deploy, growing with the number of lap rows.
- During a deploy overlap, the old instance's requests queue behind the new one's locks and fail at the 10 s pool timeout.
- Rollback to an older image can break.

Remediation:
- A `schema_version` row so a current schema skips everything.
- Move the migration to a Render pre-deploy command.
- `SET lock_timeout='3s'`.
- Expand/contract releases: drop columns one release later.

Effort: M.

**F-16: Signing and release pipeline gates live in GitHub settings you can't see from the repo** [COL-4] (Supply chain, High, ASSUMPTION / PLAUSIBLE)

Evidence (`.github/workflows/collector-release.yml`):
- Any `collector-v*` tag on any commit signs whatever workflow that commit contains (`:20-27`).
- Actions are pinned by tag, not SHA (`azure/login@v2`, etc.).
- `nuget install` runs without a version (`:117-120`).
- `${{ github.ref_name }}` is interpolated into PowerShell (`:60,129,204`).

Impact: a compromised token, collaborator or action tag produces malware signed as Clarivex LLC, which every installed collector then auto-installs elevated.

Remediation:
- A required reviewer on the `collector-release` environment.
- A tag ruleset so only the owner can create `collector-v*` tags.
- Scope the federated credential's subject to that environment.
- SHA-pin the actions and pin NuGet versions.
- Pass `ref_name` through `env:` and validate it.
- Build only commits reachable from `main`.

Effort: S.

**F-17: Reset and verification links fall back to the Host header** [SEC-4] (Security, High if `SITE_URL` is unset, PLAUSIBLE; production NOT VERIFIED)

Evidence: `src/lib/siteOrigin.ts:19-22` uses `x-forwarded-host`/`host` when `SITE_URL` is missing. It builds the password-reset links, privacy-verification links and Google's `redirect_uri`.

Exploit: a POST to forgot-password with `X-Forwarded-Host: evil.com` emails the victim a real token pointing at evil.com.

Remediation: confirm `SITE_URL` is set on Render, and throw in production when it's missing.

Effort: XS.

**F-18: No CI, no dependency scanning, and no tests for billing, rate limits or entitlements** [REL-1, REL-2] (Ops, High, CONFIRMED)

Evidence:
- The only workflow is `collector-release.yml`. No Dependabot.
- Render deploys main without any check.
- No tests cover `stripe-webhook`, `aiRateLimit`, `abuseGuards`, `canUseInCarCoach`/`notForBronze`, `collectorKeys` or `tvAuth`.

Remediation:
- A PR/push workflow: `npm ci`, lint, `tsc`, the DB-less tests, `next build`, and a Postgres service job for the `*-db` tests.
- Dependabot for npm, pip, NuGet and Actions.
- Render "deploy after CI passes".
- A route-guard table test: every AI route × visitor/Bronze/Silver/AI-off → the expected 401/403.

Effort: M.

**F-19: Connection budget and no statement timeout** [INFRA-3] (Reliability, High, CONFIRMED arithmetic; plan NOT VERIFIED)

Evidence: the web pool is 25 (`db.ts:25`), plus MCP 3, plus the bot 10. A deploy overlap uses 66. Two autoscaled instances in overlap use about 122, which is more than a 100-connection plan allows. No `statement_timeout` anywhere.

Remediation: take the pool size from an env var. Add `statement_timeout` (e.g. 15 s for requests) and `idle_in_transaction_session_timeout`. Keep one instance until F-29 is fixed.

Effort: XS–S.

**F-20: Collector log retention and stored radio transcripts contradict the Privacy Policy** [PRIV-2, PRIV-3] (Legal, High, CONFIRMED)

Evidence:
- The collector logs radio transcripts, Race Engineer replies and watchers' messages, with names (`DriverRadio.cs:261-266`, `LiveRacing.cs:507,512`).
- `LogUploader` stores them in `CollectorLogs` for 90 days, sends them to the AI and may email them.
- The policy says radio text is memory-only for 5 minutes (`legal.ts:88`).
- Old log lines are pruned only when that same user uploads again (`collectorLogs.ts:47-50`), so inactive users' logs stay forever.

Remediation:
- Log "radio sent (n characters)" instead of the text.
- A collector release.
- Purge the existing rows.
- A global 90-day purge in the hourly sweep.

Effort: S.

### Medium

| ID | Finding | Evidence | Remediation | Effort |
|---|---|---|---|---|
| F-21 | **Undisclosed or understated processors** [PRIV-4, PRIV-5]: Cloudflare R2 holds identifiable lap telemetry, but the policy says "exports and site media" (`legal.ts:159`); the R2 region is `auto`; `langsmith` is a dependency, and if `LANGSMITH_TRACING`/`LANGCHAIN_TRACING_V2` is set, prompts go to LangSmith, which isn't disclosed | `personalDataInventory.ts:97`, `package.json:45` | Update the policy; pin an R2 jurisdiction; confirm there's no tracing env and force it off in production | XS–S |
| F-22 | **Billing edge cases** [BILL-2, BILL-4, BILL-5]: two checkout tabs create two subscriptions, one orphaned and still charging; refunds, disputes and Dashboard price changes don't change access; a complimentary level on a Canceled account is reverted immediately | `create-checkout-session/route.ts:38,72`; `stripe-webhook/route.ts:70-148`; `users.ts:1165` | Reuse one customer per user and expire their open sessions; in `checkout.session.completed`, cancel a second active subscription; handle `charge.dispute.created`; map price to level on `customer.subscription.updated`; a `comp_until` column | S–M |
| F-23 | **Promo codes shared with TalkNinja** [BILL-9]: `allow_promotion_codes: true` on a shared Stripe account, so any TalkNinja code works at RacingCoach checkout unless its coupon is restricted to products. `STRIPE_INTEGRATION_TODO.md` is stale, so the live webhook may be missing events | `create-checkout-session/route.ts:67` | Audit every coupon (`applies_to`, `max_redemptions`, duration); verify the live endpoint's event list and the restricted key's scopes | XS (config) |
| F-24 | **No security headers** [SEC-5]: no CSP, HSTS, frame-ancestors or Referrer-Policy, so the Account and Admin pages can be framed (clickjacking) | `next.config.js` | `headers()` with CSP (`frame-ancestors 'none'`), HSTS, Referrer-Policy, nosniff | S–M |
| F-25 | **In-Car coach plan has weight 0, so it's unlimited** [FIN-6]; In-Car callouts measure 30 laps before the rate-limit gate [FIN-11] | `rateLimitConfig.ts:171`, `rateLimits.ts:193`, `collector/in-car-coach/route.ts:114-119` | Weight 1, or count cache misses only; move the gate before `measureCollectorSession` | XS |
| F-26 | **Refunds after tokens are spent** [FIN-8]: debrief, announcer and RAG refund on any error, including after the model answered | `debrief-coach/route.ts:60`, `announcerCommentary.ts:226`, `ragRoute.ts:173,179` | Refund only when no tokens were recorded; cap refunds per day | S |
| F-27 | **Live update spoofing** [COL-9]: a client can claim any `subSessionId` and free-text driver names, which affects other TVs' leaderboards, the shared Director runtime and announcer prompts. React escapes text, so no XSS | `liveRacing.ts:79-88,192`, `videoDirectorRuntime.ts:571` | Key shared runtimes by (driver, subsession); sanitize names; ~4 posts/s per key | M |
| F-28 | **Self-updater trust** [COL-5]: the publisher check is O= only and revocation checking is off; the installer is verified, then run from `%TEMP%` later without re-checking (TOCTOU); GitHub's SHA-256 digest is ignored | `Authenticode.cs:21-29,84,89`, `SelfUpdater.cs:98-129` | Pin the issuer and full subject; check the digest; verify again immediately before `Process.Start`, or hold the file locked | S–M |
| F-29 | **Single-instance in-memory state** [INFRA-4, REL-12]: live positions, messages, the Director, abuse guards, TV pairing limits and the key cache are all in memory, so autoscaling breaks Live Racing and multiplies limits; a deploy wipes them | `liveRacing.ts:308-310`, `abuseGuards.ts:32`, `tvAuth.ts:220` | Now: pin 1 instance with autoscale off (commit a `render.yaml`). Later: Valkey for live state and counters | XS now / L later |
| F-30 | **Polling cost**: `/api/live` is about 4 queries per viewer per second (session, a lapse UPDATE, user, `watchableDrivers`); TV SSE runs `readTvState` every second per TV | `api/live/route.ts:11-18`, `users.ts:1241`, `liveRacing.ts:653` | Cache session→user for 5–10 s; run the lapse UPDATE only when the end date has passed; cache `watchableDrivers` for 10–30 s | S |
| F-31 | **Index-defeating lap visibility filter and unbounded tables**: the `OR u.role='Coach'` filter defeats `(user_id, recorded_at)`; `ActivityLog` is never deleted; `AiUsage` is kept 400 days | `collectorLaps.ts:239-240,439-444`, `activityRetention.ts:34` | `user_id = ANY($ids)`; a `(user_id, completed_at)` index; delete `ActivityLog` rows after 13 months | S–M |
| F-32 | **CPU-heavy synchronous work**: `gunzipSync` and parsing of 30 laps per request; Racecar Analysis spawns Python, rebuilds Chroma and re-embeds everything on every question (embeddings not metered), with no concurrency cap; ffmpeg runs on the web host | `collectorLaps.ts:400`, `racecar_analysis_rag.py:191-212`, `ragRoute.ts:48-55` | Async zlib with an LRU of parsed laps; persist embeddings; a Python semaphore of 2; cap `query` at 1,000 characters; `BROADCAST_VIDEO_TRANSCODE=off` | M |
| F-33 | **No error monitoring, spend alerts or uptime checks** [REL-9] | no Sentry or OTel; `/api/health/db` is `SELECT 1` | Sentry; an hourly AiUsage cost check that emails the owner; Render health path; an external uptime monitor | S |
| F-34 | **No Stripe billing portal**: users can't update a card or get invoices, so failed renewals become involuntary churn [UX-2]. Cancellation is immediate with no undo [UX-3] | `account/page.tsx`, `cancel-subscription/route.ts:48-53` | A billing portal session limited to payment methods and invoices; consider `cancel_at_period_end` with a Resume button | M |
| F-35 | **No 404, error or global-error pages** [UX-1]: Next's English defaults, without the nav | `src/app` | Add localized `not-found.tsx`, `error.tsx` and `global-error.tsx` | S |
| F-36 | **User enumeration** [SEC-8, UX-10]: forgot-password answers 404 `emailNotFound` | `forgot-password/route.ts:38-41` | Always answer success | XS |
| F-37 | **Unauthenticated writes with no limit** [SEC-7]: `/api/activity` (64 KB per event) and `/api/consent` | `activity/route.ts:9,25` | Per-IP `ABUSE_LIMITS`, after F-10 | XS |
| F-38 | **Dockerfile**: Node 20 (end of life), runs as root, ships dead scripts (`app.py`, `GetBankFromRoutingNumber.py`, `SampleDealGPT.py`, `intro_transformer.py`, `prompts.py`); Python gets the full `process.env`, including Stripe and DB secrets [REL-11, SEC-10] | `Dockerfile:1-43`, `ragRoute.ts:52` | `node:22-slim`/`24-slim` pinned by digest; `USER node`; remove the dead scripts; pass Python only the env it needs | S |
| F-39 | **Background jobs**: the video worker claims nothing in the database (duplicate transcodes with 2 instances); no SIGTERM drain; abandoned `uploading` video rows are never swept; the announcer `listeners` map is never evicted | `videoProcessing.ts:168-181`, `announcerCommentary.ts:43` | `UPDATE … SKIP LOCKED` claim; sweep stuck uploads; R2 lifecycle rules (telemetry/ 100 d, privacy-exports/ 4 d, abort multipart after 1 d) | S |
| F-40 | **Collector version can't be enforced** [COL-11]: no version header and no minimum version | `RacingCoachApi.cs:94-108` | An `X-Collector-Version` header; `/api/collector/me` answers 426 below a minimum version | S |
| F-41 | **Collector retry behaviour** [COL-14]: exponential backoff but no jitter, and `Retry-After` is ignored, so retries synchronize after an outage | `LapUploader.cs:18-19,85-91` | Add jitter; honour 429 `Retry-After` | XS |

### Low

| ID | Finding | Evidence / fix |
|---|---|---|
| F-42 | The recorded-stint limit (8/20/50) is UI-only; the route returns up to 1,000 laps [BILL-6] | `collector/laps/route.ts:44`. Apply `recordedStintLimit` in `listCollectorLaps` |
| F-43 | Upload key revocation is cached for 60 s; `--site http://` sends the key in cleartext; creating a key needs no step-up sign-in [COL-7] | `collectorKeys.ts:74-92`, `Program.cs:205`. Require https unless loopback; evict the cache on revoke |
| F-44 | The collector deletes **every** `.ibt` file over 90 days old in `Documents\iRacing\telemetry`, including ones the user recorded for MoTeC or Garage 61 [COL-10] | `IbtEnricher.cs:43-66`. Delete only files the collector started itself, or make it opt-in |
| F-45 | scrypt runs at its default cost (N=16384) [SEC-11] | `users.ts:1006`. N=2^17, with the parameters stored in the hash and a re-hash on login |
| F-46 | Login CSRF is possible (SameSite=Lax, no Origin check, any content type) [SEC-12] | Shared Origin check on unsafe methods; require `application/json` |
| F-47 | Password reset isn't atomic [SEC-13] | `passwordReset.ts:40-45`. `DELETE … RETURNING` first |
| F-48 | ffmpeg runs without `-protocol_whitelist` [SEC-14] | `videoProcessing.ts:69` |
| F-49 | Python stderr is returned to the client [SEC-15] | `ragRoute.ts:181-184` |
| F-50 | Success page: no ownership check, and it can say "active" before the webhook arrives [BILL-8, UX-7] | `success/page.tsx:12-39`. Check `client_reference_id`; sync the subscription before rendering |
| F-51 | UX: raw JSON shown on checkout errors; 35 bare `await res.json()` calls; Listen buttons don't report a 429; English-only route errors and reset emails; signup lands on `/`, not onboarding; pricing requires login; dialogs don't trap focus; committed `.bak` files [UX-5,6,8,9,11,14,15,17] | See the UX agent's notes. All S |
| F-52 | Unsalted SHA-256 upload-key hash (fine at 256-bit entropy); `McpAuditLog` missing from the privacy inventory [PRIV-9]; `liveRacing.playRadio` missing from the cookie inventory [PRIV-7]; `Sessions` and `PasswordResets` are never purged [PRIV-8] | Housekeeping |
| F-53 | Bronze watchers get ElevenLabs Driver Radio playback (live limit only, no AI switch) | `live/radio-speech/route.ts`. Gate on `canUseVoiceAi`, or use Chirp for Bronze |

### Found after the audit

| ID | Finding | Evidence | Remediation | Effort |
|---|---|---|---|---|
| F-54 | **Production Postgres accepts connections from any IP address** (High, CONFIRMED): only the password protects it | Render: `ipAllowList` is `0.0.0.0/0` ("everywhere") on `clarivex-postgres-instance-db` | Render dashboard → the database → Networking: remove 0.0.0.0/0 so only Render's private network (and your own IP, if you connect from your Mac) can reach it | XS |

### Checked and found sound (no finding)

- Every AGENTS.md-stated role or tier restriction is enforced on the server: Racecar Analysis, In-Car Coach, voice AI, the Race and Setup Engineers, announcers, Hold to Talk, admin, coach and subscribers.
- No mass assignment: users can't set their own `role` or `membership_level`.
- IDOR checks:
  - laps: `visibleTo` in SQL
  - live outline and radio
  - TV devices
  - privacy exports
  - voice messages
  - expert laps
- SQL is parameterized; dynamic `ORDER BY` uses an allowlist.
- No `dangerouslySetInnerHTML`.
- Webhook signature checked on the raw body; event claim and release; per-subscription advisory lock. `metadata.user_id` is set by the server.
- AI rate-limit check is atomic (advisory lock) and runs before the call. The AI buttons disable while a request runs.
- MCP endpoint: RS256 only, iss, aud, exp and nbf checked, a subject allowlist, scopes, and it fails closed.
- Map tile z/x/y are validated as integers. Lap gzip output is capped at 25 MB.
- No secrets in the repo and no tracked `.env` files.
- Collector: no listening ports; runs asInvoker; DPAPI CurrentUser for the key; downgrade blocked; signatures verified before publishing; the installer's silent install requires `/ACCEPTTERMS`.
- Cookie consent gating; account deletion cascades; R2 cleanup via triggers.
- All four dictionaries are complete (3003/3003 keys).

---

## C. Financial exposure report

**Price assumptions:**
- gpt-4o-mini $0.15 / $0.60 per M tokens; gpt-4o $2.50 / $10 (`src/lib/aiModelPrices.ts`)
- ElevenLabs about $0.20 per 1k characters
- Google Chirp 3 HD $30 per M characters
- Esri about $0.15 per 1k tiles
- transcription $0.003 per minute

The defaults come from `src/lib/aiModelList.ts`. Bronze Debrief runs on gpt-4o-mini.

| Feature | Cost provider | Anonymous | Bronze | Existing limit | Potential exposure | Recommended protection |
|---|---|---|---|---|---|---|
| Collector log review | OpenAI gpt-4o | No | **Yes, unmetered** | None (site call, weight 0) | **Unbounded**, about $26k/day per attacker | Per-user and global caps; gpt-4o-mini; prompt cap (F-01) |
| Map tiles | Esri | No | **Yes, unmetered** | None | **Unbounded**, about $650/day | Bounding box; per-user cap; cache (F-06) |
| Collector speech (TTS) | ElevenLabs / Chirp | No | Yes | Live limit 30 calls/day, 500 characters | $90/month per Bronze account; $200/day per Gold | Character budget; Chirp for Bronze (F-09) |
| Debrief Coach | OpenAI | 401 | Yes | Weight 3, Bronze 10 weighted/day | Gold about 66/day × $1–2 | `maxTokens`, retries, recursion, $ budget (F-07) |
| Lap, multi-lap and stint summaries | OpenAI mini | 401 | Yes | Weight 1 | Low | Input length caps |
| Racecar Analysis | OpenAI + embeddings + Python | 401 | 403 | Weight 1 | Uncounted embeddings; CPU/RAM | Persist embeddings; semaphore (F-32) |
| In-Car plan | OpenAI mini | No | 403 | **Weight 0** | About $700/day if a Silver user loops cache misses | Weight 1 (F-25) |
| In-Car callouts, Race and Setup Engineer | OpenAI mini | No | 403 | Weight 1 | Low | ok |
| Live and TV announcer | OpenAI mini + ElevenLabs | 401 | 403 | Live limit, per line | Gold about $60/day | Character budget |
| Radio playback to watchers | ElevenLabs | 401 | Yes | Live limit | Low–Medium | Gate or Chirp (F-53) |
| Voice samples | TTS | 401 | Yes / 403 | Live limit; fixed text | Low | ok |
| Radio and voice-message transcription | OpenAI transcribe | No | 403 | Live limit | Low | Streaming size cap (F-13) |
| Broadcast Director lines | OpenAI + TTS | No | No | None (site) | Bounded by the clip schedule | Include in the global budget |
| Lap and log uploads | R2 / Postgres / CPU | No | Yes | Size only | Storage growth; CPU DoS | Quotas, body cap (F-13) |
| Emails (support, reset) | Resend | Yes | Yes | Per-IP and per-address (IP spoofable) | Low; reputation risk | Fix F-10 |
| Render CPU / RAM | Render | Yes (body DoS) | Yes | None | Outage rather than a bill (single instance) | F-13, F-32 |

### Monthly cost estimates

The mix is 70% Bronze, 20% Silver and 10% Gold. "Abusive" means 5% of users maxing their limits as they stand today.

| Active users | Normal | Heavy | Abusive within today's limits | Plus one F-01 / F-06 attacker |
|---|---|---|---|---|
| 10 | ~$18 | ~$115 | ~$700 | +$20k to $800k (unbounded) |
| 100 | ~$180 | ~$1.1k | ~$7k | same |
| 500 | ~$900 | ~$5.7k | ~$35k | same |
| 1,000 | ~$1.8k | ~$11k | ~$70k | same |
| 5,000 | ~$9k | ~$57k | ~$350k | same |

**Per user per month:**

| Tier | Normal | Heavy | At today's caps |
|---|---|---|---|
| Bronze | $0.30 | $2 | ~$105 |
| Silver | $3 | $20 | ~$1,700 |
| Gold | $10 | $60 | ~$9,900 |

The Silver and Gold caps are far above their subscription prices. That is the case for dollar and character budgets, not just call counts.

After F-01, F-06, F-07 and F-09 are fixed, the abusive column falls to about 3× the heavy column, and no single account can exceed its tier's daily dollar cap.

**Unbounded today:** the log review, map tiles, and anything else if the limiter fails open (F-12) or if rate limiting is switched off in Admin. **Poorly bounded:** speech characters, the In-Car plan, Debrief retries and recursion, and Racecar Analysis embeddings.

---

## D. Subscription protection matrix

Key:
- ✓ allowed
- ✗ refused, with the status shown
- "rl" means rate limited

| Feature | Anonymous | Bronze | Silver | Gold | Server enforcement | Issue |
|---|---|---|---|---|---|---|
| Debrief Coach | ✗ 401 | ✓ rl | ✓ | ✓ | `debrief-coach/route.ts:41` | Not covered by the AI switch (F-08) |
| Lap, multi-lap and stint summaries | ✗ 401 | ✓ rl | ✓ | ✓ | the routes' `aiRateLimit` | AI switch |
| Racecar Analysis | ✗ 401 | ✗ 403 | ✓ | ✓ | `ragRoute.ts:139` | ok |
| In-Car AI Coach (plan and callouts) | ✗ | ✗ 403 | ✓ | ✓ | `collector/in-car-coach/route.ts:62,104` | Plan weight 0 (F-25) |
| In-Car Coach Instructions | ✗ | ✗ 403 | ✓ | ✓ | `account/in-car-coach-instructions:21` | ok |
| Race Announcers (Live and TV) | ✗ | ✗ 403 | ✓ | ✓ | `live/announcer:37`, `tv/announcer:37` | No character budget |
| Announcer sample | ✗ | ✗ 403 | ✓ | ✓ | `race-announcers/sample:22` | AI switch |
| Hold to Talk | ✗ | ✗ 403 | ✓ | ✓ | `live/voice-message:29` | Body read before the cap |
| Driver Radio transcription, Race and Setup Engineer | ✗ | ✗ 403 | ✓ | ✓ | `collector/radio:48,85` | Body read before the cap |
| Driver Radio playback (watcher) | ✗ | ✓ live rl | ✓ | ✓ | `live/radio-speech:40` | No tier gate (F-53) |
| Collector speech (TTS) | ✗ | ✓ live rl | ✓ | ✓ | `collector/speech:33` | No character budget, ElevenLabs default (F-09) |
| Coach voice sample | ✗ | ✓ rl | ✓ | ✓ | `coach-voice/sample:26` | AI switch |
| Collector log review | ✗ | **✓ unmetered** | ✓ | ✓ | none | **F-01** |
| Map tiles | ✗ | **✓ unmetered** | ✓ | ✓ | auth only | **F-06** |
| Recorded stints 8 / 20 / 50 | ✗ | 8 (UI only) | 20 (UI) | 50 (UI) | none | F-42 |
| Lap retention 30 / 60 / 90 days | — | 30 | 60 | 90 | DB trigger and filters | Dry run (F-04); renewal bug (F-02) |
| My Race Trends, bot `/coach results` | ✗ | ✗ 404/403 | Admin only | Admin only | `isAdmin` | ok |

**Freshness:** the tier is read on every request: `getUserById` for sessions, TV and collector routes. The key cache holds only the key→user mapping. No stale-tier path was found, apart from the downgrade bug F-02.

### Recommended quotas

These replace the current call-only limits. Each tier gets a call limit plus a dollar budget computed from recorded tokens.

| | Anonymous | Bronze | Silver | Gold | Global |
|---|---|---|---|---|---|
| Weighted AI calls/day | 0 | 10 (burst 3/min) | 50 | 150 | — |
| Debriefs/day | 0 | 2 | 8 | 20 | — |
| AI $ budget | 0 | $0.25/day, $3/month | $1.50/day | $4/day | Daily ceiling (≈2× expected); auto-disable and email |
| Live broadcast calls/day | 0 | 30 | 400 | 1,200 | — |
| Speech characters/day | 0 | 3k (Chirp only) | 60k | 200k | ElevenLabs monthly ceiling, then Chirp |
| Map tiles/day | 0 | 1,000 | 3,000 | 5,000 | Monthly Esri ceiling |
| Lap uploads/day | — | 200 | 500 | 500 | — |
| Log review | — | none (or 1/day) | 3/day | 3/day | 100/day |
| In-Car plan (cache misses) | — | — | 20/hour | 20/hour | — |

**Abuse posture:** require email verification before any metered feature (F-05). Use the real client IP plus Turnstile (F-10). One upload key per account is already the case.

### Centralized entitlement architecture

From BILL's design, sized to the existing code:

1. **`src/lib/entitlements.ts`** (pure, like `roles.ts`): one table mapping feature → minimum level, exempt roles, `aiFeature` keys and per-tier quotas. `canUseInCarCoach`, `canUseVoiceAi`, `notForBronze`, `recordedStintLimit` and the bot's `needsUpgrade` become wrappers over it.
2. **`requireEntitlement(user, key)`** is called first inside `aiRateLimit`, together with the global metered kill switch (F-08). A source-guard test, like the cookie-consent one, fails any route that calls `chatModel`, `synthesizeSpeech` or `transcribeRadio` without going through it.
3. **`effectiveLevel(user, now)`** in one place, covering the Stripe projection, complimentary until-dates and grace periods. It is shared by the lapse SQL, `bot/db.js` and the retention trigger, as a SQL view.
4. **The Users billing columns become a projection** written by `syncSubscription` (fixes F-02 and F-22).

---

## E. Remediation roadmap

### P0: must fix before launch

About 6–8 engineer-days, plus configuration.

| # | Item | Findings | Effort | Depends on | Risk reduction |
|---|---|---|---|---|---|
| 1 | Upgrade Next.js and zod; redeploy | F-03 | S | — | Removes RCE |
| 2 | Cap and meter the log review; gpt-4o-mini; prompt cap | F-01 | S | — | Removes the largest unbounded cost |
| 3 | Map tiles: bounding box, per-user cap, cache | F-06 | S–M | — | Removes unbounded Esri cost |
| 4 | Stripe projection in `syncSubscription`; restore the level on renewal; grace period; repair any accounts already affected | F-02, BILL-3 | M | — | Stops paid-member downgrades and lap loss |
| 5 | Set `LAP_RETENTION_MODE=delete` and verify a run; confirm `SITE_URL` and `TELEMETRY_STORAGE_MODE=r2`; confirm no LangSmith tracing env | F-04, F-17, F-21 | XS | — | Policy compliance; closes reset-link poisoning |
| 6 | `chatModel`: `maxRetries`, `timeout`, `maxTokens`; abort signals; recursion cap | F-07 | S | — | Bounds per-call cost |
| 7 | Global metered kill switch inside `aiRateLimit`, `siteAiCall`, TTS, STT and tiles | F-08 | S | — | A real emergency stop |
| 8 | Fail closed for expensive features; weight the In-Car plan; refund only token-free failures | F-12, F-25, F-26 | S | 7 | Closes limiter bypasses |
| 9 | Speech character budget per tier; Chirp for Bronze | F-09, F-53 | S | — | Bounds TTS |
| 10 | Correct client IP; email verification before metered features, Google linking and upload keys; owner privileges by DB role, not email | F-05, F-10 | M | — | Stops multi-account and takeover |
| 11 | `pool.on('error')`; `statement_timeout`; pin one instance | F-14, F-19, F-29 | XS | — | Prevents a crash on a DB blip |
| 12 | Body-size helper; per-user lap and log upload quotas | F-13 | S–M | — | Prevents OOM DoS and storage floods |
| 13 | Shared Track Data writes restricted, or by consensus; Admin reset | F-11 | M | — | Integrity of shared data |
| 14 | GitHub: environment reviewer, tag ruleset, SHA pins | F-16 | XS (settings) + S | — | Signing supply chain |
| 15 | Stop logging radio text; global CollectorLogs purge | F-20 | S + collector release | — | Policy compliance |
| 16 | Provider-side hard caps: OpenAI project budget, ElevenLabs quota, GCP budget and TTS quota, Esri credit cap | — | XS (consoles) | — | Last-resort backstop |
| 17 | Audit Stripe coupons and webhook events and key scopes | F-23 | XS | — | Discount abuse |

### P1: strongly recommended before launch

| Item | Findings | Effort |
|---|---|---|
| CI workflow, Dependabot, route-guard table test, webhook fixture tests | F-18 | M |
| Schema version gate, pre-deploy migration, `lock_timeout` | F-15 | M |
| Security headers (CSP, HSTS, frame-ancestors) | F-24 | S–M |
| Error monitoring (Sentry), hourly spend alert, health path, uptime monitor | F-33 | S |
| Stripe billing portal (payment method, invoices); duplicate checkout guard; dispute and refund handling | F-34, F-22 | M |
| 404, error and global-error pages; neutral forgot-password; activity and consent limits | F-35, F-36, F-37 | S |
| Dockerfile: Node 22/24, non-root, remove dead scripts, minimal Python env | F-38 | S |
| Privacy Policy updates (Cloudflare telemetry, R2 region, postal address); age attestation | F-21, Section 9 | S |
| Self-updater: digest check, re-verify before launch, pin the issuer | F-28 | S–M |

### P2: first 30 days after launch

- Cache `/api/live` sessions and `watchableDrivers` (F-30).
- Rewrite the lap visibility query and add indexes (F-31).
- Async gunzip, an LRU of parsed laps, persisted RAG embeddings and a Python semaphore (F-32).
- Live-update spoofing hardening (F-27).
- A collector minimum version (F-40) and jitter (F-41).
- Video worker claims, R2 lifecycle rules and an abandoned-upload sweep (F-39).
- `.ibt` deletion scope (F-44).
- The Low items F-42 to F-52.
- A backup restore drill.

### P3: longer term

- Move live state, pub/sub and abuse counters to Render Key Value, and allow more than one instance (F-29).
- SSE fan-out instead of per-viewer polling.
- Move background jobs, ffmpeg and RAG to a background worker service.
- PgBouncer.
- The full `entitlements.ts` refactor.
- Per-feature cost dashboards.

---

## F. Recommended code changes (sketches, not applied)

### 1. `src/lib/aiModels.ts`: bounded models (F-07)

```ts
const LIMITS: Partial<Record<AiFeature, { maxTokens: number; timeoutMs: number; retries: number }>> = {
  raceAnnouncer: { maxTokens: 300, timeoutMs: 8_000, retries: 0 },
  raceEngineer:  { maxTokens: 400, timeoutMs: 20_000, retries: 0 },
  debriefCoach:  { maxTokens: 2_000, timeoutMs: 60_000, retries: 1 },
  collectorLogReview: { maxTokens: 500, timeoutMs: 30_000, retries: 0 },
};
// in chatModel(): new ChatOpenAI({ model, maxTokens, timeout: timeoutMs, maxRetries: retries, ... })
```

- Regression test: a stub `baseURL` that returns 503 receives exactly 1 + retries attempts.

### 2. `src/lib/rateLimits.ts`: real IP, kill switch, fail closed, budget (F-08, F-10, F-12)

```ts
export function clientIp(req: Request) {
  const hops = req.headers.get('x-forwarded-for')?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
  return hops.at(-TRUSTED_PROXY_HOPS) ?? req.headers.get('x-real-ip') ?? null; // TRUSTED_PROXY_HOPS from env, default 1
}
// aiRateLimit(): first `if (await meteredKillSwitchOn(feature)) return refuse('aiFeaturesDisabled')`
// catch-block: `if (FAIL_CLOSED.has(feature)) return refuse('limiterUnavailable', 503)`
// budget: SUM(cost) from AiUsage today (tokens × aiModelPrices) >= tierBudget → refuse('budget')
// siteAiCall(): same kill switch + global daily cap per site feature
```

- Tests: a spoofed XFF is counted against the real hop; the kill switch blocks every `RATE_LIMITED_FEATURES` entry; a database error on `debriefCoach` returns 503.

### 3. `src/lib/collectorLogReview.ts`: caps (F-01)

```ts
// before scheduling: SELECT count(*) FROM "CollectorLogReviews" WHERE user_id=$1 AND reviewed_at > now()-interval '1 day'  -> >= 3 → skip
// plus in-memory per-user 10-min cooldown and global daily counter; message.slice(0, 500); prompt ≤ 20_000 chars
```

- Migration: none (an index on `CollectorLogReviews(user_id, reviewed_at)` if it's missing).

### 4. `src/lib/stripeBilling.ts` `syncSubscription`: projection (F-02)

```ts
// after saving the subscription row, under the same advisory lock:
const level = planForProduct(sub.items.data[0].price.product)?.level;
const end = new Date(sub.items.data[0].current_period_end * 1000);
const status = sub.status === 'canceled' ? 'Canceled'
             : ['active','trialing','past_due'].includes(sub.status) ? 'Subscribed' : 'Expired';
UPDATE "Users" SET account_status=$status, membership_level=CASE WHEN $status='Expired' THEN 'Bronze' ELSE $level END,
       subscription_end_date=GREATEST(subscription_end_date, $end) WHERE stripe_subscription_id=$id
// END_LAPSED_MEMBERSHIPS_SQL: subscription_end_date < now() - interval '72 hours'
```

- Data repair: find accounts that are `Subscribed` with a Bronze level and an active Stripe subscription. Restore their level and re-stamp `expires_at` on laps not yet deleted. (Laps already past `expires_at` were only hidden, because retention is a dry run, so they can be recovered.)
- Tests: Stripe event fixtures for renewal after the period ends, `invoice.paid` after `deleted`, and duplicate events.

### 5. Shared `src/lib/requestBody.ts` (F-13)

```ts
export async function readBodyLimited(req: Request, max: number): Promise<Uint8Array> {
  const len = Number(req.headers.get('content-length') ?? NaN);
  if (len > max) throw new PayloadTooLarge();
  const reader = req.body!.getReader(); let total = 0; const parts: Uint8Array[] = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break;
    total += value.byteLength; if (total > max) { reader.cancel(); throw new PayloadTooLarge(); } parts.push(value); }
  return Buffer.concat(parts);
}
```

- Use it in laps, radio, voice-message, picture, target-lap, expert-laps and every public JSON route (with about a 16 KB cap).
- Upload quotas: a token bucket per key, counted in a small `"CollectorUploadCounters"` table or in memory (one instance).

### 6. `src/lib/db.ts` (F-14, F-19)

```ts
pool = new Pool({ connectionString, max: Number(process.env.PG_POOL_MAX ?? 20), connectionTimeoutMillis: 10_000,
  options: `-c search_path=${DB_SCHEMA} -c statement_timeout=15000 -c idle_in_transaction_session_timeout=30000` });
pool.on('error', (e) => console.error('pg pool error', e));
```

- Background jobs that need longer run `SET LOCAL statement_timeout` inside their own transactions.

### 7. Map tiles (F-06)

- A `trackBoxes` cache refreshed every 10 minutes from `"Tracks"` bounds.
- Reject tiles whose bounding box doesn't intersect any track (+2 km).
- Count tiles per user in memory per day (one instance).
- An LRU of 2,000 tiles × about 30 KB ≈ 60 MB, if Esri's terms allow caching.

---

## G. Launch readiness checklist

Key:
- **PASS** requires code evidence.
- **NV** = not verified (needs production or dashboard access).
- **N/A** = not applicable.

| # | Item | Status | Evidence / note |
|---|---|---|---|
| 1 | Every AI route requires authentication (no anonymous AI) | PASS | Route auth table: all AI routes need S, K, T or B; visitors get 401 (e.g. `debrief-coach/route.ts`, `aiRateLimit`) |
| 2 | Paid-tier features enforced on the server | PASS | `ragRoute.ts:139`, `collector/in-car-coach:62,104`, `live/announcer:37`, `collector/radio:48` |
| 3 | No client-controlled tier or role | PASS | `preferences`, `account/profile` and signup write fixed columns; signup forces Bronze (`users.ts:1075`) |
| 4 | AI rate limit enforced before the call and concurrency-safe | PASS | `rateLimits.ts:309` (advisory lock), called before the model in each route |
| 5 | Every metered path goes through the limiter | **FAIL** | Log review and map tiles (F-01, F-06) |
| 6 | Spend or token budget per user and globally | **FAIL** | F-07 |
| 7 | Max output tokens, retries and timeouts on model calls | **FAIL** | `aiModels.ts:160-181` |
| 8 | Max agent iterations | PASS (high) | `recursionLimit: 40` (`debriefCoach.ts:1146`); recommend about 15 |
| 9 | Emergency kill switch covers all metered features | **FAIL** | F-08 |
| 10 | Limiter fails safe | **FAIL** | `rateLimits.ts:319` |
| 11 | Per-IP limits use an unspoofable IP | **FAIL** | `rateLimits.ts:75` |
| 12 | Email verification | **FAIL** | F-05 |
| 13 | Upload body-size caps before buffering | **FAIL** | F-13 |
| 14 | Upload frequency or storage quotas | **FAIL** | F-13 |
| 15 | Gzip bomb protection | PASS | `collectorLaps.ts:121` (25 MB maximum output) |
| 16 | IDOR protection on lap, live, TV and export IDs | PASS | `collectorLaps.ts:239-243`, `liveRacing.ts:609,888`, `personalDataExport.ts:434` |
| 17 | SQL injection | PASS | Parameterized; allowlisted `ORDER BY` (`subscriberReport.ts:209-217`) |
| 18 | XSS | PASS | No `dangerouslySetInnerHTML` or `innerHTML` in `src` |
| 19 | CSRF | Partial / FAIL | SameSite=Lax (`session.ts:28-34`); no Origin check; login CSRF possible (F-46) |
| 20 | Security headers | **FAIL** | F-24 |
| 21 | Dependencies free of critical CVEs | **FAIL** | Next 16.3.8 (F-03) |
| 22 | Secrets not in the repo | PASS | Regex sweep clean; no tracked `.env` |
| 23 | Stripe webhook signature and idempotency | PASS | `stripe-webhook/route.ts:44-48`; `stripeBilling.ts:491-513` |
| 24 | Renewals keep paid access | **FAIL** | F-02 |
| 25 | Expired or canceled lose access at period end | PASS (logic) / see 24 | `END_LAPSED_MEMBERSHIPS_SQL` runs per `getUserById` and hourly |
| 26 | Disputes and refunds revoke access | **FAIL** | F-22 |
| 27 | Promo codes restricted | NV | Stripe Dashboard (F-23) |
| 28 | Webhook endpoint subscribed to all required events | NV | Stripe Dashboard |
| 29 | R2 objects private, keys built by the server | PASS | `telemetryStorageRules.ts`; no presigned URLs for laps |
| 30 | R2 lifecycle rules | NV | Cloudflare dashboard |
| 31 | `TELEMETRY_STORAGE_MODE=r2` in production | NV | Render env |
| 32 | Lap retention deletes on schedule | **FAIL / NV** | Dry run unless `LAP_RETENTION_MODE=delete` (F-04) |
| 33 | Account deletion cascades, R2 included | PASS | `REFERENCES "Users" ON DELETE CASCADE` / `SET NULL`; trigger queue `telemetryStorageSchema.ts:72` |
| 34 | Data export | PASS | `personalDataExport.ts` (27 tables); minor gaps F-52 |
| 35 | Cookie consent enforced | PASS | `ConsentGate`, `/api/activity` refuses without consent; 29/29 tests |
| 36 | Privacy Policy matches processing | **FAIL** | F-20, F-21 |
| 37 | Logs free of sensitive personal data | **FAIL** | Radio text in CollectorLogs (F-20) |
| 38 | Legal contact, address, representatives, age checks | NV / needs legal review | Section 9 |
| 39 | Collector signed and verified before publishing | PASS | `collector-release.yml:178-192` |
| 40 | Release pipeline protected | NV | GitHub settings (F-16) |
| 41 | Self-update verifies the signature | PASS (with gaps) | `Authenticode.cs`; F-28 |
| 42 | Upload key revocable | PASS | `collectorKeys.ts:44-49` (60 s cache, F-43) |
| 43 | Collector backoff on failures | PASS | `LapUploader.cs:18-19` (no jitter, F-41) |
| 44 | Server enforces a minimum collector version | **FAIL** | F-40 |
| 45 | DB pool resilient to connection errors | **FAIL** | F-14 |
| 46 | Migrations safe on deploy | **FAIL** | F-15 |
| 47 | CI runs tests before deploy | **FAIL** | F-18 |
| 48 | Unit tests pass | PASS | 294/294 (the agents' runs); `tsc` 0 errors; lint 0 errors |
| 49 | Database-backed tests | NV | Need the `*_TEST_DATABASE_URL` env vars |
| 50 | Error monitoring and alerting | **FAIL** | F-33 |
| 51 | Health check configured | NV | `/api/health/db` exists; the Render setting isn't visible |
| 52 | Backups and restore tested | NV | Render PG plan |
| 53 | Single instance pinned (in-memory state) | NV | No `render.yaml` |
| 54 | Branded error pages | **FAIL** | F-35 |
| 55 | Users can manage billing (card, invoices) | **FAIL** | F-34 |
| 56 | Quota-exhausted messages are clear | PASS (mostly) | `reportRateLimit` / `RateLimitDialog` on the main AI pages; gaps in Listen buttons (F-51) |
| 57 | MCP endpoint safe | PASS | `lib/mcp/auth.ts:35-61` fails closed; not counted against any quota (Admin subject only) |
| 58 | Container hardened | **FAIL** | Root user, Node 20 end of life (F-38) |

---

## Unresolved questions and missing access

1. **Render:** is `LAP_RETENTION_MODE`, `SITE_URL`, `TELEMETRY_STORAGE_MODE`, `LANGSMITH_TRACING` or `LANGCHAIN_TRACING_V2` set? What are the instance count and autoscaling, the health check path, the Postgres plan's connection limit, and PITR/backup retention? Does Render put the real client IP last in `X-Forwarded-For`?
2. **Stripe:** live webhook event list; restricted key scopes; all coupons and promotion codes on the shared account; Smart Retries settings.
3. **GitHub:** `collector-release` environment protection, tag rulesets, who has write access, and the federated credential's subject.
4. **Cloudflare:** R2 lifecycle rules, bucket jurisdiction, CORS on the video bucket.
5. **Providers:** do OpenAI, ElevenLabs, Google Cloud and Esri have hard budget caps today? Esri's terms on caching and proxying tiles.
6. **Owner emails:** are all hard-coded owner addresses registered and controlled by you?
7. **Already affected?** Check production for accounts that are Subscribed and Bronze with an active Stripe subscription (F-02). This needs a read-only query you'd approve.
8. **Legal review needed:**
   - DeepSeek transfers for EEA, UK and Brazil users.
   - An Art. 27 representative and an LGPD encarregado.
   - Processing other iRacing drivers' names and ratings (Art. 14; iRacing's terms).
   - Minimum age per region.
   - EU AI Act Art. 50 labelling of synthetic and cloned voices.
   - Keeping Stripe customer records after erasure.
   - Whether the dry-run "hiding" period is a misrepresentation exposure.

*Nothing in this audit has been changed in code, configuration or infrastructure. Fixes await your approval.*
