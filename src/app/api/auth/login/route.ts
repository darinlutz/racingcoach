import { NextResponse } from 'next/server';
import { ABUSE_LIMITS, clearAttempts, ipKey, limitReached, recordAttempt } from '@/lib/abuseGuards';
import { createSession } from '@/lib/session';
import { authenticateUser } from '@/lib/users';
import { JSON_BODY_LIMIT, readJsonLimited } from '@/lib/requestBody';
import { apiText } from '@/lib/i18n/server';

// After 10 failed logins in 15 minutes from one IP address, or for one email address, the next are refused until
// the oldest are 15 minutes old (src/lib/abuseGuards.ts), so passwords can't be guessed at speed.
export async function POST(request: Request) {
  const t = await apiText();
  try {
    const body = await readJsonLimited(request, JSON_BODY_LIMIT).catch(() => ({}));
    const emailAddress = typeof body.emailAddress === 'string' ? body.emailAddress.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!emailAddress || !password) {
      return NextResponse.json({ error: t.emailPasswordRequired }, { status: 400 });
    }

    const ip = `login-ip:${ipKey(request)}`;
    const email = `login-email:${emailAddress}`;
    if (limitReached(ip, ABUSE_LIMITS.loginFailuresPerIp) || limitReached(email, ABUSE_LIMITS.loginFailuresPerEmail)) {
      return NextResponse.json({ error: t.tooManyAttempts }, { status: 429 });
    }

    const user = await authenticateUser(emailAddress, password);
    if (!user) {
      recordAttempt(ip);
      recordAttempt(email);
      return NextResponse.json({ error: t.invalidLogin }, { status: 401 });
    }
    clearAttempts(email);

    await createSession(user.id);
    return NextResponse.json({ user: { userName: user.userName } });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: t.failedLogIn }, { status: 500 });
  }
}
