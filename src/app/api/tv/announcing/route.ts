import { NextResponse } from 'next/server';
import { z } from 'zod';
import { markAnnouncing } from '@/lib/liveRacing';
import { getTvSession } from '@/lib/tvAuth';

const bodySchema = z.object({ ms: z.number().min(0).max(60_000) });

// The TV is about to play a Race Announcer line about its account's own driving, ms long: their collector holds the
// In-Car AI Coach till it ends, as for the Live Racing page (POST /api/live/announcing). Answers { holding }.
export async function POST(request: Request) {
  const session = await getTvSession();
  try {
    if (!session) {
      return NextResponse.json({ error: 'Not paired', code: 'notPaired' }, { status: 401 });
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Expected { ms }' }, { status: 400 });
    }
    return NextResponse.json({ holding: markAnnouncing(session.user, parsed.data.ms) });
  } catch (error) {
    console.error('TV announcing error:', error);
    return NextResponse.json({ error: 'Failed to hold the coach' }, { status: 500 });
  }
}
