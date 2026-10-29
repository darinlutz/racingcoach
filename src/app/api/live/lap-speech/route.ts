import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCoachVoice } from '@/lib/coachVoice';
import { elevenLabsSpeech, elevenLabsVoiceId } from '@/lib/elevenLabs';
import { apiText, getDictionary } from '@/lib/i18n/server';
import { aiRateLimit, type AiRateLimit } from '@/lib/rateLimits';
import { getCurrentUser } from '@/lib/session';

const bodySchema = z.object({
  lapTime: z.number().min(1).max(3600),
  newBest: z.boolean().optional(),
});

// The lap time as a race engineer says it, in the dictionary's words: 109.479 -> "Lap time, 1 49, point 4 7 9."
function lapTimeText(seconds: number, words: { lapTimeSpeech: string; lapTimeSpeechSeconds: string; newBestSpeech: string }, newBest: boolean) {
  const ms = Math.round(seconds * 1000);
  const minutes = Math.floor(ms / 60_000);
  const wholeSeconds = Math.floor((ms % 60_000) / 1000);
  const thousandths = String(ms % 1000).padStart(3, '0').split('').join(' ');
  const text =
    minutes > 0
      ? words.lapTimeSpeech
          .replace('{minutes}', String(minutes))
          .replace('{seconds}', String(wholeSeconds).padStart(2, '0'))
          .replace('{thousandths}', thousandths)
      : words.lapTimeSpeechSeconds.replace('{seconds}', String(wholeSeconds)).replace('{thousandths}', thousandths);
  return newBest ? `${text} ${words.newBestSpeech}` : text;
}

// Live Racing's lap time announcement: the lap time (and whether it's a new best) said in the ElevenLabs RaceCoach
// voice of the user's Preferred Language and Spanish accent (src/lib/elevenLabs.ts), as an MP3. Signed-in users only; the page asks once per
// completed lap while Announce lap times is on. The text is made here from the number, never taken from the request.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  let limit: AiRateLimit | null = null;
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInLiveRacing }, { status: 401 });
    }
    const { spanishAccent } = await getCoachVoice(user.id);
    const voiceId = elevenLabsVoiceId('raceCoach', user.preferredLanguage, spanishAccent);
    if (!voiceId) {
      return NextResponse.json({ error: 'Lap time announcements are not set up on this site (ElevenLabs)' }, { status: 503 });
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Expected { lapTime, newBest? }' }, { status: 400 });
    }
    limit = await aiRateLimit(request, 'speech', user);
    if (limit.response) return limit.response;
    const words = getDictionary(user.preferredLanguage).liveRacing;
    const audio = await elevenLabsSpeech(lapTimeText(parsed.data.lapTime, words, !!parsed.data.newBest), voiceId);
    return new NextResponse(new Uint8Array(audio), { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Lap time speech error:', error);
    await limit?.refund();
    return NextResponse.json({ error: 'Failed to make the lap time announcement' }, { status: 502 });
  }
}
