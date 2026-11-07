import { NextResponse } from 'next/server';
import { ABUSE_LIMITS, limitReached, recordAttempt } from '@/lib/abuseGuards';
import { sendVerificationEmail, verifyEmailToken } from '@/lib/emailVerification';
import { getDictionary } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';
import { getPublicSiteUrl } from '@/lib/siteOrigin';

// Email address confirmation (src/lib/emailVerification.ts).
// GET ?token=: the link in the email. Confirms the address and goes to the Account page (?emailVerified=1), or to Log
// In (?emailVerified=invalid) for a link that's unknown, used or expired. No sign-in needed: the token is the proof.
// POST: the banner's Resend Link, for the signed-in user whose address isn't confirmed yet. Answers { sent: true }.
export async function GET(request: Request) {
  const siteUrl = getPublicSiteUrl(request);
  try {
    const token = new URL(request.url).searchParams.get('token') ?? '';
    const user = await verifyEmailToken(token);
    if (!user) return NextResponse.redirect(`${siteUrl}/login?emailVerified=invalid`, 303);
    console.log(`Email address confirmed for user ${user.id}`);
    return NextResponse.redirect(`${siteUrl}/account?emailVerified=1`, 303);
  } catch (error) {
    console.error('Email verification error:', error);
    return NextResponse.redirect(`${siteUrl}/login?emailVerified=invalid`, 303);
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const t = getDictionary(user.preferredLanguage).emailVerification;
  try {
    if (user.emailVerified) return NextResponse.json({ sent: false, verified: true });
    const key = `verify-email:${user.id}`;
    if (limitReached(key, ABUSE_LIMITS.verifyEmailPerUser)) {
      return NextResponse.json({ error: t.tooMany }, { status: 429 });
    }
    recordAttempt(key);
    if (!(await sendVerificationEmail(user, getPublicSiteUrl(request)))) {
      return NextResponse.json({ error: t.sendFailed }, { status: 502 });
    }
    return NextResponse.json({ sent: true });
  } catch (error) {
    console.error('Resend verification email error:', error);
    return NextResponse.json({ error: t.sendFailed }, { status: 500 });
  }
}
