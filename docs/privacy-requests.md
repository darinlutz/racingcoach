# Data subject rights (GDPR Articles 12–22)

How RacingCoach.app lets people exercise their privacy rights: the pages, the request lifecycle, exports, erasure, the
Admin workflow, security, deployment and operations. The open legal and operational obligations are in
[gdpr-gap-analysis.md](gdpr-gap-analysis.md). Nothing here is legal advice, and having this feature does not make the
service GDPR compliant on its own.

## Where things are

| Piece | Files |
| --- | --- |
| Rules (statuses, transitions, deadlines, categories) | `src/lib/privacyRules.ts` (pure) |
| Personal data inventory (Article 15 information) | `src/lib/personalDataInventory.ts` (pure) |
| Schema | `src/lib/privacyDb.ts`, run by `ensureUserSchema` |
| Requests, history, verification | `src/lib/privacyRequests.ts` |
| Export (ZIP of CSV/JSON) | `src/lib/personalDataExport.ts`, `src/lib/zipWriter.ts`, `src/lib/csvExport.ts` |
| Erasure, Delete My Account, erasure ledger | `src/lib/dataErasure.ts` |
| Background worker | `src/lib/privacyJobs.ts`, started by `src/instrumentation.ts` |
| Step-up sign-in | `src/lib/reauth.ts` |
| Emails | `src/lib/privacyEmail.ts` (Resend) |
| User page | `/account/privacy` (`src/app/account/privacy/page.tsx`), linked from My Settings |
| Public form (no account) | `/privacy-request`, `/privacy-request/verify` |
| Admin | `/admin/privacy`, `/admin/privacy/[id]`, linked from the Admin page |
| Tests | `npm run test:privacy-rights` (`scripts/privacy-rights.test.mjs`, `scripts/privacy-rights-db.test.mjs`) |

## The page: My Settings > Privacy & Data Rights

| Section | What it does |
| --- | --- |
| View My Personal Data | The account summary and every inventory category with its count, purpose, legal basis, source, storage, retention, recipients, transfers and rights (Article 15(1)–(2)). Category texts are English only, like the legal documents. |
| Download My Data | A full copy (Article 15) or a portable copy (Article 20), built in the background, kept 72 hours, downloadable only by the account while signed in. Needs the step-up sign-in. |
| Correct My Information | The name is corrected at once (`PUT /api/account/profile`); language, country, units and theme in My Settings; anything else (e.g. email address) is a rectification request an Admin handles. Race results and telemetry are records of what the simulator measured and are not edited; disputes go through the same request. |
| Request Data Deletion | Chosen categories while keeping the account (Article 17). The user's own content and settings are erased by a job within minutes; the website activity log and AI usage records are also kept for security and abuse prevention, so an Admin reviews them first. Needs the step-up sign-in and a confirmation. |
| Delete My Account | The existing button, now needing the typed word `DELETE` and the step-up sign-in. Records a completed `account_deletion` request with what was kept and why. |
| Manage Cookie Preferences | This browser's analytics choice and the existing Cookie Settings dialog. |
| Manage Optional Consents | What is consent-based (only the analytics cookies; no marketing email exists) and what isn't. |
| Submit a Privacy Request | Restriction (Article 18), objection (Article 21) or any other question, for an Admin. |
| Privacy Request History | Every request with its status, deadline, outcome, retained data and the history the requester may see. |

People without an account, former users and anyone who can't sign in use `/privacy-request`: the request is recorded as
Pending Verification and a one-time link (24 hours) is emailed. The link opens a page with a Confirm button (a POST),
so email scanners that open links can't confirm it. The answer is the same whether or not an account has that address.
Unconfirmed requests are rejected after 30 days.

## Request lifecycle

Statuses: Pending Verification, Submitted, In Review, Processing, Completed, Rejected, Extended. Transitions are in
`TRANSITIONS` (`privacyRules.ts`); Completed and Rejected are final (an appeal is a new request, so the first decision's
record isn't changed). Rejecting and extending need a message to the requester (Article 12(3)–(4)); an extension is
allowed once, before the first deadline, and moves the deadline to three months after receipt.

**Deadline:** one calendar month from receipt (`dueDate`), clamped to the month's last day (Regulation 1182/71, Article
3(2)(c)). We count from receipt even while identity is being confirmed, the stricter reading; the ICO starts the clock
once identity is confirmed, the EDPB's guidance is less clear. We don't move deadlines off weekends or holidays (the
conservative choice). Both are flagged for counsel.

Every change, verification, note, communication and job outcome is a row in `"PrivacyRequestEvents"` with the actor and
the Admin's account ID (no foreign key, so the history stays whole). `visible_to_requester` marks what the requester's
history shows; internal notes and the Admin's legal justification never reach them. Closed requests are purged three
years after they close (`purge_after`).

| Request | Who acts | How |
| --- | --- | --- |
| access, portability | system | export job; completes the request when the file is ready, emails the requester |
| erasure (own content) | system | erasure job; completes the request |
| erasure (activity log, AI usage) | Admin | request waits In Review; the Admin's "Erase Approved Categories" queues the job, or the Admin completes/rejects it with a reason |
| account_deletion | system | runs at once in the DELETE request, recorded as Completed |
| rectification, restriction, objection, other | Admin | assessed and answered from `/admin/privacy/[id]`; the requester is emailed when it's completed, rejected or extended |
| any, from someone without an account | Admin | after email verification, the Admin checks it's the account holder before linking it ("Link") and acting |

## Exports

`writeExportZip` builds a ZIP on disk entry by entry (lap files one at a time), with `README.txt` (the Article 15
information from the inventory) and `manifest.json` (every file, and which categories aren't in this export and why).
Every query is `user_id = $1` (or `id = $1`); laps and Debrief Coach runs filter `expires_at > now()` like every lap read.
Never included: password and token hashes, the iRacePlan API key, and other users' email addresses (Live Racing watchers
are listed by account name only).

Portability includes only categories marked `portable` in the inventory: what the user provided or their use produced,
on contract or consent. Not: Debrief Coach analyses and collector log reviews (inferred), billing (legal obligation),
policy and consent records, AI usage (legitimate interests), privacy request records.

Storage: object storage (the Broadcast Video Library's R2 bucket, key `privacy-exports/<uuid>.zip`, no personal data in
the key) when configured, else Postgres (up to 200 MB; larger exports fail the job for an Admin to see). Downloads go
through `/api/account/privacy/exports/[id]`, which checks the session's account and the expiry and streams the file;
there is no presigned URL. The hourly sweep deletes expired files and keeps the row (`deleted_at`) as the record.

Limits: 3 exports a day and 10 open requests per account; 5 public requests an hour per IP and 3 a day per address. An
Admin can always make more from the Admin page.

## Erasure

`eraseCategory` runs the category's statements (`STATEMENTS` in `dataErasure.ts`) on one transaction, scoped to the
account. All are idempotent. Laps leave tombstones in `"ExpiredLaps"` first, so the collector's re-upload (with track
positions) is refused as `lapExpired` and the collector deletes its copy; the lap retention job purges those tombstones
as before. The activity log erasure takes the account's rows and the same browser's signed-out rows, never another
account's rows from a shared browser.

Delete My Account (`deleteAccount`) is one transaction: the request, the ledger row, `deleteUserWith` (the existing
deletion, which now also detaches the account's privacy requests and clears their contact details) and the Completed
transition. Stripe is canceled before it, as before. Export files in object storage are deleted afterwards, or a
`purgeObjects` job retries. What's kept, with reasons, is `ACCOUNT_DELETION_RETAINED`: billing records (accounting and
tax), cookie choice records (evidence of consent, 3 years), the website activity log, anonymized in the same transaction
(`src/lib/activityRetention.ts`: no account, a new random visitor ID, no IP address, browser details, referrer, label or
link; another account's rows from a shared browser are untouched), the request record, and backups.

IP addresses and browser details (user agent, viewport size, browser language) in `"ActivityLog"`, and IP addresses in
`"AiUsage"`, are cleared 13 months after each event by the hourly sweep (`purgeNetworkDetails`, in batches); the rest of
each row stays.

Not deleted by design: Stripe's own records (Stripe is a separate controller for payments; we don't delete them),
Expert Laps and broadcast media a Coach uploaded (only `uploaded_by` is unlinked), and copies AI providers keep under
their own terms.

### Backups and the erasure ledger

Render's database backups can't be edited. Every erasure writes a row to `"ErasureLedger"` (account ID, account
creation time, category, time; no other personal data), copied to object storage under `privacy-ledger/`. A restored
database has an old ledger, but the copies in object storage aren't rolled back. At every server start the worker runs
`reapplyErasures`: it brings back ledger rows only object storage has, then makes every erasure again for accounts with
the same ID **and** creation time (so an account that later reuses an ID is never touched). On a database that wasn't
restored it finds nothing to do. Coaching settings aren't re-applied (nothing says whether they changed since).

**After restoring a backup, before sending users to it:** start one instance with the restored `DATABASE_URL` and object
storage configured and wait for the log line `Erasure ledger: N entries restored, M rows erased again` (or none, if
nothing was due), or run `reapplyErasures()` from a one-off script. Without object storage configured the ledger has no
copies, and erasures made after the backup point must be re-made by hand from the requests' records.

## Background jobs

`"PrivacyJobs"`: `export`, `erasure`, `purgeObjects`. The worker (every 15 s, in each web server instance) claims jobs with
`FOR UPDATE SKIP LOCKED`, locks them 30 minutes, and retries failures after 1, 2, 4, 8… minutes (at most an hour) up to
`max_attempts` (5). A final failure marks the job failed, records `jobFailed` on the request, moves a Processing request
to In Review and emails the owner. An Admin can Retry it. A job whose server stopped mid-run is claimed again when its
lock lapses. Only error messages are logged, never data.

The hourly sweep: expired exports, unconfirmed requests (30 days), closed requests (3 years), ledger rows (3 years),
ledger copies not yet made, IP addresses and browser details past 13 months.

## Security

- Every user route works on the session's own account and takes no user ID. Every Admin route and page answers 404 to
  anyone but an Admin (`scripts/privacy-rights.test.mjs` checks the routes' source).
- Exports, erasures and Delete My Account need a step-up sign-in within 10 minutes: the password (5 tries per 15
  minutes), or for Google-only accounts a 6-digit code emailed to the account (hashed, 15 minutes, 5 tries, 3 codes per
  15 minutes). It's recorded on the sign-in session (`"Sessions".reauthenticated_at`).
- Exported CSV cells that a spreadsheet would run as formulas are defused (`csvExport.ts`).
- The audit log holds no personal data beyond what the Admin writes in notes. Emails carry only the request reference.
- The verification link's `token` is redacted from the activity log like other secret parameters.

## Deployment and migration

1. Deploy. `ensureUserSchema` creates the new tables and adds `"Sessions".reauthenticated_at` (nullable) on first use.
   Nothing existing is altered or backfilled, so it's safe to run against production and to roll back: the previous
   version ignores the new tables. `deleteUser` now also updates `"PrivacyRequests"`, which exists once the schema ran.
2. Optional but recommended: object storage (`BROADCAST_VIDEO_S3_*`) for exports and ledger copies. Without it, exports
   are kept in Postgres and backup restores need the manual step above.
3. `RESEND_API_KEY` and `RESEND_FROM_EMAIL` must be set for verification links, codes and notices. Without them, requests
   are still recorded but people without accounts can't verify, and Google-only accounts can't get a code.
4. Check `/admin/privacy` loads and the Admin page shows the Privacy Requests box.

**Behavior change to note:** Delete Account (on My Settings too) now needs the typed `DELETE` and the password, or an
emailed code for Google-only accounts. Collectors and the Discord bot are unaffected.

Rollback: redeploy the previous version. The new tables stay unused; drop them only after exporting the request records
you must keep.

## Tests

`npm run test:privacy-rights` runs the pure tests (deadlines, transitions, categories, inventory coverage of every table,
CSV safety, ZIP round-trip, route guards) and, with `PRIVACY_TEST_DATABASE_URL` pointing at a disposable local Postgres,
the database tests (export isolation and contents, portability scope, the export job and download access, expiry,
selective erasure and its isolation, lap tombstones, reviewed categories, job retry and failure, lock recovery, status
rules, email verification, Delete My Account, re-applying erasures to a restored copy, and lap retention alongside). It
refuses a database that isn't local.
