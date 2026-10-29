import { NextResponse } from 'next/server';
import { apiText } from '@/lib/i18n/server';
import { readMapTrack } from '@/lib/liveMapTrack';
import { getCurrentUser } from '@/lib/session';

// A Live Racing map's track (readMapTrack in src/lib/liveMapTrack.ts): its name, length, outline and focus areas.
//   ?key=     iRacing's track key, e.g. "roadatlanta full"
//   ?driver=  a driver on that track (optional): without a saved outline, that driver's collector's approximate one,
//             if the user may watch them (approximate: true)
// Answers { track: null } without either.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInLiveRacing }, { status: 401 });
    }
    const params = new URL(request.url).searchParams;
    const key = params.get('key')?.trim();
    if (!key) {
      return NextResponse.json({ error: 'key is required' }, { status: 400 });
    }
    const driverId = Number(params.get('driver'));
    return NextResponse.json({ track: await readMapTrack(user, key, Number.isInteger(driverId) && driverId > 0 ? driverId : null) });
  } catch (error) {
    console.error('Live Racing outline error:', error);
    return NextResponse.json({ error: t.failedLoadLiveRacing }, { status: 500 });
  }
}
