import { NextResponse } from 'next/server';
import { getCoachVoice, speaksElevenLabs, synthesizeSpeech, withPronunciations } from '@/lib/coachVoice';
import { radioVoiceId } from '@/lib/driverRadio';
import { ELEVENLABS_PROVIDER, SPEECH_PROVIDER_HEADER } from '@/lib/engineBedConfig';
import { DEFAULT_LANGUAGE } from '@/lib/i18n/languages';
import { elevenLabsSpeech } from '@/lib/elevenLabs';
import { apiText } from '@/lib/i18n/server';
import { readDriverRadio } from '@/lib/liveRacing';
import { aiRateLimit, type AiRateLimit } from '@/lib/rateLimits';
import { getCurrentUser } from '@/lib/session';
import { getUserById } from '@/lib/users';

// Driver Radio's voice (src/lib/driverRadio.ts): GET ?driverId=&seq= answers one of a live driver's radio messages
// said in that driver's radio voice (radioVoiceId: the site owner's own voice, ELEVENLABS_MY_VOICE_ID, for their
// accounts, else the ElevenLabs RaceCoach voice of the driver's Preferred Language), as an MP3, for anyone who may
// watch the driver. The text is the driver's own words, never taken from the request; every watcher's page asks, and
// the same words are made once (elevenLabsSpeech caches them). 404 once the message is gone, 503 without the voice.
// The Race Engineer's answers (src/lib/raceEngineer.ts) are said in the driver's coach voice instead, as their
// collector says them.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  let limit: AiRateLimit | null = null;
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInLiveRacing }, { status: 401 });
    }
    const params = new URL(request.url).searchParams;
    const driverId = Number(params.get('driverId'));
    const seq = Number(params.get('seq'));
    if (!Number.isInteger(driverId) || driverId <= 0 || !Number.isInteger(seq) || seq <= 0) {
      return NextResponse.json({ error: 'Expected ?driverId=&seq=' }, { status: 400 });
    }
    const message = await readDriverRadio(user, driverId, seq);
    const driver = message ? await getUserById(driverId) : null;
    if (!message || !driver) {
      return NextResponse.json({ error: t.driverNotLive }, { status: 404 });
    }
    if (message.from === 'engineer') {
      limit = await aiRateLimit(request, 'speech', user);
      if (limit.response) return limit.response;
      const { voice, spanishAccent, pronunciations } = await getCoachVoice(driverId);
      const language = driver.preferredLanguage ?? DEFAULT_LANGUAGE;
      const audio = await synthesizeSpeech(withPronunciations(message.text, pronunciations), voice, language, spanishAccent, 'raceCoach', 'mp3');
      return new NextResponse(new Uint8Array(audio), {
        headers: {
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'no-store',
          ...(speaksElevenLabs(voice, 'raceCoach', language, spanishAccent) ? { [SPEECH_PROVIDER_HEADER]: ELEVENLABS_PROVIDER } : {}),
        },
      });
    }
    const voiceId = await radioVoiceId(driver);
    if (!voiceId) {
      return NextResponse.json({ error: 'Driver Radio’s voice is not set up on this site (ElevenLabs)' }, { status: 503 });
    }
    limit = await aiRateLimit(request, 'speech', user);
    if (limit.response) return limit.response;
    const audio = await elevenLabsSpeech(message.text, voiceId);
    return new NextResponse(new Uint8Array(audio), {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', [SPEECH_PROVIDER_HEADER]: ELEVENLABS_PROVIDER },
    });
  } catch (error) {
    console.error('Driver Radio speech error:', error);
    await limit?.refund();
    return NextResponse.json({ error: 'Failed to make the radio message’s speech' }, { status: 502 });
  }
}
