import { NextResponse } from 'next/server';
import { readConnection, readRaceEvents } from '@/lib/raceHistory';
import { runRaceTrends } from '@/lib/raceTrends';
import { getCurrentUser } from '@/lib/session';

// The agent makes several model calls (one per tool round), so give it more than the default
export const maxDuration = 60;

const NOT_SIGNED_IN = { error: 'Log in to see your race trends' };

// The user's iRacePlan connection and the races synced from it so far
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(NOT_SIGNED_IN, { status: 401 });
    }
    const [connection, events] = await Promise.all([readConnection(user.id), readRaceEvents(user.id)]);
    return NextResponse.json({ connection, events });
  } catch (error) {
    console.error('Read race trends error:', error);
    return NextResponse.json({ error: 'Failed to load your races' }, { status: 500 });
  }
}

// Charts and agent commentary over the user's synced races
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(NOT_SIGNED_IN, { status: 401 });
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is not configured');
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const [connection, events] = await Promise.all([readConnection(user.id), readRaceEvents(user.id)]);
    if (events.length === 0) {
      return NextResponse.json({ error: 'No races yet. Connect iRacePlan and let your races load first.' }, { status: 400 });
    }

    const { trend, incidents, commentary, steps } = await runRaceTrends(connection?.iracingName ?? user.userName, events);

    return NextResponse.json({ success: true, trend, incidents, commentary, steps }, { status: 200 });
  } catch (error) {
    console.error('Race trends error:', error);
    return NextResponse.json({ error: 'Failed to get the race trends' }, { status: 500 });
  }
}
