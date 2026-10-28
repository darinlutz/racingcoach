import { NextResponse } from 'next/server';
import { apiText } from '@/lib/i18n/server';
import { readLiveDrivers } from '@/lib/liveRacing';
import { getCurrentUser } from '@/lib/session';

// The Live Racing page's drivers (src/lib/liveRacing.ts): everyone running the telemetry collector right now whom
// the signed-in user may watch, with their position and lap details. Asked for every second while the page is open;
// each ask counts the user as watching those drivers. ?inputs=<userId> adds that driver's inputs over the last few
// seconds (the page's Driver Inputs panel).
export async function GET(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInLiveRacing }, { status: 401 });
    }
    const inputsFor = Number(new URL(request.url).searchParams.get('inputs'));
    return NextResponse.json({ drivers: await readLiveDrivers(user, Number.isInteger(inputsFor) && inputsFor > 0 ? inputsFor : null) });
  } catch (error) {
    console.error('Live Racing error:', error);
    return NextResponse.json({ error: t.failedLoadLiveRacing }, { status: 500 });
  }
}
