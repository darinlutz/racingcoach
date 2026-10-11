import { NextResponse } from 'next/server';
import { DEFAULT_LANGUAGE, fmt, isLanguage } from '@/lib/i18n/languages';
import { setLanguageCookie } from '@/lib/i18n/server';
import { notifyOwner } from '@/lib/ownerNotifications';
import { createSession } from '@/lib/session';
import { createUser, EmailTakenError } from '@/lib/users';
import { apiText } from '@/lib/i18n/server';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 100;

// Creates an account from a name, email address, password and Preferred Language. iRacePlan is connected later, from the
// My Race Trends page (/api/race-trends/connection).
export async function POST(request: Request) {
  const t = await apiText();
  try {
    const body = await request.json().catch(() => ({}));
    const userName = typeof body.userName === 'string' ? body.userName.trim() : '';
    const emailAddress = typeof body.emailAddress === 'string' ? body.emailAddress.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const preferredLanguage = isLanguage(body.preferredLanguage) ? body.preferredLanguage : DEFAULT_LANGUAGE;

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

    const user = await createUser({ userName, emailAddress, password, preferredLanguage });
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
