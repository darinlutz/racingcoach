import { NextResponse } from 'next/server';
import { aiErrorResponse } from '@/lib/aiErrors';
import { carRpmLimit } from '@/lib/carData';
import { debriefSessionSchema, runDebriefCoach } from '@/lib/debriefCoach';
import { saveDebrief } from '@/lib/debriefHistory';
import { getCurrentUser } from '@/lib/session';
import { apiText, getLanguage } from '@/lib/i18n/server';
import { aiRateLimit, type AiRateLimit } from '@/lib/rateLimits';
import { readJsonLimited } from '@/lib/requestBody';
import { getUnits } from '@/lib/unitsServer';
import { z } from 'zod';
import { weatherContextFromLaps } from '@/lib/engineering/weatherContext';

// Each recorded lap's weather and tires (src/lib/collectorLaps.ts's LapConditions) and when it was completed, which
// the page sends beside the session; dropped lap files have none
const lapWeatherSchema = z
  .array(
    z.object({
      conditions: z
        .object({
          trackTempC: z.number().nullish(),
          airTempC: z.number().nullish(),
          relativeHumidity: z.number().nullish(),
          windVelocity: z.number().nullish(),
          windDirection: z.number().nullish(),
          precipitation: z.number().min(0).max(1).nullish(),
          trackWetness: z.number().int().min(0).max(20).nullish(),
          declaredWet: z.boolean().nullish(),
          tireCompound: z.number().int().nullish(),
          tireCompoundType: z.string().max(50).nullish(),
        })
        .nullable(),
      completedAt: z.string().max(40).nullable(),
    })
  )
  .max(100);

// The agent makes several model calls (one per tool round), so give it more than the default
export const maxDuration = 60;

export async function POST(request: Request) {
  const t = await apiText();
  let limit: AiRateLimit | null = null;
  try {
    const body = await readJsonLimited(request, 4 * 1024 * 1024).catch(() => ({}));
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

    // Signed-in users only, so visitors can't run the AI
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: t.logInAi }, { status: 401 });
    }
    limit = await aiRateLimit(request, 'debriefCoach', user);
    if (limit.response) return limit.response;
    // For the shifting tool; without it the coach falls back to the RPM in the laps
    const rpmLimit = await carRpmLimit(parsed.data.car).catch(() => null);
    const [language, units] = await Promise.all([getLanguage(user), getUnits(user)]);
    // The session's weather from its recorded laps (engineering/weatherContext.ts); null when none of them say
    const lapWeather = lapWeatherSchema.safeParse(body.weather);
    const weather =
      lapWeather.success && lapWeather.data.some((l) => l.conditions)
        ? weatherContextFromLaps(
            lapWeather.data
              .map((l) => ({ conditions: l.conditions, completedAt: l.completedAt ? Date.parse(l.completedAt) || null : null }))
              .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0)),
            Date.now(),
            parsed.data.car
          )
        : null;
    const { debrief, steps, optimalLap } = await limit.track(() => runDebriefCoach(parsed.data, language, units, rpmLimit, weather));

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
