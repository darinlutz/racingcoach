// Every category of personal data RacingCoach.app processes about a user: what it is, where it's kept, why, on what
// legal basis, from where, for how long, who receives it, and whether Download My Data (personalDataExport.ts) and
// Request Data Deletion (dataErasure.ts) cover it. It's the Article 15(1) information shown on Privacy & Data Rights
// and written into every export's README, and the record docs/privacy-requests.md builds on.
//
// English only, like the legal documents (legal.ts), so it can't change meaning in translation. Pure, with only
// dependency-free imports, so scripts/privacy-rights.test.mjs checks it against the schema: every table holding a
// user's rows must be listed here. When a table or column with personal data is added, add it here too.
//
// Legal bases and retention periods follow the Privacy Policy as it stands; they are not legal advice, and the ones
// marked for review in docs/gdpr-gap-analysis.md need counsel.
import { RETENTION_DAYS, MAX_RETENTION_DAYS } from './lapRetentionRules.ts';
import type { ErasableCategory } from './privacyRules.ts';

export type LegalBasis = 'contract' | 'legitimateInterests' | 'consent' | 'legalObligation';

export type InventoryCategory = {
  key: string;
  title: string;
  description: string;
  // racingcoach tables (and "Users" columns) holding it; empty when it isn't in the database
  tables: string[];
  purpose: string;
  legalBasis: LegalBasis[];
  source: string;
  storage: string;
  retention: string;
  recipients: string[];
  // Personal data whenever it's tied to an account; "pseudonymous" when only an internal ID or random identifier ties it
  personalData: true | 'pseudonymous';
  // In an Article 15 export; in an Article 20 export (provided or observed data processed on contract or consent)
  access: boolean;
  portable: boolean;
  // How it can be erased: Request Data Deletion's category, or only by deleting the account, or kept after it
  erasure: { category: ErasableCategory } | 'accountDeletion' | 'retained';
  // Why some of it outlives an erasure request or Delete My Account
  retainedReason?: string;
};

const HOSTING = 'Render (application hosting and the PostgreSQL database, United States)';
const AI_PROVIDERS =
  'The AI model provider set for the feature in AI Model Control: OpenAI (United States), Anthropic (United States) or DeepSeek (People’s Republic of China), only the measurements and text the feature sends';
// Lap files moved out of the database (src/lib/telemetryStorage.ts, docs/telemetry-storage.md): a private bucket only
// the web server can read
const LAP_FILE_STORAGE = `${HOSTING}; the lap files themselves in Cloudflare R2 object storage (a private bucket only the web server reads)`;
const SPEECH_PROVIDERS = 'Google Cloud Text-to-Speech, ElevenLabs or OpenAI (speech only, United States)';

const lapPeriods = `Bronze ${RETENTION_DAYS.Bronze} days, Silver ${RETENTION_DAYS.Silver} days, Gold ${RETENTION_DAYS.Gold} days from each lap's completion, never more than ${MAX_RETENTION_DAYS} days (Privacy Policy, Section 8)`;

export const PERSONAL_DATA_INVENTORY: InventoryCategory[] = [
  {
    key: 'account',
    title: 'Account and profile',
    description:
      'Your name, email address, role, membership level, account status, sign-up date, country, preferred language, units and theme, brake beep settings, the promo code typed at sign-up, and whether the account has a password (the password itself is stored only as a one-way hash and is never exported).',
    tables: ['Users'],
    purpose: 'Creating and running your account, signing you in, and showing the site in your language and units.',
    legalBasis: ['contract'],
    source: 'You, when you sign up and change My Settings; Stripe for the membership level you buy; Admins for role and level changes.',
    storage: HOSTING,
    retention: 'While your account is open.',
    recipients: [HOSTING, 'Resend (your email address, for password reset and privacy emails, United States)'],
    personalData: true,
    access: true,
    portable: true,
    erasure: 'accountDeletion',
  },
  {
    key: 'authentication',
    title: 'Sign-in and devices',
    description:
      'Sign-in sessions (only a hash of each token and its expiry), password reset and email confirmation links (hashed), your Google account ID and email when you sign in with Google, paired TVs for TV Broadcast Mode, and your telemetry collector upload key (a hash, its first characters and when it was last used).',
    tables: ['Sessions', 'PasswordResets', 'EmailVerifications', 'GoogleConnections', 'TvPairings', 'TvSessions', 'CollectorKeys', 'PrivacyReauthCodes'],
    purpose: 'Keeping your account secure and letting your collector and TVs act for you.',
    legalBasis: ['contract', 'legitimateInterests'],
    source: 'Created when you sign in, pair a TV or create an upload key; Google, when you use Sign in with Google.',
    storage: HOSTING,
    retention: 'Sessions 7 days, reset links 1 hour, email confirmation links 3 days, TV sessions 30 days, re-authentication codes 15 minutes; Google link and upload key while your account is open.',
    recipients: [HOSTING, 'Google (only when you choose Sign in with Google)'],
    personalData: true,
    access: true,
    portable: false,
    erasure: { category: 'devices' },
  },
  {
    key: 'laps',
    title: 'Lap telemetry',
    description:
      'Every lap the RacingCoach collector uploaded: track, car, the driver name iRacing reported, session IDs, lap time, incidents, weather, and the full lap file of 60 samples per second (speed, pedals, steering, gear, tires, fuel, and track position once added).',
    // TelemetryObjectCleanup: the queue of a deleted lap's file to delete from object storage (no telemetry)
    tables: ['CollectorLaps', 'ExpiredLaps', 'TelemetryObjectCleanup'],
    purpose: 'Lap analysis, comparison and coaching.',
    legalBasis: ['contract'],
    source: 'The RacingCoach collector on your computer, reading the simulator.',
    storage: LAP_FILE_STORAGE,
    retention: lapPeriods,
    recipients: [HOSTING, 'Cloudflare (lap files)', AI_PROVIDERS],
    personalData: true,
    access: true,
    portable: true,
    erasure: { category: 'laps' },
    retainedReason:
      'After a lap is deleted, a record of its collector ID and completion time (no telemetry) stops the same lap being uploaded again, until it would have expired anyway.',
  },
  {
    key: 'debriefs',
    title: 'Debrief Coach analyses and lap summaries',
    description:
      'Each Debrief Coach run you saved: the session measured from your laps and the coach’s written debrief; and each AI summary of Lap Compare, Multi-Lap Analysis or Stint Analysis: the measurements it was given and the coach’s summary.',
    tables: ['DebriefSessions', 'LapSummaries'],
    purpose: 'Showing your coaching history, here and in the Discord bot.',
    legalBasis: ['contract'],
    source: 'Measured by your browser from your laps; the debriefs and summaries are written by the AI coach.',
    storage: HOSTING,
    retention: lapPeriods,
    recipients: [HOSTING, AI_PROVIDERS, 'Discord (only what /coach debrief and /coach recent post, when you use them)'],
    personalData: true,
    access: true,
    portable: false,
    erasure: { category: 'debriefs' },
  },
  {
    key: 'targetLap',
    title: 'Target Lap',
    description: 'The lap file you chose as your Target Lap, its file name and when you set it.',
    tables: ['Users'],
    purpose: 'Brake beeps, the Target Telemetry overlay and coaching targets.',
    legalBasis: ['contract'],
    source: 'You.',
    storage: HOSTING,
    retention: 'Until you replace or remove it, or delete your account.',
    recipients: [HOSTING],
    personalData: true,
    access: true,
    portable: true,
    erasure: { category: 'targetLap' },
  },
  {
    key: 'raceResults',
    title: 'Race results',
    description:
      'Races synced from iRacePlan with your API key, or seen by the collector: series, track, car, positions, laps, incidents, iRating and safety rating.',
    tables: ['RaceResults', 'IRacePlanConnections'],
    purpose: 'Race Trends and the Discord bot’s /coach results.',
    legalBasis: ['contract'],
    source: 'iRacePlan (with the API key on your account) and the RacingCoach collector.',
    storage: HOSTING,
    retention: 'While your account is open.',
    recipients: [HOSTING, 'iRacePlan (your API key is sent to it to read your results)', AI_PROVIDERS],
    personalData: true,
    access: true,
    portable: true,
    erasure: { category: 'raceResults' },
  },
  {
    key: 'coachSettings',
    title: 'Coaching instructions and voices',
    description:
      'Your In-Car AI Coach Instructions, how the coach says names, coach and announcer voices, Race Announcer Instructions, how the announcers say your name and Race Broadcast preferences.',
    tables: ['Users'],
    purpose: 'Running the In-Car AI Coach and Race Announcers the way you asked.',
    legalBasis: ['contract'],
    source: 'You.',
    storage: HOSTING,
    retention: 'While your account is open.',
    recipients: [HOSTING, AI_PROVIDERS, SPEECH_PROVIDERS],
    personalData: true,
    access: true,
    portable: true,
    erasure: { category: 'coachSettings' },
  },
  {
    key: 'profilePicture',
    title: 'Profile picture',
    description: 'The picture you added on My Dashboard (a 512-pixel JPEG made in your browser, without the original file’s metadata).',
    tables: ['UserPictures'],
    purpose: 'Showing it to you on My Dashboard.',
    legalBasis: ['contract'],
    source: 'You.',
    storage: HOSTING,
    retention: 'Until you remove it or delete your account.',
    recipients: [HOSTING],
    personalData: true,
    access: true,
    portable: true,
    erasure: { category: 'profilePicture' },
  },
  {
    key: 'friends',
    title: 'Friends and Live Racing watchers',
    description:
      'The friends list you keep on the Racing page, and the accounts you allowed to watch you on Live Racing (and who allowed you to watch them).',
    tables: ['Friends', 'LiveRacingWatchers'],
    purpose: 'The friends list and Live Racing sharing.',
    legalBasis: ['contract'],
    source: 'You, and drivers who add you as a watcher.',
    storage: HOSTING,
    retention: 'While your account is open.',
    recipients: [HOSTING, 'The accounts you allowed to watch you'],
    personalData: true,
    access: true,
    portable: true,
    erasure: { category: 'friends' },
  },
  {
    key: 'connections',
    title: 'Discord and iRacePlan connections',
    description: 'Your Discord user ID, username, display name and avatar, and your iRacePlan API key, iRacing customer ID and name.',
    tables: ['DiscordConnections', 'IRacePlanConnections'],
    purpose: 'The Discord bot and Race Trends.',
    legalBasis: ['contract'],
    source: 'Discord, when you connect it; iRacePlan, with the API key you gave.',
    storage: HOSTING,
    retention: 'Until you disconnect them or delete your account.',
    recipients: [HOSTING, 'Discord', 'iRacePlan'],
    personalData: true,
    access: true,
    portable: true,
    erasure: { category: 'connections' },
  },
  {
    key: 'collectorLogs',
    title: 'Collector activity logs',
    description:
      'Every line of the RacingCoach collector’s activity log (your Windows user folder replaced by %USERPROFILE%), and the automated reviews that look for errors in them.',
    tables: ['CollectorLogs', 'CollectorLogReviews'],
    purpose: 'Finding and fixing collector problems.',
    legalBasis: ['legitimateInterests'],
    source: 'The RacingCoach collector on your computer.',
    storage: HOSTING,
    retention: '90 days.',
    recipients: [HOSTING, AI_PROVIDERS, 'Resend (lines of a run with a problem, emailed to the site owner)'],
    personalData: true,
    access: true,
    portable: true,
    erasure: { category: 'collectorLogs' },
  },
  {
    key: 'liveRacing',
    title: 'Live Racing and Driver Radio',
    description:
      'Your car’s live position, inputs, session, the field and weather, messages and voice messages from watchers, and Driver Radio recordings turned into text.',
    tables: [],
    purpose: 'Live Racing, TV Broadcast Mode, the Race Announcers and the Race Engineer.',
    legalBasis: ['contract'],
    source: 'The RacingCoach collector, your microphone while you hold the radio button, and your watchers.',
    storage: 'The web server’s memory only, never the database.',
    retention: 'Up to 5 minutes after the last update (voice messages 1 minute).',
    recipients: [HOSTING, 'OpenAI (speech to text)', AI_PROVIDERS, SPEECH_PROVIDERS, 'The accounts allowed to watch you'],
    personalData: true,
    access: false,
    portable: false,
    erasure: 'accountDeletion',
    retainedReason: 'Not stored, so there is nothing to export or erase after it lapses.',
  },
  {
    key: 'activityLog',
    title: 'Website activity log',
    description:
      'Only if you accepted analytics cookies: the pages you viewed and the controls you clicked, with time, IP address, browser user agent, screen size and language.',
    tables: ['ActivityLog'],
    purpose: 'Understanding how the site is used and improving it.',
    legalBasis: ['consent'],
    source: 'Your browser, with your consent.',
    storage: HOSTING,
    retention:
      'IP address and browser details (user agent, screen size, browser language) are removed 13 months after each visit; the rest of each row is kept as long as reasonably necessary to improve the Services.',
    recipients: [HOSTING],
    personalData: true,
    access: true,
    portable: true,
    erasure: { category: 'activityLog' },
    retainedReason:
      'Delete My Account anonymizes these rows: they are no longer linked to you or your browser, and lose the IP address, browser details, referrer and the text of what was clicked. An erasure request deletes them, after an Admin’s review.',
  },
  {
    key: 'aiUsage',
    title: 'AI usage records',
    description: 'Each AI call you made: the feature, time, IP address, tokens, model, and whether it was allowed or refused.',
    tables: ['AiUsage', 'RateLimitOverrides'],
    purpose: 'Rate limiting, preventing abuse of AI features, and costs.',
    legalBasis: ['legitimateInterests'],
    source: 'Recorded when you use an AI feature.',
    storage: HOSTING,
    retention: '400 days, or until your account is deleted; the IP address is removed after 13 months.',
    recipients: [HOSTING],
    personalData: true,
    access: true,
    portable: false,
    erasure: { category: 'aiUsage' },
  },
  {
    key: 'billing',
    title: 'Subscriptions and billing',
    description:
      'Your Stripe customer and subscription IDs, plan, status, prices, periods, payment dates, discount codes and cancellation feedback. Card details are held by Stripe, never by RacingCoach.app.',
    tables: ['StripeSubscriptions', 'StripeDiscounts', 'CancellationReason', 'StripeWebhookEvents'],
    purpose: 'Taking payments, accounting and tax.',
    legalBasis: ['contract', 'legalObligation'],
    source: 'Stripe, and you when you cancel.',
    storage: `${HOSTING}; Stripe (payments, United States)`,
    retention: 'As long as accounting, tax and legal obligations require, including after the account is deleted.',
    recipients: [HOSTING, 'Stripe'],
    personalData: true,
    access: true,
    portable: false,
    erasure: 'retained',
    retainedReason:
      'Kept for accounting and tax obligations; after Delete My Account it’s no longer linked to your account (cancellation feedback loses your name and email).',
  },
  {
    key: 'policyRecords',
    title: 'Policy acceptances and cookie choices',
    description:
      'The Terms of Service and Privacy Policy versions you accepted and when, and every cookie choice you made (a random browser ID, the choices, the notice versions, language and region; no IP address).',
    tables: ['PolicyAcceptances', 'CookieConsents'],
    purpose: 'Showing what you agreed to and the cookie choices you made.',
    legalBasis: ['legalObligation', 'contract'],
    source: 'You.',
    storage: HOSTING,
    retention: 'Policy acceptances while your account is open; cookie choices 3 years after each choice.',
    recipients: [HOSTING],
    personalData: true,
    access: true,
    portable: false,
    erasure: 'retained',
    retainedReason: 'Cookie choice records are evidence of consent; after Delete My Account they’re no longer linked to your account.',
  },
  {
    key: 'privacyRequests',
    title: 'Your privacy requests',
    description: 'The privacy requests you made, their history and outcome, and generated data exports until they expire.',
    tables: ['PrivacyRequests', 'PrivacyRequestEvents', 'PrivacyJobs', 'PrivacyExports', 'PrivacyVerifications', 'ErasureLedger'],
    purpose: 'Answering your requests and showing that we did.',
    legalBasis: ['legalObligation'],
    source: 'You, and Admins handling the request.',
    storage: `${HOSTING}; exports in Cloudflare R2 object storage when configured`,
    retention: 'Exports 72 hours. Request records 3 years after the request closes, to show how it was handled.',
    recipients: [HOSTING, 'Cloudflare (export files, when object storage is configured)', 'Resend (emails about the request)'],
    personalData: true,
    access: true,
    portable: false,
    erasure: 'retained',
    retainedReason: 'Kept to show how each request was handled; after Delete My Account the email address is removed from it.',
  },
  {
    key: 'uploadsAsCoach',
    title: 'Content you uploaded as a Coach or Admin',
    description: 'Expert Laps, broadcast videos and engine sounds record which account uploaded them.',
    tables: ['ExpertLaps', 'BroadcastVideos', 'EngineAudioAssets', 'SiteSettings', 'RateLimitOverrides'],
    purpose: 'Coaching content shared with every user, and the site’s settings.',
    legalBasis: ['legitimateInterests'],
    source: 'You, as a Coach or Admin.',
    storage: `${HOSTING}; Cloudflare R2 (videos and sounds)`,
    retention: 'While the content is used; the link to your account is removed when it’s deleted.',
    recipients: [HOSTING, 'Cloudflare'],
    personalData: 'pseudonymous',
    access: false,
    portable: false,
    erasure: 'accountDeletion',
  },
  {
    key: 'backups',
    title: 'Database backups and server logs',
    description:
      'Copies of the database kept by the hosting provider for disaster recovery, and the web server’s own error logs (which never contain lap data or form text).',
    tables: [],
    purpose: 'Recovering from failures and keeping the service secure.',
    legalBasis: ['legitimateInterests'],
    source: 'Everything above.',
    storage: HOSTING,
    retention: 'Under the hosting provider’s backup schedule. Deletions are re-applied before restored data is used (docs/privacy-requests.md).',
    recipients: [HOSTING],
    personalData: true,
    access: false,
    portable: false,
    erasure: 'retained',
    retainedReason: 'Backups can’t be edited; deleted accounts are deleted again from any restored copy before it’s used.',
  },
];

// The racingcoach tables that hold no user's personal data (shared reference data, or per-browser data without an
// account), so the inventory guard in scripts/privacy-rights.test.mjs knows they weren't forgotten
export const NON_PERSONAL_TABLES = [
  'Tracks',
  'TrackFocusAreas',
  'TracksNumberOfCorners',
  'Cars',
  'SimulatorTracks',
  'SimulatorCars',
  'LapRetentionRuns',
  'BroadcastVideoHistory',
  'BroadcastDirectorEvents',
  'TelemetryStorageCounters',
  'TelemetryStorageRuns',
];

export const LEGAL_BASIS_TEXT: Record<LegalBasis, string> = {
  contract: 'Performance of a contract (Article 6(1)(b))',
  legitimateInterests: 'Legitimate interests (Article 6(1)(f)); you can object',
  consent: 'Consent (Article 6(1)(a)); you can withdraw it at any time',
  legalObligation: 'Legal obligation (Article 6(1)(c))',
};

// The rest of what Article 15(1) and (2) say the requester is told
export const ARTICLE_15_NOTES = {
  controller: 'Clarivex, LLC (Kentucky, United States), operating RacingCoach.app. Contact: support@racingcoach.app.',
  transfers:
    'RacingCoach.app is operated from the United States and its database is hosted there, so information from the EEA, the UK and Switzerland is transferred to the United States. AI and speech providers may process it in the United States or, for DeepSeek models, the People’s Republic of China. The safeguards relied on are described in the Privacy Policy, Section 12; ask us for a copy.',
  automatedDecisions:
    'No decision producing legal or similarly significant effects is made about you by automated means alone (Article 22). AI coaching gives suggestions you can ignore; rate limits and membership levels follow fixed published rules.',
  rights:
    'You can ask for access, rectification, erasure, restriction, portability, and object to processing based on legitimate interests; withdraw consent at any time without affecting earlier processing; and complain to the data protection supervisory authority where you live or work.',
} as const;
