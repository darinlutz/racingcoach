import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiText } from '@/lib/i18n/server';
import { markAnnouncing } from '@/lib/liveRacing';
import { getCurrentUser } from '@/lib/session';

const bodySchema = z.object({ ms: z.number().min(0).max(60_000) });

// The signed-in user's Live Racing page is about to play a Race Announcer line about their own driving, ms long: their
// collector holds the In-Car AI Coach till it ends (markAnnouncing in src/lib/liveRacing.ts), so the two don't talk at
// once. Answers { holding }, false when the user isn't live.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInLiveRacing }, { status: 401 });
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Expected { ms }' }, { status: 400 });
    }
    return NextResponse.json({ holding: markAnnouncing(user, parsed.data.ms) });
  } catch (error) {
    console.error('Live Racing announcing error:', error);
    return NextResponse.json({ error: 'Failed to hold the coach' }, { status: 500 });
  }
}
