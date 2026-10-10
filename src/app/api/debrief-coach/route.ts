import { NextResponse } from 'next/server';
import { aiErrorResponse } from '@/lib/aiErrors';
import { debriefSessionSchema, runDebriefCoach } from '@/lib/debriefCoach';
import { saveDebrief } from '@/lib/debriefHistory';
import { getCurrentUser } from '@/lib/session';

// The agent makes several model calls (one per tool round), so give it more than the default
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = debriefSessionSchema.safeParse(body.session);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Missing or invalid session data (needs at least 2 laps and 1 focus area)' },
        { status: 400 }
      );
    }
    if (!parsed.data.areas.some((area) => area.runs.length > 0)) {
      return NextResponse.json({ error: 'None of the laps could be measured in any focus area' }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is not configured');
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const { debrief, steps } = await runDebriefCoach(parsed.data);

    // Kept for signed-in users (e.g. for the Discord bot's /coach debrief). Saving is extra, so a failure
    // is logged rather than costing them the debrief.
    try {
      const user = await getCurrentUser();
      if (user) await saveDebrief(user.id, parsed.data, debrief);
    } catch (error) {
      console.error('Save debrief error:', error);
    }

    return NextResponse.json({ success: true, debrief, steps }, { status: 200 });
  } catch (error) {
    console.error('Debrief coach error:', error);
    return aiErrorResponse(error, 'Failed to run the debrief');
  }
}
