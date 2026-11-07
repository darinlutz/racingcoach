import { createHash, randomBytes } from 'node:crypto';
import { query, transaction } from './db';
import { ensureUserSchema, markEmailVerified, type User } from './users';

// Confirming a new account's email address. Signing up sends a link (sendVerificationEmail); opening it
// (GET /api/auth/verify-email?token=) marks the address confirmed (markEmailVerified). Until then the account can sign
// in and look around, but its AI features, upload key, checkout and the owner's address privileges wait for it, so an
// address nobody controls can't run up AI bills or claim anything (docs/launch-readiness-audit-2026-11-07.md, F-05).
// Accounts from before this existed count as confirmed. Only a hash of each token is stored, like PasswordResets.

const VERIFY_TTL_MS = 3 * 24 * 60 * 60 * 1000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// A new link for the user; earlier ones stop working
export async function createEmailVerificationToken(userId: number): Promise<string> {
  await ensureUserSchema();
  const token = randomBytes(32).toString('hex');
  await transaction(async (client) => {
    await client.query('DELETE FROM racingcoach."EmailVerifications" WHERE user_id = $1', [userId]);
    await client.query(
      'INSERT INTO racingcoach."EmailVerifications" (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
      [hashToken(token), userId, new Date(Date.now() + VERIFY_TTL_MS)]
    );
  });
  return token;
}

// The account a link confirms, now marked confirmed; null for an unknown, used or expired link. A link can only be
// used once: it's deleted as it's read.
export async function verifyEmailToken(token: string): Promise<User | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  await ensureUserSchema();
  const [row] = await query<{ user_id: number }>(
    `DELETE FROM racingcoach."EmailVerifications" WHERE token_hash = $1 AND expires_at > now() RETURNING user_id`,
    [hashToken(token)]
  );
  return row ? markEmailVerified(Number(row.user_id)) : null;
}

// Emails the link, in the user's language. False when it couldn't be sent (the banner's Resend button tries again)
export async function sendVerificationEmail(user: User, siteUrl: string): Promise<boolean> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.error('Resend API key not configured. Verification email not sent for user', user.id);
    return false;
  }
  // Loaded here rather than at the top so the rest of this file runs without Next (the database tests)
  const { getDictionary } = await import('./i18n/server');
  const t = getDictionary(user.preferredLanguage).emailVerification;
  const link = `${siteUrl}/api/auth/verify-email?token=${await createEmailVerificationToken(user.id)}`;
  const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendApiKey}` },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
        to: user.emailAddress,
        subject: t.emailSubject,
        text: `${t.emailIntro}\n\n${link}\n\n${t.emailExpires}\n\n${t.emailIgnore}`,
        html: `
          <div style="font-family: Arial, sans-serif; background-color: #0f172a; color: #f1f5f9; padding: 20px;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #1e293b; border: 1px solid #87ceeb; border-radius: 8px; padding: 20px;">
              <h2 style="color: #87ceeb; margin-bottom: 20px;">${escape(t.emailHeading)}</h2>
              <p style="color: #e2e8f0;">${escape(t.emailIntro)}</p>
              <p style="margin: 24px 0;">
                <a href="${link}" style="display: inline-block; background-color: #87ceeb; color: #0f172a; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">${escape(t.emailButton)}</a>
              </p>
              <p style="color: #e2e8f0;">${escape(t.emailExpires)}</p>
              <hr style="border: none; border-top: 1px solid #087cea; margin: 20px 0;">
              <p style="font-size: 12px; color: #64748b;">${escape(t.emailIgnore)}</p>
            </div>
          </div>`,
      }),
    });
    if (!response.ok) {
      console.error('Resend API error (verification email):', await response.json().catch(() => ({})));
      return false;
    }
    return true;
  } catch (error) {
    console.error('Verification email error:', error);
    return false;
  }
}
