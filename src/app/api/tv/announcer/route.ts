import { NextResponse } from 'next/server';
import { z } from 'zod';
import { commentate } from '@/lib/announcerCommentary';
import { getDictionary } from '@/lib/i18n/server';
import { getEnableAiFeatures } from '@/lib/siteSettings';
import { getTvSession } from '@/lib/tvAuth';
import { commentaryHeldFor, noteCommentaryPlaying } from '@/lib/videoDirectorRuntime';

const bodySchema = z.object({
  driverId: z.number().int().positive(),
  // The newest race event the TV already heard (or skipped)
  after: z.number().int().min(0),
  lead: z.boolean(),
  color: z.boolean(),
});

// The newest race event each TV session was given commentary for, by driver, so a TV that reconnects or reloads
// never hears the same events again (this server's memory, like the live positions themselves)
const heard = new Map<number, { driverId: number; seq: number }>();

// TV Broadcast Mode's Race Announcers: the same commentary as the Live Racing page's (commentate in
// src/lib/announcerCommentary.ts), for the TV's paired account, as MP3s for the TV's browser. Answers
// { seq, lines: [{ speaker, text, audio, intensity, priority, ttlMs, durationMs, volume, elevenLabs }], replaceQueued, engineBed },
// audio a base64 MP3. The AI call counts against the account's AI limit like the Live Racing page's.
export async function POST(request: Request) {
  const session = await getTvSession();
  const t = getDictionary(session?.user.preferredLanguage ?? 'en').tv;
  try {
    if (!session) {
      return NextResponse.json({ error: t.notPaired, code: 'notPaired' }, { status: 401 });
    }
    if (!(await getEnableAiFeatures())) {
      return NextResponse.json({ error: t.aiDisabled, code: 'aiFeaturesDisabled' }, { status: 403 });
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Expected { driverId, after, lead, color }' }, { status: 400 });
    }
    const { driverId } = parsed.data;
    const before = heard.get(session.id);
    const after = before?.driverId === driverId ? Math.max(parsed.data.after, before.seq) : parsed.data.after;
    const result = await commentate({ request, user: session.user, ...parsed.data, after, format: 'mp3', held: commentaryHeldFor(session.user.id) });
    if (result.kind === 'notLive') {
      return NextResponse.json({ error: t.driverNotLive }, { status: 404 });
    }
    if (result.kind === 'refused') return result.response;
    if (result.kind === 'held') return NextResponse.json({ seq: result.seq, lines: [], held: true });
    heard.set(session.id, { driverId, seq: Math.max(result.seq, after) });
    noteCommentaryPlaying(session.user.id, result.lines.reduce((sum, line) => sum + line.durationMs, 0));
    return NextResponse.json({ seq: result.seq, lines: result.lines, replaceQueued: result.replaceQueued, engineBed: result.engineBed });
  } catch (error) {
    console.error('TV Race Announcer error:', error);
    return NextResponse.json({ error: t.commentaryFailed }, { status: 502 });
  }
}
