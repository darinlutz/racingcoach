import { NextResponse } from 'next/server';
import { engineerVoicesFor, getCoachVoice, isCoachVoice, isEngineerSpeaker, setEngineerVoice } from '@/lib/coachVoice';
import { apiText } from '@/lib/i18n/server';
import { JSON_BODY_LIMIT, readJsonLimited } from '@/lib/requestBody';
import { canUseInCarCoach } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { getEnableAiFeatures } from '@/lib/siteSettings';

// The Account page's Setup Engineer and Race Strategist voices (engineer voices in src/lib/coachVoice.ts), saved for
// the signed-in user only. Body: { speaker: 'setupEngineer' | 'raceStrategist', voice } (one of engineerVoicesFor the
// user's language and Spanish accent). Only while the Admin page's Enable AI Features is on, and for Silver and Gold
// members and Admins (canUseInCarCoach), as only they hear the engineers answer over Driver Radio.
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInEngineerVoices }, { status: 401 });
    }
    if (!(await getEnableAiFeatures())) {
      return NextResponse.json({ error: t.engineerVoicesDisabled, code: 'aiFeaturesDisabled' }, { status: 403 });
    }
    if (!canUseInCarCoach(user)) {
      return NextResponse.json({ error: t.engineerVoicesMembersOnly, code: 'membershipRequired' }, { status: 403 });
    }
    const body = await readJsonLimited(request, JSON_BODY_LIMIT).catch(() => ({}));
    const { spanishAccent } = await getCoachVoice(user.id);
    if (
      !isEngineerSpeaker(body.speaker) ||
      !isCoachVoice(body.voice) ||
      !(body.voice in engineerVoicesFor(body.speaker, user.preferredLanguage, spanishAccent, user))
    ) {
      return NextResponse.json({ error: t.unknownCoachVoice }, { status: 400 });
    }
    await setEngineerVoice(user.id, body.speaker, body.voice);
    return NextResponse.json({ speaker: body.speaker, voice: body.voice });
  } catch (error) {
    console.error('Engineer voices error:', error);
    return NextResponse.json({ error: t.failedSaveEngineerVoice }, { status: 500 });
  }
}
