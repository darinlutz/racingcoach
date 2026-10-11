import { NextResponse } from 'next/server';
import { aiErrorResponse } from '@/lib/aiErrors';
import { summarizeStint } from '@/lib/lapSummary';
import { apiText } from '@/lib/i18n/server';

// A stint report is a few KB; anything much bigger isn't a stint report
const MAX_REPORT_CHARS = 20000;

export async function POST(request: Request) {
  const t = await apiText();
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

    const summary = await summarizeStint(report, track);

    return NextResponse.json({ success: true, summary }, { status: 200 });
  } catch (error) {
    console.error('Stint summary error:', error);
    return aiErrorResponse(error, 'Failed to analyze the stint');
  }
}
