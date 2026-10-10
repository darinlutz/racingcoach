import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { isAiOutOfCredits } from '@/lib/aiErrors';
import { getUserIdByDiscordId } from '@/lib/discord';
import { readConnection, readRaceEvents } from '@/lib/raceHistory';
import { runRaceCoaching } from '@/lib/raceTrends';
import { getUserById } from '@/lib/users';

// Coaching for the Discord bot's /coach command (bot/ in this repo). Not for browsers: the bot sends
// BOT_API_SECRET as a bearer token and names the Discord user, and gets the coaching agent's top
// three opportunities from that user's synced races (runRaceCoaching).

// The agent makes several model calls (one per tool round), so give it more than the default
export const maxDuration = 60;

function authorized(request: Request, secret: string): boolean {
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request) {
  try {
    const secret = process.env.BOT_API_SECRET;
    if (!secret) {
      console.error('Bot coach error: BOT_API_SECRET is not configured');
      return NextResponse.json({ error: 'BOT_API_SECRET is not configured' }, { status: 500 });
    }
    if (!authorized(request, secret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const discordUserId = typeof body.discordUserId === 'string' ? body.discordUserId.trim() : '';
    if (!/^\d+$/.test(discordUserId)) {
      return NextResponse.json({ error: 'discordUserId is required' }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is not configured');
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const userId = await getUserIdByDiscordId(discordUserId);
    const user = userId === null ? null : await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: 'not_linked' }, { status: 404 });
    }

    const [connection, events] = await Promise.all([readConnection(user.id), readRaceEvents(user.id)]);
    if (events.length === 0) {
      return NextResponse.json({ error: 'no_races' }, { status: 404 });
    }

    const coaching = await runRaceCoaching(connection?.iracingName ?? user.userName, events);
    return NextResponse.json({ success: true, coaching });
  } catch (error) {
    console.error('Bot coach error:', error);
    if (isAiOutOfCredits(error)) {
      return NextResponse.json({ error: 'out_of_credits' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Failed to get coaching' }, { status: 500 });
  }
}
