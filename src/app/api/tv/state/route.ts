import { NextResponse } from 'next/server';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { getTvSession } from '@/lib/tvAuth';
import { readTvState } from '@/lib/tvBroadcast';

// TV Broadcast Mode's picture of the race, once (src/lib/tvBroadcast.ts), for TVs whose browser can't keep
// GET /api/tv/stream open: asked every second instead. ?driver=<userId> picks the driver to follow.
export async function GET(request: Request) {
  const session = await getTvSession();
  const t = getDictionary(session?.user.preferredLanguage ?? (await getLanguage(null))).tv;
  try {
    if (!session) {
      return NextResponse.json({ error: t.notPaired, code: 'notPaired' }, { status: 401 });
    }
    const driver = Number(new URL(request.url).searchParams.get('driver'));
    const state = await readTvState(session.user, Number.isInteger(driver) && driver > 0 ? driver : null);
    return NextResponse.json(state, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('TV state error:', error);
    return NextResponse.json({ error: t.failedLoad }, { status: 500 });
  }
}
