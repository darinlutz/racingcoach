import { NextResponse } from 'next/server';
import { isCoachVoice, isSpanishAccent, setCoachVoice, setSpanishAccent } from '@/lib/coachVoice';
import { apiText } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';

// The Account page's Coach voice: the Chirp 3 HD voice the signed-in user's In-Car AI Coach speaks with
// (racingcoach."Users".coach_voice), and its accent for Spanish (coach_spanish_accent).
// Body: { voice } (one of COACH_VOICES in src/lib/coachVoice.ts) or { spanishAccent } (one of SPANISH_ACCENTS).
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInInCarInstructions }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    if (body.spanishAccent !== undefined) {
      if (!isSpanishAccent(body.spanishAccent)) {
        return NextResponse.json({ error: t.unknownSpanishAccent }, { status: 400 });
      }
      await setSpanishAccent(user.id, body.spanishAccent);
      return NextResponse.json({ spanishAccent: body.spanishAccent });
    }
    if (!isCoachVoice(body.voice)) {
      return NextResponse.json({ error: t.unknownCoachVoice }, { status: 400 });
    }
    await setCoachVoice(user.id, body.voice);
    return NextResponse.json({ voice: body.voice });
  } catch (error) {
    console.error('Coach voice error:', error);
    return NextResponse.json({ error: t.failedSaveCoachVoice }, { status: 500 });
  }
}
