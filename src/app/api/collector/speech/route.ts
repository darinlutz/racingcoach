import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateCollector } from '@/lib/collectorKeys';
import { getCoachVoice, MAX_SPEECH_CHARS, synthesizeSpeech } from '@/lib/coachVoice';
import { DEFAULT_LANGUAGE } from '@/lib/i18n/languages';
import { getDictionary } from '@/lib/i18n/server';
import { aiRateLimit, type AiRateLimit } from '@/lib/rateLimits';
import { getUserById } from '@/lib/users';

const bodySchema = z.union([
  z.object({ text: z.string().trim().min(1).max(MAX_SPEECH_CHARS) }),
  // A fixed phrase from the dictionary's coachSpeech, said in the user's language
  z.object({ phrase: z.enum(['newLap']) }),
]);

// The telemetry collector's voice: what the In-Car AI Coach says, as a WAV file in the user's coach voice with a
// native accent in their Preferred Language (src/lib/coachVoice.ts). Authenticated with the upload key as a
// bearer token, like /api/collector/laps. Body: { text } (already in the user's language) or { phrase }.
export async function POST(request: Request) {
  let limit: AiRateLimit | null = null;
  try {
    const userId = await authenticateCollector(request);
    if (userId === null) {
      return NextResponse.json({ error: 'Missing or unknown upload key' }, { status: 401 });
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: `Expected { text } (at most ${MAX_SPEECH_CHARS} characters) or { phrase }` }, { status: 400 });
    }

    const [user, { voice, spanishAccent }] = await Promise.all([getUserById(userId), getCoachVoice(userId)]);
    limit = await aiRateLimit(request, 'speech', user);
    if (limit.response) return limit.response;
    const language = user?.preferredLanguage ?? DEFAULT_LANGUAGE;
    const text = 'phrase' in parsed.data ? getDictionary(language).coachSpeech[parsed.data.phrase] : parsed.data.text;
    const audio = await synthesizeSpeech(text, voice, language, spanishAccent);
    return new NextResponse(new Uint8Array(audio), { headers: { 'Content-Type': 'audio/wav', 'X-Coach-Voice': voice } });
  } catch (error) {
    console.error('Collector speech error:', error);
    await limit?.refund();
    return NextResponse.json({ error: 'Failed to make the speech' }, { status: 502 });
  }
}
