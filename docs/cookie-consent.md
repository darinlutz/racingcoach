# Cookie consent: audit, design and operations

RacingCoach.app's cookie consent system: the audit it's based on, how consent is enforced, the records it keeps, how to
run and deploy it, and what still needs legal review. The Cookie Policy (`/cookies`) is the public description; this
document is for the people maintaining the site.

Audit date: 2026-10-29, against commit `339690f` plus this change.

## 1. Audit

### How it was done

- Searched `src/` for every cookie write (`cookies().set`, `response.cookies.set`, `document.cookie`), every
  `localStorage`/`sessionStorage`/`indexedDB` use, every `<script>`, `next/script`, `<iframe>` and external URL, and every
  analytics, advertising or tag-manager SDK name.
- Read the code that sets each one, and the routes behind sign-in (password, Google, Discord), Stripe checkout, the map
  tiles and the fonts.
- Requested `https://racingcoach.app/` and `https://racingcoach.onrender.com/` and read the response headers: served by
  Render behind Cloudflare (`server: cloudflare`, `x-render-origin-server: Render`); **no `Set-Cookie`** from the
  infrastructure on a normal page load.
- The browser tests (`e2e/cookie-consent.spec.ts`) assert that no page request goes to a third-party origin.

### Findings

**Third-party technologies loaded in the browser: none.** No analytics SDK, tag manager, advertising or remarketing
pixel, social plugin, embedded video or third-party script.

- Fonts (Barlow, Barlow Condensed) use `next/font/google`, which downloads them at build time and serves them from the
  site itself. No request to Google at runtime.
- Satellite map imagery (Esri) is fetched by the server through `/api/map-tiles`; the browser never contacts Esri.
- Stripe Checkout is a redirect to `checkout.stripe.com` after the server creates the session. No Stripe.js on the
  site. Stripe's cookies are set on Stripe's domain, when the user goes there.
- Google sign-in and Discord connect are redirects (OAuth), started only by the user. Google sign-in is hidden
  (`SHOW_GOOGLE_SIGN_IN` false).
- The collector download is a link to GitHub Releases.

**First-party cookies and storage** (the inventory, `src/lib/cookieInventory.ts`):

| Name | Kind | Set by | Attributes | Duration | Category | Why |
| --- | --- | --- | --- | --- | --- | --- |
| `session` | cookie | `src/lib/session.ts` | HttpOnly, Secure (prod), SameSite=Lax | 7 days | Strictly necessary | Authentication |
| `cookie_consent` (new) | cookie | `/api/consent` | HttpOnly, Secure (prod), SameSite=Lax | 180 days | Strictly necessary | Stores the consent choice itself |
| `google_oauth_state` | cookie | `/api/auth/google` | HttpOnly, Secure, Lax, path `/api/auth/google` | 10 min | Strictly necessary | CSRF/PKCE protection of a sign-in the user started |
| `discord_oauth_state` | cookie | `/api/discord/connect` | HttpOnly, Secure, Lax, path `/api/discord` | 10 min | Strictly necessary | CSRF protection of a connection the user started |
| `language` | cookie | `/api/preferences`, signup, Google sign-in | Secure (prod), Lax | 1 year | Strictly necessary (UI customization the user chose) | Pages in the chosen language |
| `theme` | cookie | `/api/preferences` | Secure (prod), Lax | 1 year | Strictly necessary (UI customization) | Dark / Light Mode the user chose |
| `units` | cookie | `/api/preferences` | Secure (prod), Lax | 1 year | Strictly necessary (UI customization) | Standard / Metric the user chose |
| `nav` | cookie | `Navigation.tsx` (client) | Lax, Secure on HTTPS (added) | 1 year | Strictly necessary (UI customization) | Sidebar collapsed or not, as the user set it |
| `liveRacing.leadAnnouncer`, `liveRacing.colorAnnouncer` | localStorage | `LiveRacing.tsx` | - | Until cleared | Strictly necessary (UI customization) | Checkboxes the user ticked, signed-in page |
| `visitor_id` | cookie | `/api/activity` | HttpOnly, Secure (prod), Lax | 1 year | **Analytics (consent)** | Recognizes the browser across visits in the activity log |
| `activitySessionId` | sessionStorage | `ActivityTracker.tsx` | - | Tab | **Analytics (consent)** | Groups one tab's events in the activity log |

**Loaded before consent (before this change):** the Activity Log. `ActivityTracker` was rendered unconditionally in the
root layout: it recorded every page view and click (path, title, referrer, control label, viewport) for every visitor
and sent them to `/api/activity`, which stored them with the full IP address and user agent and set the 1-year
`visitor_id` cookie. That is consent-dependent under ePrivacy Art. 5(3) (storage on, and reading from, the terminal
for a purpose that isn't strictly necessary) and was running without consent. It is now gated.

### Classification rationale

- **Strictly necessary**: `session` and the OAuth state cookies are needed for a service the user explicitly requested
  (signing in) and for its security (Art. 5(3) exemption; EDPB/WP29 Opinion 04/2012 §3.2-3.3). `cookie_consent` stores
  the user's choice (recognized as exempt by the CNIL and the ICO).
- **UI customization** (`language`, `theme`, `units`, `nav`, Live Racing checkboxes): each stores only a choice the user
  made by an explicit action, to present the site as they asked. WP29 Opinion 04/2012 §3.6 and the CNIL's 2020
  guidelines (art. 50, "personnalisation de l'interface") treat these as exempt. **Review point**: WP29 suggests such
  cookies last a session or a few hours unless the user is clearly told; these last a year and are disclosed in the
  Cookie Policy. The `language` cookie is also set at sign-in, from the account's Preferred Language. If counsel prefers
  the conservative reading, move them to a Functional category (add `'functional'` to `OFFERED_CATEGORIES`, change their
  inventory rows, and gate their writes), at the cost of visitors' choices not persisting when they reject.
- **Analytics**: the activity log, a first-party behavioral analytics tool. Not exempt: the CNIL's audience-measurement
  exemption requires strictly limited, aggregated statistics, and this records individual click paths with IP address,
  user agent and account. Consent required.
- **Functional / Marketing**: nothing uses them, so they aren't shown (`OFFERED_CATEGORIES` holds only `analytics`).
  The code, dictionaries and database accept them, so adding a technology is a configuration change.

### Third parties needing disclosure or a data processing agreement

None of these set cookies on the site, but they process personal data server-side and need to be covered by the Privacy
Policy and a DPA/transfer mechanism (see section 7):

Render (hosting, database in Oregon), Cloudflare (Render's edge network), Stripe (payments), Resend (email), OpenAI,
Anthropic and DeepSeek (AI coaching; telemetry-derived data), LangSmith (AI tracing when `LANGSMITH_TRACING` is on:
prompts and responses), Google Cloud Text-to-Speech and ElevenLabs (coach speech text), Esri (map tiles; server
requests only), iRacePlan (race history sync with the user's API key), Discord and Google (OAuth), GitHub (collector
releases). **DeepSeek** processes data in the People's Republic of China, which has no EU adequacy decision; flag for
counsel before routing EEA users' data there.

## 2. Design

### Choice of a custom implementation over a CMP

A hosted CMP (Cookiebot, OneTrust, Usercentrics, iubenda) would add a third-party script to every page (itself a
technology needing disclosure, and a request to a third party before consent), a monthly cost, and a scanner built for
sites with many third-party tags. This site has one optional, first-party technology. A small custom system is cheaper,
loads nothing external, keeps the records in the site's own database, and fits the site's design and three languages.
No library guarantees compliance either way; what matters is the behavior, which the tests check.

### Files

| File | Role |
| --- | --- |
| `src/lib/cookieConsent.ts` | Pure rules: categories, cookie format, validity, actions, versions |
| `src/lib/consentRegion.ts` | Pure: country to region, whether opt-in applies |
| `src/lib/cookieInventory.ts` | Every cookie and storage item; source of the Cookie Policy tables and the preference center lists |
| `src/lib/cookieConsentServer.ts` | Reads the consent cookie and the trusted country header; writes the cookie; deletes refused cookies |
| `src/lib/cookieConsentRecords.ts` | The audit trail: insert, link to an account at sign-in, retention purge |
| `src/app/api/consent/route.ts` | `POST /api/consent`: records a choice, sets the cookie, deletes refused cookies |
| `src/components/CookieConsentProvider.tsx` | Client state, banner, preference center, withdrawal cleanup |
| `src/components/CookieConsentBanner.tsx`, `CookiePreferencesDialog.tsx`, `CookieSettingsButton.tsx`, `ConsentGate.tsx` | UI |
| `src/app/cookies/page.tsx`, `src/lib/legal.ts` (`cookiePolicy`) | The Cookie Policy |

### Enforcement

1. **Server-rendered decision.** The root layout reads the consent cookie on the server (`getConsentState`) and passes
   what may run to `CookieConsentProvider`. `ActivityTracker` is rendered inside `<ConsentGate category="analytics">`,
   which renders nothing unless granted. The server HTML and the first client render agree, so no hydration window
   exists in which the tracker could run, and there's no client-side cookie read to race.
2. **Client navigation.** The provider lives in the root layout, which persists across route changes; the gate keeps
   the tracker unmounted on every route.
3. **Grant only after the record.** A grant takes effect only after `/api/consent` has stored it (no evidence, no
   tracking). A refusal or withdrawal takes effect immediately in the page, before the request, and holds even if the
   request fails.
4. **Withdrawal.** Unmounting the tracker removes its listeners, cancels its pending batch and drops queued events (so
   nothing collected is sent afterwards). The provider removes `activitySessionId`; `/api/consent` deletes the
   HttpOnly `visitor_id` cookie, which page scripts can't reach.
5. **Server-side check.** `/api/activity` refuses events (204, nothing stored, `visitor_id` deleted) unless the request
   carries a current analytics grant. This covers tabs opened before a withdrawal, cached pages and forged requests.
6. **No retroactive sending.** Nothing is queued before consent, because the tracker doesn't exist before it.
7. **Guards.** `scripts/cookie-consent.test.mjs` fails if code starts using browser storage outside the known files, a
   cookie constant isn't in the inventory, the tracker is rendered outside the gate, or a third-party script is added.

Third-party cookies that can't be deleted by the site: none are set on the site. Stripe, Google, Discord and GitHub set
their own cookies on their own domains when the user goes there; the Cookie Policy links to their policies.

### Geography

`CONSENT_MODE=global` (default) asks everyone. `regional` asks the EEA, UK, Crown Dependencies, Switzerland and anyone
whose country isn't known, and lets analytics run elsewhere until turned off. The country only comes from
`CONSENT_COUNTRY_HEADER`, which must name a header the infrastructure sets and overwrites (e.g. Cloudflare's
`cf-ipcountry`). **Render does not document passing a country header to the app**, so keep `global` unless that's
verified; a client-supplied header must never decide consent. No IP geolocation is done.

### Lifecycle

- A choice lasts `CONSENT_REVIEW_DAYS` (default 180) and the cookie expires then. No law sets a period; 180 days
  follows the CNIL's recommendation of about 6 months for both acceptances and refusals.
- `CONSENT_PURPOSES_VERSION` (in `cookieConsent.ts`): bump it for a material change (new technology, category or
  purpose). Every earlier choice stops counting, the banner says "Our use of cookies has changed", and optional cookies
  stay off until answered. An earlier refusal is never turned into consent.
- `COOKIE_POLICY_VERSION` and `CONSENT_BANNER_VERSION` are stored with every record as evidence of what was shown.
  Change them when the policy or the banner/preference center wording changes (any language).
- Consent belongs to the browser. Logging in or out doesn't change it. When someone signs in, earlier anonymous records
  from that browser are tied to the account (`user_id`, `user_linked_at`); the choice isn't applied to other devices.

## 3. Database

`ensureUserSchema` (`src/lib/users.ts`) creates `racingcoach."CookieConsents"` on first use, like every other table
(the project has no separate migration tool):

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | The record ID (also in the cookie) |
| `browser_id` | UUID | Pseudonymous; the same for every choice from one browser |
| `user_id` | INTEGER, FK `"Users"` ON DELETE SET NULL | When signed in, or linked at a later sign-in |
| `user_linked_at` | TIMESTAMPTZ | When an anonymous record was tied to an account |
| `recorded_at` | TIMESTAMPTZ | UTC |
| `action` | TEXT CHECK | `accepted`, `rejected`, `customized`, `withdrawn`, `updated` |
| `categories` | JSONB | e.g. `{"necessary": true, "analytics": false}` |
| `cookie_policy_version`, `banner_version`, `purposes_version` | | What was shown |
| `notice_language` | TEXT | Language the notice was shown in |
| `region`, `country` | TEXT | `EEA`/`UK`/`CH`/`other`/`unknown`; country only from the trusted header |
| `method` | TEXT CHECK | `banner` or `preferenceCenter` |

Indexes on `browser_id`, `user_id`, `recorded_at`. No IP address, user agent or precise location. Rows are only
inserted (never overwritten), except the account link. Deleting an account keeps the evidence without the account
(`SET NULL`). `startConsentRecordPurge` (from `src/instrumentation.ts`) deletes rows older than
`CONSENT_RECORD_RETENTION_DAYS` (default 1095, minimum 365) daily. No page or route reads the table; query it directly
for a data subject request or a regulator.

Rollback: the table is additive. Reverting the code leaves it unused; `DROP TABLE racingcoach."CookieConsents"` removes
it (and the evidence in it).

## 4. Tests

| Command | What |
| --- | --- |
| `npm run test:cookie-consent` | Rules, regions, cookie format, re-consent, actions, inventory vs policies, source guards; then the records module against a local Postgres when `COOKIE_CONSENT_TEST_DATABASE_URL` is set |
| `npm run test:e2e` | Playwright in Chromium against `next dev` and a local Postgres (`E2E_DATABASE_URL`), checking real cookies, storage, requests and database rows |

```
docker run -d --rm --name rc-consent-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rctest -p 127.0.0.1:55432:5432 postgres:16
npx playwright install chromium
COOKIE_CONSENT_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/rctest npm run test:cookie-consent
E2E_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/rctest npm run test:e2e
```

The e2e server runs with `NODE_ENV=test`, so Next.js does not load `.env.local` (which points at production); both
test suites refuse a database that isn't on this computer.

## 5. Manual browser check

1. Open the site in a private window. The banner shows; DevTools > Application > Cookies has no `visitor_id`, Network has
   no `/api/activity`.
2. Reject All: the banner goes; browse, wait 5 s: still no `/api/activity`, no `visitor_id`. `cookie_consent` exists
   (HttpOnly).
3. Footer > Cookie Settings: the dialog opens with Analytics off. Tab stays inside; Escape closes it and focus returns to
   the link.
4. Turn Analytics on, Save Preferences: `/api/activity` requests start (204), `visitor_id` appears.
5. Cookie Settings > Reject All: requests stop at once; `visitor_id` and Session Storage `activitySessionId` are gone.
6. Log in and out: the banner doesn't return; signing in works with analytics off.
7. With a screen reader (NVDA/VoiceOver): the banner is announced as the "Cookie consent" region, reached first by Tab;
   the dialog is announced as "Cookie Settings"; switches announce on/off.
8. Repeat at 375 px wide and at 200% zoom: no sideways scrolling, all buttons reachable.
9. Switch the site to Portuguese and Spanish: the banner and preference center are translated.

## 6. Deployment (Render)

- No new required environment variables. Optional: `CONSENT_MODE` (leave unset = `global`), `CONSENT_COUNTRY_HEADER`
  (only if a trusted country header is verified), `CONSENT_REVIEW_DAYS`, `CONSENT_RECORD_RETENTION_DAYS`.
- The table is created on the first request after deploy (`ensureUserSchema`), as other tables are.
- The Privacy Policy version changes to `2026-10-29`, so every signed-in user sees the "Please review our updated
  terms" notice once, and the collector's installer and window ask again (existing behavior for a policy change). The
  next collector release picks up the new Privacy Policy through `scripts/exportLegal.mjs`.
- After deploy: check the banner on production, run the manual check above, and confirm in the Admin page's activity log
  that only consenting visitors are recorded (expect far fewer rows than before).

## 7. Outside this task: other privacy obligations found during the audit

- **Activity log retention and IP addresses**: `"ActivityLog"` keeps full IP addresses and user agents with no
  retention limit ("as long as reasonably necessary"). Consider truncating IPs and setting a fixed period, and deleting
  existing rows collected without consent.
- **Existing activity data**: rows recorded before this change were collected without consent from EEA/UK visitors.
  Counsel should decide whether to delete them.
- **Transfers and DPAs**: confirm a DPA with SCCs (or DPF certification) is in place with each processor listed above;
  the Privacy Policy now says transfers rely on such mechanisms. DeepSeek (China) needs specific review.
- **Art. 27 representative**: a non-EU controller offering services to people in the EU (Portuguese and Spanish
  versions, euro-area users) may need an EU representative, and a UK representative under the UK GDPR.
- **Records of processing (Art. 30)** and a **DPIA** for AI coaching on telemetry may be required.
- **LangSmith tracing** sends prompts and responses (with user telemetry) to LangChain; disclose it or turn tracing off
  in production.
- **Collector**: the desktop app sends logs and telemetry; it's not a website cookie matter, but its disclosures are in
  the Privacy Policy and Terms.
- **Emails**: if marketing emails are ever sent, they need separate consent (ePrivacy Art. 13).
- **Legal texts are English only**; some member states expect information in their language.
