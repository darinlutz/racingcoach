# GDPR gap analysis (November 2026)

What remains after the data subject rights work ([privacy-requests.md](privacy-requests.md)), from the repository as it
stands. It is an engineering assessment to brief qualified counsel, not legal advice. Statuses describe the code and
documents in this repository; anything outside it (contracts, registrations, vendor settings) is marked "not evidenced"
rather than assumed missing or present.

Severity: **Critical** (likely unlawful processing now), **High** (a clear obligation not met), **Medium** (partly met or
evidence missing), **Low** (good practice).

## Prioritized list

| # | Gap | Severity | Owner |
| --- | --- | --- | --- |
| 1 | Personal data can be sent to DeepSeek (PRC) with no transfer mechanism | Critical | Legal + engineering |
| 2 | Processor agreements (Article 28) and transfer safeguards not evidenced for most vendors | High | Legal |
| 3 | EU and UK representative (Article 27) likely required, none named | High | Legal |
| 4 | ~~Website activity log has no retention period and survives account deletion~~ Resolved: IP and browser details cleared after 13 months, rows anonymized on account deletion. The rest of each row is still kept "as long as reasonably necessary" | Low | Legal (confirm) |
| 5 | ~~New accounts get a copy of the site owner's iRacePlan API key and iRacing identity~~ Resolved: only the owner's two accounts keep it; other copies and their synced races are deleted on deploy | — | — |
| 6 | No breach detection, assessment and notification procedure or breach register (Articles 33–34) | High | Operations + legal |
| 7 | ~~Privacy Policy out of date~~ Published 2026-11-02 (rights process, recipients, voice, Live Racing, Coach access, retention). Still open: transfer safeguards per provider (gap 2) and representatives (gap 3) | Medium | Legal |
| 16 | Live Racing processes other iRacing drivers' names, ratings and countries (people who aren't users); now disclosed, but an Article 14 assessment is needed | Medium | Legal |
| 8 | No record of processing activities (Article 30) | Medium | Legal + engineering |
| 9 | DPIA screening not documented; one is likely advisable (Article 35) | Medium | Legal |
| 10 | Coaches and Admins can view every user's laps; not clearly disclosed | Medium | Legal |
| 11 | iRacePlan API keys stored in plain text | Medium | Engineering |
| 12 | Customer email addresses sent to the owner's personal Yahoo mailbox | Medium | Operations |
| 13 | DPO appointment assessment not documented (Articles 37–39) | Low | Legal |
| 14 | Other regimes: UK GDPR, Swiss FADP, Brazil's LGPD, US state laws | Medium | Legal |
| 15 | LangSmith tracing must stay off in production | Low | Operations |

## 1. Article 6: lawful bases

**Requirement:** each purpose needs one lawful basis, chosen before processing and stated in the notice.

**Status:** mostly met. The Privacy Policy, Section 2, maps contract, legitimate interests, consent and legal obligation;
`src/lib/personalDataInventory.ts` assigns one or more to every category.

**Evidence and gaps:**
- Legitimate interests are claimed for collector logs, AI usage records, the collector log review agent and security
  logs, but no legitimate interests assessment (LIA) is documented. **Medium, legal.**
- In-Car AI Coach callouts and Race Announcers send telemetry to AI providers automatically once enabled; contract is a
  reasonable basis for paid features the user turned on, but counsel should confirm "necessary for the contract" holds
  for AI processing that a user can't separately switch off. **Low, legal.**
- Driver Radio and watcher voice messages record voice. Voice used only for speech to text is not biometric data under
  Article 9 (not used to identify), but the Privacy Policy doesn't mention voice recording at all. **Medium, legal.**

## 2. Articles 13–14: transparency

**Status:** partly met.

**Gaps:**
- Section 9 ("Your Privacy Rights") tells people to email support; it should point to Privacy & Data Rights and
  `/privacy-request`, explain verification, the one-month deadline and extension, and the right to complain. Proposed
  text below. **High, legal.**
- Section 5 lists recipients by category ("service providers that support hosting, authentication...analytics"). It
  mentions analytics providers (there are none) and authentication providers (only Google, optional). Article 13(1)(e)
  allows categories, but the categories should match reality, and many regulators expect named processors on request.
  The inventory names them: Render, Stripe, Resend, OpenAI, Anthropic, DeepSeek, Google (Cloud TTS and Sign-in),
  ElevenLabs, Discord, iRacePlan, Cloudflare (R2 and the Discord proxy Worker), Esri (map tiles, through our server, so
  no user data reaches it). **High, legal.**
- Not disclosed: voice recording (Driver Radio, Hold to Talk), Live Racing sharing with watchers and Coaches, Coaches'
  and Admins' access to every user's laps, the collector log review agent emailing log lines to the owner. **Medium.**
- The Privacy Policy says the activity log is kept "as long as reasonably necessary". Article 13(2)(a) requires the
  period or the criteria; see gap 4.

## 3. Article 25: privacy by design and by default

**Met:** analytics off until consent (`ConsentGate`, server refuses events without a grant); lap retention limited by
level and capped at 90 days with SQL enforcement on every read; hashed sessions, reset links, upload keys and TV tokens;
Live Racing watching is opt-in per driver; no third-party scripts (source guard in `scripts/cookie-consent.test.mjs`);
exports are owner-only with no bearer links.

**Gaps:**
- Coaches and Admins see every user's laps (`canSeeAllLaps`), and users see Coaches' laps. That's a design choice, but
  by default it's broad and undisclosed. Consider limiting Coaches to drivers who opt in. **Medium, engineering after a
  product decision.**
- Gap 5 (owner's iRacePlan key copied into every account).

## 4. Article 28: processors and subprocessors

**Status:** not evidenced in the repository. The Privacy Policy, Section 12, says the Standard Contractual Clauses are
"in our service providers' data processing terms".

**Action (legal):** for each processor, confirm a DPA is in force (some are click-through and automatic, some must be
requested or signed), and keep copies: Render, Stripe, Resend, OpenAI (API DPA must be executed), Anthropic, DeepSeek
(see gap 1), Google Cloud, ElevenLabs, Cloudflare. Discord and iRacePlan act on the user's own instruction and are
probably independent controllers. Stripe is a controller for some payment processing. Publish or offer a subprocessor
list. **High.**

## 5. Article 30: records of processing activities

**Requirement:** a written record. The under-250-employees exemption (Article 30(5)) does not apply when processing is
not occasional, which it isn't here.

**Status:** not met. `src/lib/personalDataInventory.ts` and [privacy-requests.md](privacy-requests.md) cover most fields
(categories, purposes, recipients, retention, transfers, security), and a tested guard keeps the inventory in step with
the schema. Missing: controller and representative details, a formal per-activity layout, and Article 32 measures in
summary. **Medium; engineering can generate the draft from the inventory, legal completes it.**

## 6. Article 32: security

**Met (evidence):** scrypt password hashes; SHA-256 hashes of session, reset, TV, upload and verification tokens;
HttpOnly, Secure, SameSite cookies; role checks returning 404; per-account and per-IP rate limits; parameterized SQL;
upload size limits; step-up sign-in before exports and deletion; signed collector releases; secrets only in environment
variables.

**Gaps:**
- `"IRacePlanConnections".api_key` is plain text. Encrypt at rest with an application key, or stop storing it. **Medium.**
- Encryption at rest for Render Postgres and its backups, access to the Render dashboard (MFA), and backup retention are
  not evidenced here; confirm and record them. **Medium, operations.**
- No documented access review for Admin and Coach roles. **Low.**
- In-memory rate limits for sign-in style attempts reset on restart and aren't shared across instances (acceptable on
  one instance; document the assumption). **Low.**

## 7. Articles 33–34: breaches

**Status:** not met. There is error-log review for the collector, but no security monitoring, no incident response
procedure, no breach register, and no template for the 72-hour notification to the lead authority or for notices to
individuals. **High; operations writes the runbook, legal reviews the thresholds and the authority to notify (which
depends on gap 3).**

Suggested minimum: a one-page runbook (detect, contain, assess risk, decide, notify, record), a breach register (even
for breaches not notified, Article 33(5)), Render and Stripe alert contacts, and a contact list for each processor.

## 8. Articles 35–36: DPIA

**Screening (EDPB criteria):** evaluation or scoring (AI coaching evaluates driving performance), systematic monitoring
(continuous telemetry, Live Racing position sharing), innovative technology (LLM coaching, speech), possibly minors (13+
accepted). Two or more criteria usually means a DPIA is required or strongly advised. Data is not special category and
the effects on people are modest, so a short DPIA is likely enough. **Medium, legal with engineering input.**
Prior consultation (Article 36) is unlikely to be needed.

## 9. Chapter V: international transfers

**Status:** partly met in wording, not evidenced in fact.

- **DeepSeek (gap 1, Critical):** the Admin page's AI Model Control can route any AI feature to DeepSeek
  (`api.deepseek.com`). DeepSeek processes in the People's Republic of China, which has no adequacy decision, and no
  SCCs or transfer impact assessment are evidenced. Telemetry, coaching instructions, collector logs and transcribed
  driver radio would be transferred. **Recommendation:** until counsel approves a mechanism, don't route EEA/UK/Swiss
  users' data to DeepSeek (an engineering change in `src/lib/aiModels.ts`/`aiModelList.ts`, or simply don't select it),
  and say so in the Privacy Policy. The inventory and Article 15 notes already disclose DeepSeek as a possible recipient.
- **US providers:** Data Privacy Framework certification (where the provider participates) or SCCs in the provider's DPA.
  Verify each provider's DPF status or SCCs and keep a transfer impact assessment. **High, legal.**
- RacingCoach.app itself is in the US, so every EEA user's data is transferred. As the controller collecting directly
  from users, Clarivex, LLC relies on Article 3(2) applicability; counsel should confirm how the Privacy Policy frames
  this (direct collection by a non-EU controller is not a "transfer" in the EDPB's 05/2021 view, but onward transfers to
  processors are).

## 10. Article 27: EU representative

**Assessment:** the site offers services to people in the EU (German, Spanish and Portuguese translations, Spain-Spanish
voice options, euro-region users likely) and monitors behavior (telemetry), so Article 3(2) applies. The Article 27(2)
exemption needs processing that is occasional and unlikely to result in risk; continuous telemetry processing is not
occasional. **A representative in an EU member state where users are is likely required, and a UK representative
under the UK GDPR. High, legal.** Not named anywhere; don't add one to the policy until appointed.

## 11. Articles 37–39: DPO

**Assessment:** a DPO is required when core activities consist of large-scale regular and systematic monitoring.
Telemetry monitoring is a core activity, but the scale (a small subscription service) is likely not "large scale".
Probably not required; document the reasoning and revisit as the user base grows. **Low, legal.** Don't describe anyone as
a DPO unless appointed.

## 12. Article 22: automated decisions

**Assessment:** no decision with legal or similarly significant effects is made solely by automated means. AI coaching
produces suggestions; rate limits, membership levels and lap retention follow published fixed rules; the collector log
review only emails the owner. Article 22 doesn't apply; the inventory says so in the Article 15 notes. **Met.** Revisit if
AI is ever used to suspend accounts or price differently.

## 13. ePrivacy: cookies and tracking

Audit of the existing system (`docs/cookie-consent.md`), against the brief's checklist:

| Check | Result |
| --- | --- |
| No non-essential cookies or storage before consent | Met: `ConsentGate` renders nothing until granted; `/api/activity` refuses events without a current grant |
| Genuine rejection | Met: Reject All, Accept All and Customize are equal in style; closing the banner leaves analytics off |
| Separate purposes | Met: one optional category (analytics); new categories must be added to `OFFERED_CATEGORIES` |
| Records choices | Met: `"CookieConsents"`, no IP or user agent, 3 years |
| Change or withdraw | Met: footer Cookie Settings, the Cookie Policy's button, and now Privacy & Data Rights |
| Withdrawal prospective | Met: refused categories' cookies and storage are deleted and the tracker unmounts; earlier rows stay (erasable by request) |
| Third-party scripts | Met: none; a source guard fails the build's tests if one is added; map tiles are proxied |
| Visitors who aren't signed in | Met: the choice is per browser and recorded by a random browser ID |

Remaining: consent is per browser, not per account (disclosed). The banner's default `CONSENT_MODE` is `global`, the
stricter option. The collector reading simulator data on the user's PC is the service the user installed and is
strictly necessary under Article 5(3) ePrivacy; counsel may confirm. **Met overall.**

## 14. Other regimes

- **UK GDPR and DPA 2018:** same substance; needs its own representative (gap 3), the UK Addendum or IDTA for
  transfers, and the ICO as the complaint authority in the notice. ICO registration (data protection fee) may be
  required for a controller processing UK residents' data even from abroad; confirm. **Medium, legal.**
- **Switzerland (revFADP):** Swiss users are mentioned in the policy; the FADP needs a Swiss representative in some
  cases and has its own transfer rules (Swiss-US DPF). **Low–Medium, legal.**
- **Brazil (LGPD):** the site is offered in Brazilian Portuguese with pt-BR voices, so it targets people in Brazil. The
  LGPD applies to processing of their data, needs a published data protection officer ("encarregado") contact unless an
  ANPD exemption for small agents applies, and responses within 15 days for some requests. **Medium, legal.**
- **US state privacy laws (CCPA/CPRA and others):** thresholds (revenue, number of consumers) are probably not met now;
  record the assessment and revisit. **Low, legal.**

## Gap 4 detail: the website activity log (resolved 2026-11-02, as the owner decided)

Now: `src/lib/activityRetention.ts` clears IP addresses and browser details 13 months after each event (and `"AiUsage"`
IP addresses), and Delete My Account anonymizes the account's rows. The paragraph below is the original finding.

`"ActivityLog"` stores page views and clicks with IP address and user agent (only with analytics consent). It has no
retention period and, by an earlier deliberate choice, survives Delete My Account untouched (AGENTS.md says so, and the
Privacy Policy discloses it). Under Article 5(1)(e) and 17(1)(b) (consent withdrawn by deleting the account), keeping it
indefinitely is hard to justify. **Recommendation:** pick a period (e.g. 13 months, matching common analytics guidance),
add a purge to the hourly job, and either delete or anonymize (drop `user_id`, IP, user agent) a deleted account's rows.
This changes existing documented behavior, so it was not done here; it needs the owner's decision. Until then, erasure
requests for these rows are handled through Request Data Deletion (Admin-reviewed) and run by the same code.

## Gap 5 detail: the shared iRacePlan connection (resolved 2026-11-02, as the owner decided)

Now: only `IRACEPLAN_SHARED_ACCOUNTS` (darinlutz@yahoo.com, darinlutz648@gmail.com) get or keep the copy;
`removeSharedIRacePlanConnections` deletes every other copy and the iRacePlan-synced races through it when the schema runs
on deploy. The paragraph below is the original finding.

`createUser` copies the site owner's iRacePlan API key, iRacing customer ID and iRacing name into every new account's
`"IRacePlanConnections"`. That discloses the owner's personal data and a credential to every account (it's in each
row, and Race Trends would sync the owner's races into another account if it were opened to non-Admins). The export now
leaves the copied identity out, but the copies remain. **Recommendation:** stop copying it at signup and delete existing
copies (`DELETE ... WHERE user_id <> owner AND iracing_customer_id = owner's`). That's a production data change and a
feature change, so it awaits the owner's approval.

## Proposed Privacy Policy changes (for counsel)

**Published 2026-11-02** (version `2026-11-02`) at the owner's direction, adapted to the decisions above, without
representative placeholders. Section 12 now discloses DeepSeek's processing in China but no safeguard for it, which
remains gap 1. The drafts as first proposed:

These are drafts. Changing the policy's text requires a new version in `src/lib/policyVersions.ts` and effective date
in `src/lib/legal.ts`, which asks every user to accept again; that's why it wasn't changed here. Placeholders in
[brackets] must not be filled in until true.

**Section 9, replace with "Your Privacy Rights":**

> Depending on where you live, you may have the right to access your personal data, to correct it, to have it deleted,
> to restrict or object to how we process it, to receive the data you provided in a portable format, and to withdraw
> consent at any time without affecting processing before you withdrew it.
>
> If you have an account, use My Settings > Privacy & Data Rights: you can see the categories of data we hold and why,
> download a full or portable copy, correct your name and settings, delete chosen data or your whole account, and
> submit other requests. If you don't have an account, no longer have one, or can't sign in, use
> https://racingcoach.app/privacy-request or write to support@racingcoach.app.
>
> To protect your data, we confirm it's you before acting: by your signed-in account (and your password or a code we
> email to you before downloads and deletions), or for requests made without signing in, by a link we email to the
> address you give. We may ask for more information if we can't otherwise confirm your identity.
>
> We answer within one month of receiving your request. If a request is complex or we receive many, we may extend this
> by up to two more months; if so, we tell you within the first month and explain why. If we refuse a request, we tell
> you why and how to complain.
>
> Some data is kept after a deletion request where the law requires or allows it: billing records for accounting and tax,
> records of your consent choices, and the record of your request. Copies in backups are deleted on the backup provider's
> schedule and are deleted again before any restored copy is used.
>
> You can complain to the data protection supervisory authority where you live or work, or where an alleged infringement
> took place. [EU representative: name, address, once appointed.] [UK representative, once appointed.]

**Section 5, add a recipients list** (names as in the inventory), and remove "analytics" providers.

**Section 7, give the activity log a period** once decided (gap 4).

**Section 12, international transfers:** state the mechanism actually in place per provider (DPF or SCCs), and either
remove DeepSeek or describe the safeguard for it (gap 1).

**New paragraphs:** voice recordings (Driver Radio, Hold to Talk: recorded only while the button is held, transcribed by
OpenAI, kept in memory up to 5 minutes, not stored), Live Racing sharing (who can see a live session), and Coach and
Admin access to recorded laps.

**Terms of Service:** no change needed for the rights themselves; if Coach access to laps is kept, mention it under
"Telemetry and User-Provided Data".

## Flagged for counsel

1. Deadline start (receipt vs. identity confirmed) and holiday rule (`privacyRules.ts` uses receipt and no holiday shift).
2. Whether limits (3 exports a day, 10 open requests) could be read as restricting rights; Admins can always fulfil more.
3. Retention of privacy request records and the erasure ledger (3 years) and of cookie choice records (3 years).
4. Whether keeping tombstones of deleted laps (ID and completion time, no telemetry) is necessary and proportionate.
5. Lap files can contain the iRacing name of whoever drove (e.g. a friend on the user's iRacing account); exports
   include it as part of the user's own uploaded file.
6. Gaps 1–4, 7, 9, 10 and 14 above.
