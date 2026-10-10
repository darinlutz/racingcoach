import { NextResponse } from 'next/server';
import { aiErrorResponse } from '@/lib/aiErrors';
import { summarizeMultiLap } from '@/lib/lapSummary';

// Multi-lap statistics for one track are a few KB; anything much bigger isn't a multi-lap analysis
const MAX_STATS_CHARS = 20000;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const stats = body.stats;
    const track = typeof body.track === 'string' && body.track.trim() ? body.track.trim() : 'the track';

    if (!stats || typeof stats !== 'string' || !stats.trim()) {
      return NextResponse.json({ error: 'Missing multi-lap statistics to analyze' }, { status: 400 });
    }
    if (stats.length > MAX_STATS_CHARS) {
      return NextResponse.json({ error: 'Multi-lap statistics are too long to analyze' }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is not configured');
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const summary = await summarizeMultiLap(stats, track);

    return NextResponse.json({ success: true, summary }, { status: 200 });
  } catch (error) {
    console.error('Multi-lap summary error:', error);
    return aiErrorResponse(error, 'Failed to analyze the laps');
  }
}
