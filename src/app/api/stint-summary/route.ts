import { NextResponse } from 'next/server';
import { aiErrorResponse } from '@/lib/aiErrors';
import { saveLapSummary } from '@/lib/lapSummaryHistory';
import { summarizeStint } from '@/lib/lapSummary';
import { apiText, getLanguage } from '@/lib/i18n/server';
import { aiRateLimit, type AiRateLimit } from '@/lib/rateLimits';
import { getCurrentUser } from '@/lib/session';

// A stint report is a few KB; anything much bigger isn't a stint report
const MAX_REPORT_CHARS = 20000;

export async function POST(request: Request) {
  const t = await apiText();
  let limit: AiRateLimit | null = null;
  try {
    const body = await request.json().catch(() => ({}));
    const report = body.report;
    const track = typeof body.track === 'string' && body.track.trim() ? body.track.trim() : 'the track';

    if (!report || typeof report !== 'string' || !report.trim()) {
      return NextResponse.json({ error: t.missingStint }, { status: 400 });
    }
    if (report.length > MAX_REPORT_CHARS) {
      return NextResponse.json({ error: t.stintTooLong }, { status: 400 });
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
    limit = await aiRateLimit(request, 'stintSummary', user);
    if (limit.response) return limit.response;
    const language = await getLanguage(user);
    const summary = await limit.track(() => summarizeStint(report, track, language));

    // Kept for signed-in users, like Debrief Coach runs. Saving is extra, so a failure is logged rather than costing
    // them the summary.
    try {
      await saveLapSummary(user.id, 'stint', track, report, summary);
    } catch (error) {
      console.error('Save lap summary error:', error);
    }

    return NextResponse.json({ success: true, summary }, { status: 200 });
  } catch (error) {
    console.error('Stint summary error:', error);
    await limit?.refund();
    return aiErrorResponse(error, t.failedStintSummary, t.aiOutOfCredits);
  }
}
