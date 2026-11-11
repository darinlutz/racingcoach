import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ABUSE_LIMITS, limitReached, recordAttempt } from '@/lib/abuseGuards';
import { recordTvReport } from '@/lib/liveVideo/broadcastSourceRuntime';
import { JSON_BODY_LIMIT, readJsonLimited } from '@/lib/requestBody';
import { getTvSession } from '@/lib/tvAuth';

// A TV's live video player and synchronization figures, every 10 s while it shows a stream, for the Admin page's
// diagnostics (kept in memory 5 minutes; nothing stored). Each figure says whether it was measured or estimated.
const ms = z.number().finite().min(-600_000).max(600_000).nullable();
const bodySchema = z.object({
  status: z.enum(['LIVE', 'CONNECTING', 'BUFFERING', 'OFFLINE', 'ERROR', 'UNKNOWN']),
  latencyMs: ms,
  latencyBasis: z.enum(['measured', 'estimated', 'none']),
  appliedDelayMs: z.number().finite().min(0).max(600_000),
  delayBasis: z.enum(['off', 'measured', 'estimated', 'manual', 'none']),
  syncErrorMs: ms,
  bufferMs: ms,
  timelineSpanMs: z.number().finite().min(0).max(3_600_000),
  lateSamples: z.number().int().min(0).max(1e9),
  outOfOrder: z.number().int().min(0).max(1e9),
  duplicates: z.number().int().min(0).max(1e9),
  droppedFrames: z.number().int().min(0).max(1e9).nullable(),
  stalls: z.number().int().min(0).max(1e9),
  commentaryWaitMs: ms,
  degraded: z.boolean(),
});

export async function POST(request: Request) {
  const session = await getTvSession();
  try {
    if (!session) return NextResponse.json({ error: 'Not paired', code: 'notPaired' }, { status: 401 });
    const key = `liveVideoReport:${session.id}`;
    if (limitReached(key, ABUSE_LIMITS.liveVideoReportsPerTv)) return NextResponse.json({ counted: false }, { status: 429 });
    recordAttempt(key);
    const parsed = bodySchema.safeParse(await readJsonLimited(request, JSON_BODY_LIMIT).catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid report' }, { status: 400 });
    recordTvReport({ ...parsed.data, viewer: `tv:${session.id}`, userId: session.user.id, at: Date.now() });
    return NextResponse.json({ counted: true });
  } catch (error) {
    console.error('Live video report error:', error);
    return NextResponse.json({ error: 'Failed to report' }, { status: 500 });
  }
}
