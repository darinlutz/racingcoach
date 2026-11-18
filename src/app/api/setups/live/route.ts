import { NextResponse } from 'next/server';
import { readEngineerSnapshot } from '@/lib/liveRacing';
import { setupErrorResponse, setupsSession } from '@/lib/setupRoutes';
import { readLatestCapture } from '@/lib/setups';

// The Live Setup tab: the setup the signed-in user's collector last saw loaded in iRacing (its newest capture), and
// whether the collector is in iRacing right now with the live update's in-car values (brake bias, fixed session)
export async function GET() {
  const session = await setupsSession();
  if (session.response) return session.response;
  try {
    const capture = await readLatestCapture(session.user.id);
    const live = readEngineerSnapshot(session.user.id);
    return NextResponse.json({
      capture,
      collector: live
        ? {
            live: true,
            car: live.update.car,
            track: live.update.track,
            at: new Date(live.receivedAt).toISOString(),
            setup: live.update.setup ?? null,
          }
        : { live: false },
    });
  } catch (error) {
    return setupErrorResponse(error, session.t, 'Live setup');
  }
}
