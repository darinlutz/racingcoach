// Data subject rights (GDPR Articles 12-22): the privacy request types, statuses, the transitions between them and
// their deadlines. Pure, with no imports, so scripts/privacy-rights.test.mjs runs it directly and client components
// can import it. The database side is privacyRequests.ts; what's held about a user is personalDataInventory.ts.

// What a request asks for. account_deletion is recorded by Delete My Account itself (it runs at once); the others are
// submitted from Privacy & Data Rights (/account/privacy) or, by someone without an account, /privacy-request.
export const REQUEST_TYPES = [
  'access', // Article 15: a copy of the personal data and the information about its processing
  'portability', // Article 20: the data the user provided, in a machine-readable format
  'rectification', // Article 16: correcting what can't be edited in My Settings
  'erasure', // Article 17: deleting chosen categories while keeping the account
  'account_deletion', // Article 17: Delete My Account
  'restriction', // Article 18
  'objection', // Article 21
  'other', // anything else, e.g. a question about transfers or a complaint
] as const;

export type RequestType = (typeof REQUEST_TYPES)[number];

export const isRequestType = (value: unknown): value is RequestType => REQUEST_TYPES.includes(value as RequestType);

// The types a requester can submit themselves (account_deletion has its own button)
export const SUBMITTABLE_TYPES: readonly RequestType[] = REQUEST_TYPES.filter((type) => type !== 'account_deletion');

export const REQUEST_STATUSES = [
  'pending_verification', // Pending Verification: someone without a session hasn't confirmed their email address yet
  'submitted', // Submitted
  'in_review', // In Review: an Admin is assessing it
  'processing', // Processing: an export or deletion job is running, or an Admin is carrying it out
  'completed', // Completed
  'rejected', // Rejected, always with a documented reason
  'extended', // Extended: the deadline moved by up to two more months (Article 12(3)), with the requester told why
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const isRequestStatus = (value: unknown): value is RequestStatus =>
  REQUEST_STATUSES.includes(value as RequestStatus);

export const CLOSED_STATUSES: readonly RequestStatus[] = ['completed', 'rejected'];

export const isClosed = (status: RequestStatus) => CLOSED_STATUSES.includes(status);

// Where each status can go. Completed and Rejected are final: an appeal is a new request, so the record of the first
// decision stays as it was.
const TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  pending_verification: ['submitted', 'rejected'],
  submitted: ['in_review', 'processing', 'completed', 'rejected', 'extended'],
  in_review: ['processing', 'completed', 'rejected', 'extended'],
  processing: ['in_review', 'completed', 'rejected', 'extended'],
  extended: ['in_review', 'processing', 'completed', 'rejected'],
  completed: [],
  rejected: [],
};

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export const nextStatuses = (from: RequestStatus): readonly RequestStatus[] => TRANSITIONS[from];

// Transitions that need a reason recorded with them: a refusal must be explained to the requester (Article 12(4)),
// and so must an extension (Article 12(3))
export const needsReason = (to: RequestStatus) => to === 'rejected' || to === 'extended';

export type VerificationStatus = 'unverified' | 'verified' | 'failed';

// How the requester's identity was checked: a signed-in session, a session that re-entered its password or an
// emailed code just now (reauth), a link sent to the email address given (email), or by an Admin (manual)
export type VerificationMethod = 'session' | 'reauth' | 'email' | 'manual';

// The answer is due one month after the request is received, and can be extended by two further months (Article
// 12(3)). A month runs to the same date of the next month, or that month's last day when it has no such date
// (Regulation 1182/71, Article 3(2)(c)), so a request received on January 31 is due on February 28 (29). We count
// from receipt, not from when identity is confirmed, which is the stricter reading (see docs/privacy-requests.md).
export function addCalendarMonths(from: Date, months: number): Date {
  const result = new Date(from.getTime());
  const day = from.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export const RESPONSE_MONTHS = 1;
export const EXTENSION_MONTHS = 2;

export function dueDate(receivedAt: Date): Date {
  return addCalendarMonths(receivedAt, RESPONSE_MONTHS);
}

export function extendedDueDate(receivedAt: Date): Date {
  return addCalendarMonths(receivedAt, RESPONSE_MONTHS + EXTENSION_MONTHS);
}

// An extension must be decided, and the requester told, within the first month; and only once
export function canExtend(request: { status: RequestStatus; dueAt: Date; extendedDueAt: Date | null }, now: Date): boolean {
  return canTransition(request.status, 'extended') && request.extendedDueAt === null && now.getTime() <= request.dueAt.getTime();
}

// The deadline that applies now
export const currentDeadline = (request: { dueAt: Date; extendedDueAt: Date | null }): Date =>
  request.extendedDueAt ?? request.dueAt;

const DAY_MS = 24 * 60 * 60 * 1000;

// Whole days left until the deadline (negative once it's passed), for the Admin page's warnings
export function daysLeft(deadline: Date, now: Date): number {
  return Math.floor((deadline.getTime() - now.getTime()) / DAY_MS);
}

// An open request within this many days of its deadline is shown as due soon
export const DUE_SOON_DAYS = 7;

export type DeadlineState = 'closed' | 'overdue' | 'dueSoon' | 'onTrack';

export function deadlineState(
  request: { status: RequestStatus; dueAt: Date; extendedDueAt: Date | null },
  now: Date
): DeadlineState {
  if (isClosed(request.status)) return 'closed';
  const left = currentDeadline(request).getTime() - now.getTime();
  if (left < 0) return 'overdue';
  return left <= DUE_SOON_DAYS * DAY_MS ? 'dueSoon' : 'onTrack';
}

// The categories Request Data Deletion offers while keeping the account. "automatic" ones are the user's own content
// and settings, deleted by a job as soon as the request is submitted; "review" ones are also kept for security or
// abuse prevention (legitimate interests), so an Admin weighs the request first (Article 17(1)(c) and 21(1)).
// What can't be deleted while the account stays (the account itself, billing records, consent and policy records)
// is described by personalDataInventory.ts.
export const ERASABLE_CATEGORIES = [
  'laps',
  'debriefs',
  'raceResults',
  'targetLap',
  'profilePicture',
  'coachSettings',
  'friends',
  'connections',
  'devices',
  'collectorLogs',
  'activityLog',
  'aiUsage',
] as const;

export type ErasableCategory = (typeof ERASABLE_CATEGORIES)[number];

export const isErasableCategory = (value: unknown): value is ErasableCategory =>
  ERASABLE_CATEGORIES.includes(value as ErasableCategory);

export const REVIEWED_CATEGORIES: readonly ErasableCategory[] = ['activityLog', 'aiUsage'];

export const needsReview = (category: ErasableCategory) => REVIEWED_CATEGORIES.includes(category);

// The list of categories a request names, cleaned: known names only, each once, in ERASABLE_CATEGORIES order
export function cleanCategories(value: unknown): ErasableCategory[] {
  if (!Array.isArray(value)) return [];
  const chosen = new Set(value.filter(isErasableCategory));
  return ERASABLE_CATEGORIES.filter((category) => chosen.has(category));
}

// What Download My Data makes: every category for access (Article 15), only the data the user provided or that was
// observed from their use, processed on contract or consent, for portability (Article 20)
export type ExportKind = 'access' | 'portability';

// A generated export can be downloaded for this long, then it's deleted
export const EXPORT_TTL_HOURS = 72;

// A step-up sign-in (password or emailed code) lets destructive and export actions through for this long
export const REAUTH_WINDOW_MS = 10 * 60 * 1000;

// Limits on what a requester can do, per account or per email address and IP
export const MAX_OPEN_REQUESTS = 10;
export const MAX_EXPORTS_PER_DAY = 3;
export const MAX_DETAILS_LENGTH = 5000;

// A short reference the requester can quote, from the request's UUID (e.g. PR-3F9A2C1B)
export const requestReference = (id: string) => `PR-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
