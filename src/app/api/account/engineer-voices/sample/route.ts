import { NextResponse } from 'next/server';
import { allowedVoice, getCoachVoice, isCoachVoice, isEngineerSpeaker, speaksElevenLabs, synthesizeSpeech } from '@/lib/coachVoice';
import { ELEVENLABS_PROVIDER, SPEECH_PROVIDER_HEADER } from '@/lib/engineBedConfig';
import { apiText, getDictionary } from '@/lib/i18n/server';
import { aiRateLimit, type AiRateLimit } from '@/lib/rateLimits';
import { canUseInCarCoach } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';

// The Account page's Setup Engineer and Race Strategist Listen buttons: a sample answer (the dictionary's
// engineerVoices.sampleSetupEngineer or sampleRaceStrategist) said by that engineer in a voice and the signed-in user's
// Preferred Language and Spanish accent, as a WAV file. ?speaker= setupEngineer or raceStrategist, ?voice= one of
// COACH_VOICES in src/lib/coachVoice.ts (the page also adds ?language=, so the browser doesn't play a sample cached in
// another language).
export async function GET(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  let limit: AiRateLimit | null = null;
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInEngineerVoices }, { status: 401 });
    }
    if (!canUseInCarCoach(user)) {
      return NextResponse.json({ error: t.engineerVoicesMembersOnly, code: 'membershipRequired' }, { status: 403 });
    }
    const params = new URL(request.url).searchParams;
    const speaker = params.get('speaker');
    const picked = params.get('voice');
    if (!isEngineerSpeaker(speaker) || !isCoachVoice(picked)) {
      return NextResponse.json({ error: t.unknownCoachVoice }, { status: 400 });
    }
    // French and Italian's ElevenLabs voices are for Gold members and Admins: anyone else hears the default Chirp voice
    const voice = allowedVoice(picked, user.preferredLanguage, user);
    limit = await aiRateLimit(request, 'speech', user);
    if (limit.response) return limit.response;
    const { spanishAccent } = await getCoachVoice(user.id);
    const words = getDictionary(user.preferredLanguage).engineerVoices;
    const sample = speaker === 'setupEngineer' ? words.sampleSetupEngineer : words.sampleRaceStrategist;
    const audio = await synthesizeSpeech(sample, voice, user.preferredLanguage, spanishAccent, speaker);
    return new NextResponse(new Uint8Array(audio), {
      headers: {
        'Content-Type': 'audio/wav',
        'Cache-Control': 'private, max-age=86400',
        ...(speaksElevenLabs(voice, speaker, user.preferredLanguage, spanishAccent) ? { [SPEECH_PROVIDER_HEADER]: ELEVENLABS_PROVIDER } : {}),
      },
    });
  } catch (error) {
    console.error('Engineer voice sample error:', error);
    await limit?.refund();
    return NextResponse.json({ error: t.failedCoachVoiceSample }, { status: 502 });
  }
}
