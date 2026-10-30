import { NextResponse } from 'next/server';
import { looksLikeWav, MAX_RADIO_BYTES, transcribeRadio } from '@/lib/driverRadio';
import { DEFAULT_LANGUAGE } from '@/lib/i18n/languages';
import { apiText } from '@/lib/i18n/server';
import { checkDriverMessage, queueDriverMessage, type DriverMessageStatus } from '@/lib/liveRacing';
import { aiRateLimit, type AiRateLimit } from '@/lib/rateLimits';
import { getCurrentUser } from '@/lib/session';
import { getEnableAiFeatures } from '@/lib/siteSettings';

// The Live Racing page's Hold to Talk, beside Message Driver: ?driverId= with the watcher's recording as the body (a
// 16 kHz mono WAV the page makes from the microphone, Content-Type audio/wav). It's turned into text (Driver Radio's
// speech to text, in the watcher's Preferred Language, rate limited as driverRadio), then queued like a typed message
// with the recording, which collectors from 1.58.0 play in the driver's car in the watcher's own voice (older ones
// say the text in the coach voice). Answers { success, text }, 422 when no words were heard, and the same errors as
// POST /api/live/message, checked before the speech to text so a refused message costs nothing.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  let limit: AiRateLimit | null = null;
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInLiveRacing }, { status: 401 });
    }
    if (!(await getEnableAiFeatures())) {
      return NextResponse.json({ error: t.voiceMessagesOff, code: 'aiFeaturesDisabled' }, { status: 403 });
    }
    const driverId = Number(new URL(request.url).searchParams.get('driverId'));
    if (!Number.isInteger(driverId) || driverId <= 0) {
      return NextResponse.json({ error: 'Expected ?driverId=' }, { status: 400 });
    }
    const refused = statusResponse(await checkDriverMessage(user, driverId), t);
    if (refused) return refused;
    const audio = Buffer.from(await request.arrayBuffer());
    if (audio.length > MAX_RADIO_BYTES) {
      return NextResponse.json({ error: t.voiceMessageTooLong }, { status: 413 });
    }
    if (!looksLikeWav(audio)) {
      return NextResponse.json({ error: 'Expected a WAV recording' }, { status: 400 });
    }

    limit = await aiRateLimit(request, 'driverRadio', user);
    if (limit.response) return limit.response;
    const text = await transcribeRadio(audio, user.preferredLanguage ?? DEFAULT_LANGUAGE);
    if (!text) {
      return NextResponse.json({ error: t.voiceMessageEmpty }, { status: 422 });
    }
    const queued = statusResponse(await queueDriverMessage(user, driverId, text, audio), t);
    return queued ?? NextResponse.json({ success: true, text });
  } catch (error) {
    console.error('Live Racing voice message error:', error);
    await limit?.refund();
    return NextResponse.json({ error: t.failedSendDriverMessage }, { status: 500 });
  }
}

function statusResponse(status: DriverMessageStatus, t: Awaited<ReturnType<typeof apiText>>): NextResponse | null {
  switch (status) {
    case 'queued':
      return null;
    case 'notAllowed':
      return NextResponse.json({ error: t.cannotMessageDriver }, { status: 403 });
    case 'notLive':
      return NextResponse.json({ error: t.driverNotLive }, { status: 404 });
    case 'collectorTooOld':
      return NextResponse.json({ error: t.collectorTooOldForMessages }, { status: 409 });
    case 'tooMany':
      return NextResponse.json({ error: t.tooManyDriverMessages }, { status: 429 });
  }
}
