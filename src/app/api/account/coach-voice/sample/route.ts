import { NextResponse } from 'next/server';
import { isCoachVoice, synthesizeSpeech } from '@/lib/coachVoice';
import { apiText, getDictionary } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';

// The Account page's Listen button: a sample callout (the dictionary's inCarCoach.sample) in a coach voice and the
// signed-in user's Preferred Language, as a WAV file. ?voice= one of COACH_VOICES in src/lib/coachVoice.ts.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInInCarInstructions }, { status: 401 });
    }
    const voice = new URL(request.url).searchParams.get('voice');
    if (!isCoachVoice(voice)) {
      return NextResponse.json({ error: t.unknownCoachVoice }, { status: 400 });
    }
    const audio = await synthesizeSpeech(getDictionary(user.preferredLanguage).inCarCoach.sample, voice, user.preferredLanguage);
    return new NextResponse(new Uint8Array(audio), {
      headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'private, max-age=86400' },
    });
  } catch (error) {
    console.error('Coach voice sample error:', error);
    return NextResponse.json({ error: t.failedCoachVoiceSample }, { status: 502 });
  }
}
