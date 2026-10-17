import { NextResponse } from 'next/server';
import { aiErrorResponse } from '@/lib/aiErrors';
import { readConnection, readRaceEvents } from '@/lib/raceHistory';
import { aiRateLimit, type AiRateLimit } from '@/lib/rateLimits';
import { runRaceTrends } from '@/lib/raceTrends';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { apiText, getLanguage } from '@/lib/i18n/server';

// The agent makes several model calls (one per tool round), so give it more than the default
export const maxDuration = 60;

// The user's iRacePlan connection and the races synced from it so far
export async function GET() {
  const t = await apiText();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: t.logInRaceTrends }, { status: 401 });
    }
    // My Race Trends is for Admins only
    if (!isAdmin(user.role)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const [connection, events] = await Promise.all([readConnection(user.id), readRaceEvents(user.id)]);
    return NextResponse.json({ connection, events });
  } catch (error) {
    console.error('Read race trends error:', error);
    return NextResponse.json({ error: t.failedLoadRaces }, { status: 500 });
  }
}

// Charts and agent commentary over the user's synced races
export async function POST(request: Request) {
  const t = await apiText();
  let limit: AiRateLimit | null = null;
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: t.logInRaceTrends }, { status: 401 });
    }
    // My Race Trends is for Admins only
    if (!isAdmin(user.role)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is not configured');
      return NextResponse.json({ error: t.aiNotConfigured }, { status: 500 });
    }

    const [connection, events] = await Promise.all([readConnection(user.id), readRaceEvents(user.id)]);
    if (events.length === 0) {
      return NextResponse.json({ error: t.noRacesYet }, { status: 400 });
    }
    limit = await aiRateLimit(request, 'raceTrends', user);
    if (limit.response) return limit.response;

    const { trend, incidents, commentary, steps } = await runRaceTrends(connection?.iracingName ?? user.userName, events, await getLanguage(user));

    return NextResponse.json({ success: true, trend, incidents, commentary, steps }, { status: 200 });
  } catch (error) {
    console.error('Race trends error:', error);
    await limit?.refund();
    return aiErrorResponse(error, t.failedRaceTrends, t.aiOutOfCredits);
  }
}
