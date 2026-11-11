import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aiErrorResponse } from '@/lib/aiErrors';
import { lapDrivingLinesSchema } from '@/lib/lapDrivingLine';
import { readRecentLapSummaries, saveLapSummary } from '@/lib/lapSummaryHistory';
import { summarizeLapComparison } from '@/lib/lapSummary';
import { apiText, getLanguage } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';
import { aiRateLimit, type AiRateLimit } from '@/lib/rateLimits';
import { readJsonLimited } from '@/lib/requestBody';
import { canUseLapSummary } from '@/lib/roles';
import { getUnits } from '@/lib/unitsServer';

// Focus-area text for one track is a few KB; anything much bigger isn't a lap comparison
const MAX_COMPARISON_CHARS = 20000;

export async function POST(request: Request) {
  const t = await apiText();
  let limit: AiRateLimit | null = null;
  try {
    const body = await readJsonLimited(request, 1024 * 1024).catch(() => ({}));
    const comparison = body.comparison;
    const track = typeof body.track === 'string' && body.track.trim() ? body.track.trim() : 'the track';

    if (!comparison || typeof comparison !== 'string' || !comparison.trim()) {
      return NextResponse.json({ error: t.missingComparison }, { status: 400 });
    }
    if (comparison.length > MAX_COMPARISON_CHARS) {
      return NextResponse.json({ error: t.comparisonTooLong }, { status: 400 });
    }
    // The focus areas' driving lines, for the coach's analyze_driving_line tool; every focus area's name
    const lines = lapDrivingLinesSchema.safeParse(body.lines ?? []);
    const areaNames = z.array(z.string().max(100)).max(50).safeParse(body.areaNames ?? []);
    if (!lines.success || !areaNames.success) {
      return NextResponse.json({ error: t.invalidDrivingLines }, { status: 400 });
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
    // Silver and Gold members and Admins only, before any AI call
    if (!canUseLapSummary(user)) {
      return NextResponse.json({ error: t.lapSummaryMembersOnly, code: 'membershipRequired' }, { status: 403 });
    }
    limit = await aiRateLimit(request, 'lapSummary', user);
    if (limit.response) return limit.response;
    const [language, units, recent] = await Promise.all([getLanguage(user), getUnits(user), readRecentLapSummaries(user.id, 'lap', track)]);
    const summary = await limit.track(() =>
      summarizeLapComparison(
        comparison,
        track,
        language,
        units,
        lines.data,
        areaNames.data.length > 0 ? areaNames.data : lines.data.map((l) => l.area),
        recent
      )
    );

    // Kept for signed-in users, like Debrief Coach runs. Saving is extra, so a failure is logged rather than costing
    // them the summary.
    try {
      await saveLapSummary(user.id, 'lap', track, comparison, summary);
    } catch (error) {
      console.error('Save lap summary error:', error);
    }

    return NextResponse.json({ success: true, summary }, { status: 200 });
  } catch (error) {
    console.error('Lap summary error:', error);
    await limit?.refund();
    return aiErrorResponse(error, t.failedLapSummary, t.aiOutOfCredits);
  }
}
