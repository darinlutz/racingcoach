import { NextResponse } from 'next/server';
import { DEFAULT_SPANISH_ACCENT, isCoachVoice, isSpanishAccent, synthesizeSpeech } from '@/lib/coachVoice';
import { apiText, getDictionary } from '@/lib/i18n/server';
import { fmt } from '@/lib/i18n/languages';
import { getCurrentUser } from '@/lib/session';
import { aiRateLimit, type AiRateLimit } from '@/lib/rateLimits';
import { distanceFromFeet } from '@/lib/units';

// The Account page's Listen button: a sample callout (the dictionary's inCarCoach.sample) in a coach voice and the
// signed-in user's Preferred Language and Units, as a WAV file. ?voice= one of COACH_VOICES in src/lib/coachVoice.ts,
// ?accent= one of SPANISH_ACCENTS for Spanish (the page also adds ?units= and ?language=, so the browser
// doesn't play a sample cached in the old units or language).
export async function GET(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  let limit: AiRateLimit | null = null;
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInInCarInstructions }, { status: 401 });
    }
    const params = new URL(request.url).searchParams;
    const voice = params.get('voice');
    if (!isCoachVoice(voice)) {
      return NextResponse.json({ error: t.unknownCoachVoice }, { status: 400 });
    }
    limit = await aiRateLimit(request, 'speech', user);
    if (limit.response) return limit.response;
    const accent = params.get('accent');
    const spanishAccent = isSpanishAccent(accent) ? accent : DEFAULT_SPANISH_ACCENT;
    // Distances in the user's Preferred Units: about 20 feet (6 meters) later, near 1230 feet (375 meters)
    const dictionary = getDictionary(user.preferredLanguage);
    const sample = fmt(dictionary.inCarCoach.sample, {
      later: Math.round(distanceFromFeet(20, user.units)),
      near: Math.round(distanceFromFeet(1230, user.units)),
      units: dictionary.preferences.distanceNames[user.units],
    });
    const audio = await synthesizeSpeech(sample, voice, user.preferredLanguage, spanishAccent);
    return new NextResponse(new Uint8Array(audio), {
      headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'private, max-age=86400' },
    });
  } catch (error) {
    console.error('Coach voice sample error:', error);
    await limit?.refund();
    return NextResponse.json({ error: t.failedCoachVoiceSample }, { status: 502 });
  }
}
