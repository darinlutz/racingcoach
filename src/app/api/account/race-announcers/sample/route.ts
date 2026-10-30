import { NextResponse } from 'next/server';
import { getCoachVoice, isCoachVoice, speaksElevenLabs, synthesizeSpeech } from '@/lib/coachVoice';
import { ELEVENLABS_PROVIDER, SPEECH_PROVIDER_HEADER } from '@/lib/engineBedConfig';
import { apiText, getDictionary } from '@/lib/i18n/server';
import { ANNOUNCER_ROLES, isAnnouncer } from '@/lib/raceAnnouncer';
import { aiRateLimit, type AiRateLimit } from '@/lib/rateLimits';
import { getCurrentUser } from '@/lib/session';

// The Account page's Race Announcers' Listen buttons: a sample line (the dictionary's raceAnnouncers.sampleLead or
// sampleColor) said by an announcer in a voice and the signed-in user's Preferred Language and Spanish accent, as a
// WAV file. ?announcer= lead or color, ?voice= one of COACH_VOICES in src/lib/coachVoice.ts (the page also adds
// ?language=, so the browser doesn't play a sample cached in another language).
export async function GET(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  let limit: AiRateLimit | null = null;
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInRaceAnnouncers }, { status: 401 });
    }
    const params = new URL(request.url).searchParams;
    const announcer = params.get('announcer');
    const voice = params.get('voice');
    if (!isAnnouncer(announcer) || !isCoachVoice(voice)) {
      return NextResponse.json({ error: t.unknownCoachVoice }, { status: 400 });
    }
    limit = await aiRateLimit(request, 'speech', user);
    if (limit.response) return limit.response;
    const { spanishAccent } = await getCoachVoice(user.id);
    const words = getDictionary(user.preferredLanguage).raceAnnouncers;
    const sample = announcer === 'lead' ? words.sampleLead : words.sampleColor;
    const audio = await synthesizeSpeech(sample, voice, user.preferredLanguage, spanishAccent, ANNOUNCER_ROLES[announcer]);
    return new NextResponse(new Uint8Array(audio), {
      headers: {
        'Content-Type': 'audio/wav',
        'Cache-Control': 'private, max-age=86400',
        ...(speaksElevenLabs(voice, ANNOUNCER_ROLES[announcer], user.preferredLanguage, spanishAccent) ? { [SPEECH_PROVIDER_HEADER]: ELEVENLABS_PROVIDER } : {}),
      },
    });
  } catch (error) {
    console.error('Race Announcer sample error:', error);
    await limit?.refund();
    return NextResponse.json({ error: t.failedCoachVoiceSample }, { status: 502 });
  }
}
