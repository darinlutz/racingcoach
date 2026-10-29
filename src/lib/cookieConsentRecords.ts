import { query } from './db';
import type { ConsentAction, ConsentChoices, ConsentMethod } from './cookieConsent';
import type { ConsentRegion } from './consentRegion';
import { ensureUserSchema } from './users';

// The consent audit trail, racingcoach."CookieConsents" (created by ensureUserSchema): one row per choice made in the
// banner or preference center, never updated except to tie a browser's earlier rows to the account that later signs
// in on it (user_id and user_linked_at). Holds no IP address, user agent or precise location: the browser's
// pseudonymous ID (kept in the consent cookie), the account when known, what was chosen and what was shown (the
// Cookie Policy and banner versions and the language). Read only by the server; no page shows it. Rows are kept
// CONSENT_RECORD_RETENTION_DAYS (default 3 years) and then deleted, see purgeOldConsentRecords.

export const DEFAULT_CONSENT_RECORD_RETENTION_DAYS = 3 * 365;

export type ConsentRecord = {
  id: string;
  browserId: string;
  userId: number | null;
  action: ConsentAction;
  choices: ConsentChoices;
  cookiePolicyVersion: string;
  bannerVersion: string;
  purposesVersion: number;
  language: string;
  region: ConsentRegion;
  country: string | null;
  method: ConsentMethod;
};

export async function recordCookieConsent(record: ConsentRecord): Promise<void> {
  await ensureUserSchema();
  await query(
    `INSERT INTO racingcoach."CookieConsents"
       (id, browser_id, user_id, action, categories, cookie_policy_version, banner_version, purposes_version,
        notice_language, region, country, method)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      record.id,
      record.browserId,
      record.userId,
      record.action,
      JSON.stringify({ necessary: true, ...record.choices }),
      record.cookiePolicyVersion,
      record.bannerVersion,
      record.purposesVersion,
      record.language,
      record.region,
      record.country,
      record.method,
    ]
  );
}

// When someone signs in on a browser whose choices were made anonymously, those rows are tied to the account, so a
// data subject request finds them. It doesn't copy the choice to the account or to other browsers.
export async function linkConsentToUser(browserId: string, userId: number): Promise<void> {
  await ensureUserSchema();
  await query(
    `UPDATE racingcoach."CookieConsents" SET user_id = $1, user_linked_at = now()
     WHERE browser_id = $2 AND user_id IS NULL`,
    [userId, browserId]
  );
}

function retentionDays(): number {
  const days = Number(process.env.CONSENT_RECORD_RETENTION_DAYS);
  return Number.isInteger(days) && days >= 365 ? days : DEFAULT_CONSENT_RECORD_RETENTION_DAYS;
}

export async function purgeOldConsentRecords(): Promise<number> {
  await ensureUserSchema();
  const rows = await query<{ id: string }>(
    `DELETE FROM racingcoach."CookieConsents" WHERE recorded_at < now() - make_interval(days => $1) RETURNING id`,
    [retentionDays()]
  );
  return rows.length;
}

const PURGE_EVERY_MS = 24 * 60 * 60 * 1000;

// Started by src/instrumentation.ts: an hour after the server starts, then daily
export function startConsentRecordPurge(): void {
  const run = () =>
    purgeOldConsentRecords().catch((error) => console.error('Consent record purge error:', error));
  setTimeout(() => {
    void run();
    setInterval(() => void run(), PURGE_EVERY_MS).unref();
  }, 60 * 60 * 1000).unref();
}
