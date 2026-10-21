import { NextResponse } from 'next/server';
import { aiErrorResponse } from '@/lib/aiErrors';
import { carRpmLimit } from '@/lib/carData';
import { debriefSessionSchema, runDebriefCoach } from '@/lib/debriefCoach';
import { saveDebrief } from '@/lib/debriefHistory';
import { getCurrentUser } from '@/lib/session';
import { apiText, getLanguage } from '@/lib/i18n/server';
import { aiRateLimit, type AiRateLimit } from '@/lib/rateLimits';
import { getUnits } from '@/lib/unitsServer';

// The agent makes several model calls (one per tool round), so give it more than the default
export const maxDuration = 60;

export async function POST(request: Request) {
  const t = await apiText();
  let limit: AiRateLimit | null = null;
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = debriefSessionSchema.safeParse(body.session);

    if (!parsed.success) {
      return NextResponse.json(
        { error: t.debriefSessionInvalid },
        { status: 400 }
      );
    }
    if (!parsed.data.areas.some((area) => area.runs.length > 0)) {
      return NextResponse.json({ error: t.nothingMeasured }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is not configured');
      return NextResponse.json({ error: t.aiNotConfigured }, { status: 500 });
    }

    const user = await getCurrentUser();
    limit = await aiRateLimit(request, 'debriefCoach', user);
    if (limit.response) return limit.response;
    // For the shifting tool; without it the coach falls back to the RPM in the laps
    const rpmLimit = await carRpmLimit(user?.id ?? null, parsed.data.car).catch(() => null);
    const [language, units] = await Promise.all([getLanguage(user), getUnits(user)]);
    const { debrief, steps, optimalLap } = await limit.track(() => runDebriefCoach(parsed.data, language, units, rpmLimit));

    // Kept for signed-in users (e.g. for the Discord bot's /coach debrief). Saving is extra, so a failure
    // is logged rather than costing them the debrief.
    try {
      if (user) await saveDebrief(user.id, parsed.data, debrief);
    } catch (error) {
      console.error('Save debrief error:', error);
    }

    // optimalLap is the theoretical lap's plan (src/lib/optimalLap.ts), which the browser stitches from the lap CSVs
    return NextResponse.json({ success: true, debrief, steps, optimalLap }, { status: 200 });
  } catch (error) {
    console.error('Debrief coach error:', error);
    await limit?.refund();
    return aiErrorResponse(error, t.failedDebrief, t.aiOutOfCredits);
  }
}
