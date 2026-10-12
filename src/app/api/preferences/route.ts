import { NextResponse } from 'next/server';
import { isLanguage } from '@/lib/i18n/languages';
import { setLanguageCookie } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';
import { isTheme } from '@/lib/theme';
import { setThemeCookie } from '@/lib/themeServer';
import { setPreferredLanguage, setTheme } from '@/lib/users';
import { apiText } from '@/lib/i18n/server';

// Saves the Preferred Language or the theme (Dark Mode / Light Mode): in the signed-in user's account
// (racingcoach."Users".preferred_language / theme) and in a cookie, which is all a visitor has. A new
// language reloads the page in it; a new theme is already showing in the browser.
export async function PUT(request: Request) {
  const t = await apiText();
  const body = (await request.json().catch(() => null)) ?? {};

  if (typeof body === 'object' && 'theme' in body) {
    const theme = body.theme;
    if (!isTheme(theme)) {
      return NextResponse.json({ error: t.unknownTheme }, { status: 400 });
    }
    try {
      const user = await getCurrentUser();
      if (user) await setTheme(user.id, theme);
      await setThemeCookie(theme);
      return NextResponse.json({ theme });
    } catch (error) {
      console.error('Theme error:', error);
      return NextResponse.json({ error: t.failedSaveTheme }, { status: 500 });
    }
  }

  try {
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
