import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aiErrorResponse } from '@/lib/aiErrors';
import { lapDrivingLinesSchema } from '@/lib/lapDrivingLine';
import { summarizeLapComparison } from '@/lib/lapSummary';
import { apiText, getLanguage } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';
import { getUnits } from '@/lib/unitsServer';

// Focus-area text for one track is a few KB; anything much bigger isn't a lap comparison
const MAX_COMPARISON_CHARS = 20000;

export async function POST(request: Request) {
  const t = await apiText();
  try {
    const body = await request.json().catch(() => ({}));
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

    const user = await getCurrentUser();
    const summary = await summarizeLapComparison(
      comparison,
      track,
      await getLanguage(user),
      await getUnits(user),
      lines.data,
      areaNames.data.length > 0 ? areaNames.data : lines.data.map((l) => l.area)
    );

    return NextResponse.json({ success: true, summary }, { status: 200 });
  } catch (error) {
    console.error('Lap summary error:', error);
    return aiErrorResponse(error, t.failedLapSummary, t.aiOutOfCredits);
  }
}
