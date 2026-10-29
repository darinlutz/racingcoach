import { NextResponse } from 'next/server';
import { z } from 'zod';
import { commentate } from '@/lib/announcerCommentary';
import { apiText } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';
import { getEnableAiFeatures } from '@/lib/siteSettings';

const bodySchema = z.object({
  driverId: z.number().int().positive(),
  // The number of the newest race event already announced (or skipped)
  after: z.number().int().min(0),
  lead: z.boolean(),
  color: z.boolean(),
});

// Live Racing's Race Announcers (src/lib/raceAnnouncer.ts): the race events of a driver the signed-in user may watch
// that are newer than after (src/lib/liveRacing.ts), commentated by the RaceAnnouncer agent in the user's Preferred
// Language, following their Race Announcer Instructions, and each line spoken by the Lead or Color Announcer (only
// those turned on, lead and color) in the voices picked on the Account page (commentate in
// src/lib/announcerCommentary.ts, shared with TV Broadcast Mode). Answers { seq, lines: [{ speaker, text, audio }] },
// audio a base64 WAV; seq is the newest event's number, to send as after next time. No AI call when nothing new
// happened. 404 when the driver isn't live or can't be watched.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
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
    const result = await commentate({ request, user, ...parsed.data, format: 'wav' });
    if (result.kind === 'notLive') {
      return NextResponse.json({ error: t.driverNotLive }, { status: 404 });
    }
    if (result.kind === 'refused') return result.response;
    return NextResponse.json({ seq: result.seq, lines: result.lines });
  } catch (error) {
    console.error('Race Announcer error:', error);
    return NextResponse.json({ error: t.failedRaceAnnouncer }, { status: 502 });
  }
}
