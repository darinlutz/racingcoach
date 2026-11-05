import { NextResponse } from 'next/server';
import { ABUSE_LIMITS, checkFormGuard, ipKey, limitReached, recordAttempt } from '@/lib/abuseGuards';
import { cleanCountry } from '@/lib/countryCodes';
import { DEFAULT_LANGUAGE, fmt, isLanguage } from '@/lib/i18n/languages';
import { setLanguageCookie } from '@/lib/i18n/server';
import { notifyOwner } from '@/lib/ownerNotifications';
import { isCurrentPolicyVersions, POLICY_VERSIONS } from '@/lib/policyVersions';
import { cleanPromoCode } from '@/lib/promoCode';
import { createSession } from '@/lib/session';
import { createUser, EmailTakenError } from '@/lib/users';
import { apiText } from '@/lib/i18n/server';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 100;

// Creates an account from a name, email address, password, Preferred Language, Country and optional promo code, recording that it accepted the
// Terms of Service and Privacy Policy versions in acceptedPolicies. iRacePlan is connected later, from the
// My Race Trends page (/api/race-trends/connection). At most 5 accounts an hour per IP address, and the form's trap field
// and fill time (formTrap, formMs) keep out bots (src/lib/abuseGuards.ts).
export async function POST(request: Request) {
  const t = await apiText();
  try {
    const body = await request.json().catch(() => ({}));
    const userName = typeof body.userName === 'string' ? body.userName.trim() : '';
    const emailAddress = typeof body.emailAddress === 'string' ? body.emailAddress.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const preferredLanguage = isLanguage(body.preferredLanguage) ? body.preferredLanguage : DEFAULT_LANGUAGE;
    const promoCode = cleanPromoCode(body.promoCode);
    const country = cleanCountry(body.country);

    if (!userName || !emailAddress || !password) {
      return NextResponse.json({ error: t.allFieldsRequired }, { status: 400 });
    }
    if (userName.length > MAX_NAME_LENGTH) {
      return NextResponse.json({ error: fmt(t.nameTooLong, { max: MAX_NAME_LENGTH }) }, { status: 400 });
    }
    if (!EMAIL_REGEX.test(emailAddress)) {
      return NextResponse.json({ error: t.invalidEmail }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: t.passwordTooShort }, { status: 400 });
    }

    // The form sends the policy versions it showed; a page loaded before a policy changed must be reloaded first
    if (!isCurrentPolicyVersions(body.acceptedPolicies)) {
      return NextResponse.json({ error: t.policiesChanged }, { status: 409 });
    }

    const guard = checkFormGuard(body);
    if (guard === 'trap') return NextResponse.json({ error: t.failedCreateAccount }, { status: 400 });
    if (guard === 'tooFast') return NextResponse.json({ error: t.formTooFast }, { status: 400 });
    const ip = `signup-ip:${ipKey(request)}`;
    if (limitReached(ip, ABUSE_LIMITS.signupPerIp)) {
      return NextResponse.json({ error: t.tooManyAttempts }, { status: 429 });
    }

    const user = await createUser({
      userName,
      emailAddress,
      password,
      preferredLanguage,
      country,
      promoCode,
      acceptedPolicies: { ...POLICY_VERSIONS },
    });
    recordAttempt(ip);
    await createSession(user.id);
    await setLanguageCookie(preferredLanguage);
    await notifyOwner('signup', user.emailAddress);
    return NextResponse.json({ user: { userName: user.userName } }, { status: 201 });
  } catch (error) {
    if (error instanceof EmailTakenError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Signup error:', error);
    return NextResponse.json({ error: t.failedCreateAccount }, { status: 500 });
  }
}
