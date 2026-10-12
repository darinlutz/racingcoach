import { NextResponse } from 'next/server';
import { isCoachVoice, setCoachVoice } from '@/lib/coachVoice';
import { apiText } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';

// The Account page's Coach voice: the OpenAI voice the signed-in user's In-Car AI Coach speaks with
// (racingcoach."Users".coach_voice). Body: { voice } (one of COACH_VOICES in src/lib/coachVoice.ts).
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInInCarInstructions }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
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
