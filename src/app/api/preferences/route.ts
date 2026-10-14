import { NextResponse } from 'next/server';
import { isLanguage } from '@/lib/i18n/languages';
import { setLanguageCookie } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';
import { isTheme } from '@/lib/theme';
import { setThemeCookie } from '@/lib/themeServer';
import { isUnits } from '@/lib/units';
import { setUnitsCookie } from '@/lib/unitsServer';
import { setBrakeBeeps, setPreferredLanguage, setTheme, setUnits } from '@/lib/users';
import { apiText } from '@/lib/i18n/server';

// Saves the Preferred Language, the Preferred Units (Standard / Metric) or the theme (Dark Mode / Light
// Mode): in the signed-in user's account (racingcoach."Users".preferred_language / units / theme) and in a
// cookie, which is all a visitor has. Also "Play beeps before braking" ({ brakeBeeps }, "Users".brake_beeps),
// account only. A new language or units reloads the page in them; a new theme is
// already showing in the browser.
export async function PUT(request: Request) {
  const t = await apiText();
  const body = (await request.json().catch(() => null)) ?? {};

  if (typeof body === 'object' && 'units' in body) {
    const units = body.units;
    if (!isUnits(units)) {
      return NextResponse.json({ error: t.unknownUnits }, { status: 400 });
    }
    try {
      const user = await getCurrentUser();
      if (user) await setUnits(user.id, units);
      await setUnitsCookie(units);
      return NextResponse.json({ units });
    } catch (error) {
      console.error('Units error:', error);
      return NextResponse.json({ error: t.failedSaveUnits }, { status: 500 });
    }
  }

  // "Play beeps before braking" is only in the account (the collector reads it with the upload key), so it
  // needs a signed-in user and has no cookie
  if (typeof body === 'object' && 'brakeBeeps' in body) {
    const brakeBeeps = body.brakeBeeps;
    if (typeof brakeBeeps !== 'boolean') {
      return NextResponse.json({ error: t.unknownBrakeBeeps }, { status: 400 });
    }
    try {
      const user = await getCurrentUser();
      if (!user) {
        return NextResponse.json({ error: t.logInBrakeBeeps }, { status: 401 });
      }
      await setBrakeBeeps(user.id, brakeBeeps);
      return NextResponse.json({ brakeBeeps });
    } catch (error) {
      console.error('Brake beeps error:', error);
      return NextResponse.json({ error: t.failedSaveBrakeBeeps }, { status: 500 });
    }
  }

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
