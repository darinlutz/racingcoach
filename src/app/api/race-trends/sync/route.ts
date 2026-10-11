import { NextResponse } from 'next/server';
import { IRacePlanAuthError } from '@/lib/iRacePlan';
import { NotConnectedError, syncRaceResults } from '@/lib/raceHistory';
import { getCurrentUser } from '@/lib/session';
import { apiText } from '@/lib/i18n/server';

// One batch of race results from iRacePlan; the browser calls again while `remaining` is above 0
export const maxDuration = 120;

export async function POST() {
  const t = await apiText();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: t.logInSync }, { status: 401 });
    }
    return NextResponse.json(await syncRaceResults(user.id));
  } catch (error) {
    if (error instanceof NotConnectedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof IRacePlanAuthError) {
      return NextResponse.json(
        { error: t.syncKeyRejected },
        { status: 502 }
      );
    }
    console.error('iRacePlan sync error:', error);
    return NextResponse.json({ error: t.failedSync }, { status: 502 });
  }
}
