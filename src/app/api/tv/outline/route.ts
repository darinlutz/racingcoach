import { NextResponse } from 'next/server';
import { getDictionary } from '@/lib/i18n/server';
import { readMapTrack } from '@/lib/liveMapTrack';
import { getTvSession } from '@/lib/tvAuth';

// TV Broadcast Mode's track map (readMapTrack in src/lib/liveMapTrack.ts), as GET /api/live/outline gives the Live
// Racing page, for the TV's paired account. ?key= iRacing's track key, ?driver= a driver on it (optional).
export async function GET(request: Request) {
  const session = await getTvSession();
  const t = getDictionary(session?.user.preferredLanguage ?? 'en').tv;
  try {
    if (!session) {
      return NextResponse.json({ error: t.notPaired, code: 'notPaired' }, { status: 401 });
    }
    const params = new URL(request.url).searchParams;
    const key = params.get('key')?.trim();
    if (!key) {
      return NextResponse.json({ error: 'key is required' }, { status: 400 });
    }
    const driverId = Number(params.get('driver'));
    return NextResponse.json({
      track: await readMapTrack(session.user, key, Number.isInteger(driverId) && driverId > 0 ? driverId : null),
    });
  } catch (error) {
    console.error('TV outline error:', error);
    return NextResponse.json({ error: t.failedLoad }, { status: 500 });
  }
}
