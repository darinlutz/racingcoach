import { NextResponse } from 'next/server';
import { authenticateCollector } from '@/lib/collectorKeys';
import { looksLikeWav, MAX_RADIO_BYTES, transcribeRadio } from '@/lib/driverRadio';
import { DEFAULT_LANGUAGE } from '@/lib/i18n/languages';
import { recordDriverRadio } from '@/lib/liveRacing';
import { aiRateLimit, type AiRateLimit } from '@/lib/rateLimits';
import { getEnableAiFeatures } from '@/lib/siteSettings';
import { getUserById } from '@/lib/users';

// Driver Radio (src/lib/driverRadio.ts): the collector's recording of what the driver said while holding the radio
// button, as the request body (a WAV file, Content-Type audio/wav). Authenticated with the upload key as a bearer
// token, like /api/collector/laps. Answers { text, shared }: the words, in the driver's Preferred Language (empty when
// nothing was heard), and whether they went to the Live Racing page (only while the driver is live). 403
// { code: 'aiFeaturesDisabled' } while the Admin page's Enable AI Features is off.
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
    return NextResponse.json({ text, shared });
  } catch (error) {
    console.error('Driver Radio error:', error);
    await limit?.refund();
    return NextResponse.json({ error: 'Failed to turn the radio message into text' }, { status: 502 });
  }
}
