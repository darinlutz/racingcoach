import { NextResponse } from 'next/server';
import { backfillTrackBounds } from '@/lib/collectorLaps';
import { apiText } from '@/lib/i18n/server';
import { readApproximateOutline } from '@/lib/liveRacing';
import { getCurrentUser } from '@/lib/session';
import { readLiveTrack } from '@/lib/trackOutlines';

// A Live Racing map's track (src/lib/trackOutlines.ts): its name, length, outline and focus areas.
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
    await backfillTrackBounds(); // tracks driven before outlines were kept
    const track = await readLiveTrack(key);
    if (track?.outline) return NextResponse.json({ track: { ...track, approximate: false } });

    const driverId = Number(params.get('driver'));
    const outline = Number.isInteger(driverId) && driverId > 0 ? await readApproximateOutline(user, driverId, key) : null;
    if (!outline) return NextResponse.json({ track: track && { ...track, approximate: false } });
    return NextResponse.json({
      track: { name: track?.name ?? null, lengthFeet: track?.lengthFeet ?? null, areas: track?.areas ?? [], outline, approximate: true },
    });
  } catch (error) {
    console.error('Live Racing outline error:', error);
    return NextResponse.json({ error: t.failedLoadLiveRacing }, { status: 500 });
  }
}
