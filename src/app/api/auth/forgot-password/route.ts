import { NextResponse } from 'next/server';
import { ABUSE_LIMITS, ipKey, limitReached, recordAttempt } from '@/lib/abuseGuards';
import { createPasswordResetToken } from '@/lib/passwordReset';
import { getPublicSiteUrl } from '@/lib/siteOrigin';
import { getUserByEmail } from '@/lib/users';
import { JSON_BODY_LIMIT, readJsonLimited } from '@/lib/requestBody';
import { apiText, getDictionary } from '@/lib/i18n/server';
import { renderEmail } from '@/lib/emailLayout';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// At most 10 requests an hour per IP address (then 429), and 3 reset emails an hour per address: past that it
// answers as if sent and sends nothing, so it can't be used to flood someone's inbox (src/lib/abuseGuards.ts).
export async function POST(request: Request) {
  const t = await apiText();
  try {
    const body = await readJsonLimited(request, JSON_BODY_LIMIT).catch(() => ({}));
    const emailAddress = typeof body.emailAddress === 'string' ? body.emailAddress.trim().toLowerCase() : '';

    if (!emailAddress) {
      return NextResponse.json({ error: t.emailRequired }, { status: 400 });
    }
    if (!EMAIL_REGEX.test(emailAddress)) {
      return NextResponse.json({ error: t.invalidEmail }, { status: 400 });
    }

    // Check if Resend API key is configured
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.error('Resend API key not configured. Password reset email disabled.');
      return NextResponse.json({ error: t.notConfigured }, { status: 500 });
    }

    const ip = `reset-ip:${ipKey(request)}`;
    if (limitReached(ip, ABUSE_LIMITS.resetPerIp)) {
      return NextResponse.json({ error: t.tooManyAttempts }, { status: 429 });
    }
    recordAttempt(ip);

    const user = await getUserByEmail(emailAddress);
    if (!user) {
      return NextResponse.json({ error: t.emailNotFound }, { status: 404 });
    }
    const email = `reset-email:${emailAddress}`;
    if (limitReached(email, ABUSE_LIMITS.resetPerEmail)) {
      return NextResponse.json({ success: true });
    }
    recordAttempt(email);

    // SITE_URL pins the link to the real domain so a forged Host header can't
    // send the reset token somewhere else; locally it falls back to the request.
    const siteUrl = getPublicSiteUrl(request);
    const token = await createPasswordResetToken(user.id);
    const resetUrl = `${siteUrl}/reset-password?token=${token}`;

    // In the account's own language, like the email address confirmation (src/lib/emailLayout.ts)
    const words = getDictionary(user.preferredLanguage).passwordResetEmail;
    const { html, text } = renderEmail({
      siteUrl,
      language: user.preferredLanguage,
      subject: words.subject,
      heading: words.heading,
      intro: [words.intro],
      button: { label: words.button, url: resetUrl },
      note: words.expires,
      linkFallback: words.linkFallback,
      footnote: words.ignore,
    });
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendApiKey}`,
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
        to: user.emailAddress,
        subject: words.subject,
        text,
        html,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('Resend API error:', error);
      return NextResponse.json({ error: t.failedSendReset }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json({ error: t.failedRequest }, { status: 500 });
  }
}
