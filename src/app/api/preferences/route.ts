import { NextResponse } from 'next/server';
import { isCountry } from '@/lib/countryCodes';
import { MAX_NAME_PRONUNCIATION, setNamePronunciation } from '@/lib/raceAnnouncer';
import { isLanguage } from '@/lib/i18n/languages';
import { setLanguageCookie } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';
import { isTheme } from '@/lib/theme';
import { setThemeCookie } from '@/lib/themeServer';
import { isUnits } from '@/lib/units';
import { setUnitsCookie } from '@/lib/unitsServer';
import { setCountry, setPreferredLanguage, setTheme, setUnits } from '@/lib/users';
import { apiText } from '@/lib/i18n/server';

// Saves the Preferred Language, the Preferred Units (Standard / Metric) or the theme (Dark Mode / Light
// Mode): in the signed-in user's account (racingcoach."Users".preferred_language / units / theme) and in a
// cookie, which is all a visitor has. A new language or units reloads the page in them; a new theme is
// already showing in the browser. Also the Country ("Users".country; null is Not Specified) and the Name Pronunciation
// ("Users".name_pronunciation, how the Race Announcers say the user's name; empty for the name as written), in the account only.
// ("Play beeps before braking" and its volume are set in the telemetry collector, with PUT /api/collector/brake-beeps.)
export async function PUT(request: Request) {
  const t = await apiText();
  const body = (await request.json().catch(() => null)) ?? {};

  // Only ever the signed-in user's: a visitor picks one on the Create an Account page, which sends it when signing up
  if (typeof body === 'object' && 'country' in body) {
    const country = body.country;
    if (country !== null && !isCountry(country)) {
      return NextResponse.json({ error: t.unknownCountry }, { status: 400 });
    }
    try {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: t.logInProfile }, { status: 401 });
      await setCountry(user.id, country);
      return NextResponse.json({ country });
    } catch (error) {
      console.error('Country error:', error);
      return NextResponse.json({ error: t.failedSaveCountry }, { status: 500 });
    }
  }

  if (typeof body === 'object' && 'namePronunciation' in body) {
    if (typeof body.namePronunciation !== 'string') {
      return NextResponse.json({ error: t.failedSaveNamePronunciation }, { status: 400 });
    }
    const namePronunciation = body.namePronunciation.trim();
    if (namePronunciation.length > MAX_NAME_PRONUNCIATION) {
      return NextResponse.json({ error: t.namePronunciationTooLong }, { status: 400 });
    }
    try {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: t.logInProfile }, { status: 401 });
      await setNamePronunciation(user.id, namePronunciation);
      return NextResponse.json({ namePronunciation });
    } catch (error) {
      console.error('Name pronunciation error:', error);
      return NextResponse.json({ error: t.failedSaveNamePronunciation }, { status: 500 });
    }
  }

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
