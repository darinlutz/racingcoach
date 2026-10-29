import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCoachVoice, synthesizeSpeech } from '@/lib/coachVoice';
import { apiText } from '@/lib/i18n/server';
import { readRaceEvents } from '@/lib/liveRacing';
import { ANNOUNCER_ROLES, getRaceAnnouncerSettings, raceAnnouncerLines, type Announcer } from '@/lib/raceAnnouncer';
import { aiRateLimit, type AiRateLimit } from '@/lib/rateLimits';
import { getCurrentUser } from '@/lib/session';
import { getEnableAiFeatures } from '@/lib/siteSettings';

const bodySchema = z.object({
  driverId: z.number().int().positive(),
  // The number of the newest race event already announced (or skipped)
  after: z.number().int().min(0),
  lead: z.boolean(),
  color: z.boolean(),
});

// Events older than this aren't announced any more: the moment has passed
const FRESH_MS = 30_000;
// What each user's announcers said lately, so they don't say it again (this server's memory only)
const RECENT_LINES = 6;
const recentLines = new Map<number, string[]>();

// Live Racing's Race Announcers (src/lib/raceAnnouncer.ts): the race events of a driver the signed-in user may watch
// that are newer than after (src/lib/liveRacing.ts), commentated by the RaceAnnouncer agent in the user's Preferred
// Language, following their Race Announcer Instructions, and each line spoken by the Lead or Color Announcer (only
// those turned on, lead and color) in the voices picked on the Account page. Answers { seq, lines: [{ speaker, text,
// audio }] }, audio a base64 WAV; seq is the newest event's number, to send as after next time. No AI call when
// nothing new happened. 404 when the driver isn't live or can't be watched.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  let limit: AiRateLimit | null = null;
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInLiveRacing }, { status: 401 });
    }
    if (!(await getEnableAiFeatures())) {
      return NextResponse.json({ error: t.raceAnnouncersDisabled, code: 'aiFeaturesDisabled' }, { status: 403 });
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Expected { driverId, after, lead, color }' }, { status: 400 });
    }
    const { driverId, after, lead, color } = parsed.data;
    const found = await readRaceEvents(user, driverId, after);
    if (!found) {
      return NextResponse.json({ error: t.driverNotLive }, { status: 404 });
    }
    const events = found.events.filter((e) => Date.now() - e.at <= FRESH_MS);
    const speakers: Announcer[] = [...(lead ? ['lead' as const] : []), ...(color ? ['color' as const] : [])];
    if (events.length === 0 || speakers.length === 0) {
      return NextResponse.json({ seq: found.seq, lines: [] });
    }

    limit = await aiRateLimit(request, 'raceAnnouncer', user);
    if (limit.response) return limit.response;
    const [settings, { spanishAccent }] = await Promise.all([getRaceAnnouncerSettings(user.id), getCoachVoice(user.id)]);
    const lines = await limit.track(() =>
      raceAnnouncerLines({
        events,
        context: found.context,
        speakers,
        instructions: settings.instructions,
        recentLines: recentLines.get(user.id) ?? [],
        language: user.preferredLanguage,
      })
    );
    recentLines.set(user.id, [...(recentLines.get(user.id) ?? []), ...lines.map((l) => l.text)].slice(-RECENT_LINES));

    const spoken = await Promise.all(
      lines.map(async (line) => {
        const voice = line.speaker === 'lead' ? settings.leadVoice : settings.colorVoice;
        const audio = await synthesizeSpeech(line.text, voice, user.preferredLanguage, spanishAccent, ANNOUNCER_ROLES[line.speaker]);
        return { ...line, audio: audio.toString('base64') };
      })
    );
    return NextResponse.json({ seq: found.seq, lines: spoken });
  } catch (error) {
    console.error('Race Announcer error:', error);
    await limit?.refund();
    return NextResponse.json({ error: t.failedRaceAnnouncer }, { status: 502 });
  }
}
