import { NextResponse } from 'next/server';
import { isLanguage } from '@/lib/i18n/languages';
import { setLanguageCookie } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';
import { setPreferredLanguage } from '@/lib/users';
import { apiText } from '@/lib/i18n/server';

// Saves the Preferred Language: in the signed-in user's account (racingcoach."Users".preferred_language)
// and in a cookie, which is all a visitor on the sign-up form has. The page then reloads in it.
export async function PUT(request: Request) {
  const t = await apiText();
  try {
    const body = await request.json().catch(() => ({}));
    const language = body.preferredLanguage;
    if (!isLanguage(language)) {
      return NextResponse.json({ error: t.unknownLanguage }, { status: 400 });
    }

    const user = await getCurrentUser();
    if (user) await setPreferredLanguage(user.id, language);
    await setLanguageCookie(language);
    return NextResponse.json({ preferredLanguage: language });
  } catch (error) {
    console.error('Preferred language error:', error);
    return NextResponse.json({ error: t.failedSaveLanguage }, { status: 500 });
  }
}
