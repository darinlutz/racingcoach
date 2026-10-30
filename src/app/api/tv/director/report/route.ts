import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getTvSession } from '@/lib/tvAuth';
import { reportClipFailed } from '@/lib/videoDirectorRuntime';

const bodySchema = z.object({ seq: z.number().int().min(0), videoId: z.number().int().positive() });

// The TV's player couldn't play the clip. The TV has gone back to its map by itself; when every TV watching has, the
// Broadcast Director ends the clip for good. Answers { counted }.
export async function POST(request: Request) {
  const session = await getTvSession();
  try {
    if (!session) return NextResponse.json({ error: 'Not paired', code: 'notPaired' }, { status: 401 });
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Expected { seq, videoId }' }, { status: 400 });
    return NextResponse.json({ counted: reportClipFailed(session.user.id, parsed.data.seq, parsed.data.videoId) });
  } catch (error) {
    console.error('Broadcast Director report error:', error);
    return NextResponse.json({ error: 'Failed to report' }, { status: 500 });
  }
}
