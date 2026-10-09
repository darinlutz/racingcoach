import { NextResponse } from 'next/server';
import { createPasswordResetToken } from '@/lib/passwordReset';
import { getPublicSiteUrl } from '@/lib/siteOrigin';
import { getUserByEmail } from '@/lib/users';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const emailAddress = typeof body.emailAddress === 'string' ? body.emailAddress.trim().toLowerCase() : '';

    if (!emailAddress) {
      return NextResponse.json({ error: 'Email address is required' }, { status: 400 });
    }
    if (!EMAIL_REGEX.test(emailAddress)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    // Check if Resend API key is configured
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.error('Resend API key not configured. Password reset email disabled.');
      return NextResponse.json({ error: 'Email service is not configured' }, { status: 500 });
    }

    const user = await getUserByEmail(emailAddress);
    if (!user) {
      return NextResponse.json({ error: 'Email address not found' }, { status: 404 });
    }

    // SITE_URL pins the link to the real domain so a forged Host header can't
    // send the reset token somewhere else; locally it falls back to the request.
    const siteUrl = getPublicSiteUrl(request);
    const token = await createPasswordResetToken(user.id);
    const resetUrl = `${siteUrl}/reset-password?token=${token}`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
        to: user.emailAddress,
        subject: 'Reset your RacingCoach password',
        html: `
          <div style="font-family: Arial, sans-serif; background-color: #0f172a; color: #f1f5f9; padding: 20px;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #1e293b; border: 1px solid #87ceeb; border-radius: 8px; padding: 20px;">
              <h2 style="color: #87ceeb; margin-bottom: 20px;">Reset Your Password</h2>
              <p style="color: #e2e8f0;">We received a request to reset the password for your RacingCoach account.</p>
              <p style="margin: 24px 0;">
                <a href="${resetUrl}" style="display: inline-block; background-color: #87ceeb; color: #0f172a; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">
                  Reset Password
                </a>
              </p>
              <p style="color: #e2e8f0;">This link expires in 1 hour and can only be used once.</p>
              <hr style="border: none; border-top: 1px solid #087cea; margin: 20px 0;">
              <p style="font-size: 12px; color: #64748b;">
                If you didn't request this, you can ignore this email. Your password won't change.
              </p>
            </div>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('Resend API error:', error);
      return NextResponse.json({ error: 'Failed to send reset email' }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json({ error: 'Failed to process your request' }, { status: 500 });
  }
}
