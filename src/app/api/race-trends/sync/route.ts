import { NextResponse } from 'next/server';
import { IRacePlanAuthError } from '@/lib/iRacePlan';
import { NotConnectedError, syncRaceResults } from '@/lib/raceHistory';
import { getCurrentUser } from '@/lib/session';

// One batch of race results from iRacePlan; the browser calls again while `remaining` is above 0
export const maxDuration = 120;

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Log in to load your races' }, { status: 401 });
    }
    return NextResponse.json(await syncRaceResults(user.id));
  } catch (error) {
    if (error instanceof NotConnectedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof IRacePlanAuthError) {
      return NextResponse.json(
        { error: 'iRacePlan rejected your API key. Reconnect with a new key from iRacePlan Settings > API Keys.' },
        { status: 502 }
      );
    }
    console.error('iRacePlan sync error:', error);
    return NextResponse.json({ error: 'Failed to load your races from iRacePlan' }, { status: 502 });
  }
}
