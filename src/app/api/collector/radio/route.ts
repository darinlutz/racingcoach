import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateCollector } from '@/lib/collectorKeys';
import { measureCollectorSession } from '@/lib/collectorSession';
import { looksLikeWav, MAX_RADIO_BYTES, transcribeRadio } from '@/lib/driverRadio';
import { DEFAULT_LANGUAGE } from '@/lib/i18n/languages';
import { readEngineerSnapshot, recordDriverRadio } from '@/lib/liveRacing';
import { raceEngineerReply } from '@/lib/raceEngineer';
import { aiRateLimit, type AiRateLimit } from '@/lib/rateLimits';
import { canUseInCarCoach } from '@/lib/roles';
import { getEnableAiFeatures } from '@/lib/siteSettings';
import { DEFAULT_UNITS } from '@/lib/units';
import { getInCarCoachInstructions, getUserById, type User } from '@/lib/users';

// The engineer may look through the session's laps with the Debrief Coach's tools (several model calls)
export const maxDuration = 60;

const lapIdsSchema = z.array(z.uuid()).max(30);

// Driver Radio (src/lib/driverRadio.ts): the collector's recording of what the driver said while holding the radio
// button, as the request body (a WAV file, Content-Type audio/wav). Authenticated with the upload key as a bearer
// token, like /api/collector/laps. Answers { text, shared, reply, engineer }: the words, in the driver's Preferred
// Language (empty when nothing was heard), and whether they went to the Live Racing page (only while the driver is
// live). 403 { code: 'aiFeaturesDisabled' } while the Admin page's Enable AI Features is off.
//
// With ?engineer=1 (collectors from 1.58.0) the Race Engineer (src/lib/raceEngineer.ts) answers too: reply is what
// it says back, for the collector to say in the coach voice, or null when what was said needs no answer; laps= (the
// session's uploaded clientLapIds, comma separated, oldest first) lets it look at where time is lost. engineer is
// 'answered', 'silent', 'membershipRequired' (Silver and Gold members and Admins only, like the In-Car AI Coach),
// 'rateLimited' or 'failed'; the transcription is answered whatever happens to the reply.
export async function POST(request: Request) {
  let limit: AiRateLimit | null = null;
  try {
    const userId = await authenticateCollector(request);
    const user = userId === null ? null : await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: 'Missing or unknown upload key' }, { status: 401 });
    }
    if (!(await getEnableAiFeatures())) {
      return NextResponse.json({ error: 'Driver Radio is turned off on RacingCoach.app', code: 'aiFeaturesDisabled' }, { status: 403 });
    }
    const audio = Buffer.from(await request.arrayBuffer());
    if (audio.length > MAX_RADIO_BYTES) {
      return NextResponse.json({ error: 'The recording is too long' }, { status: 413 });
    }
    if (!looksLikeWav(audio)) {
      return NextResponse.json({ error: 'Expected a WAV recording' }, { status: 400 });
    }

    limit = await aiRateLimit(request, 'driverRadio', user);
    if (limit.response) return limit.response;
    const text = await transcribeRadio(audio, user.preferredLanguage ?? DEFAULT_LANGUAGE);
    const shared = text ? recordDriverRadio(user.id, text) !== null : false;
    limit = null;

    const params = new URL(request.url).searchParams;
    if (!text || params.get('engineer') !== '1') return NextResponse.json({ text, shared });
    const lapIds = lapIdsSchema.safeParse((params.get('laps') ?? '').split(',').filter(Boolean));
    return NextResponse.json({ text, shared, ...(await engineerAnswer(request, user, text, lapIds.success ? lapIds.data : [])) });
  } catch (error) {
    console.error('Driver Radio error:', error);
    await limit?.refund();
    return NextResponse.json({ error: 'Failed to turn the radio message into text' }, { status: 502 });
  }
}

type EngineerAnswer = {
  reply: string | null;
  engineer: 'answered' | 'silent' | 'membershipRequired' | 'rateLimited' | 'failed';
};

// The Race Engineer's answer to what the driver said; never throws, so the transcription still reaches the collector
async function engineerAnswer(request: Request, user: User, said: string, lapIds: string[]): Promise<EngineerAnswer> {
  if (!canUseInCarCoach(user)) return { reply: null, engineer: 'membershipRequired' };
  let limit: AiRateLimit | null = null;
  try {
    limit = await aiRateLimit(request, 'raceEngineer', user);
    if (limit.response) return { reply: null, engineer: 'rateLimited' };
    const [instructions, measured] = await Promise.all([
      getInCarCoachInstructions(user.id),
      measureCollectorSession(user.id, lapIds).catch((error) => {
        console.error('Race Engineer: failed to measure the session’s laps:', error);
        return null;
      }),
    ]);
    const { reply, steps } = await limit.track(() =>
      raceEngineerReply({
        said,
        snapshot: readEngineerSnapshot(user.id),
        measured,
        instructions,
        language: user.preferredLanguage ?? DEFAULT_LANGUAGE,
        units: user.units ?? DEFAULT_UNITS,
      })
    );
    console.log(`Race Engineer: user ${user.id}, ${reply ? 'answered' : 'silent'} (${steps.join(', ') || 'no tools'})`);
    if (!reply) return { reply: null, engineer: 'silent' };
    recordDriverRadio(user.id, reply, 'engineer');
    return { reply, engineer: 'answered' };
  } catch (error) {
    console.error('Race Engineer error:', error);
    await limit?.refund();
    return { reply: null, engineer: 'failed' };
  }
}
