import { NextResponse } from 'next/server';
import { aiErrorResponse } from '@/lib/aiErrors';
import { summarizeLapComparison } from '@/lib/lapSummary';

// Focus-area text for one track is a few KB; anything much bigger isn't a lap comparison
const MAX_COMPARISON_CHARS = 20000;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const comparison = body.comparison;
    const track = typeof body.track === 'string' && body.track.trim() ? body.track.trim() : 'the track';

    if (!comparison || typeof comparison !== 'string' || !comparison.trim()) {
      return NextResponse.json({ error: 'Missing lap comparison to summarize' }, { status: 400 });
    }
    if (comparison.length > MAX_COMPARISON_CHARS) {
      return NextResponse.json({ error: 'Lap comparison is too long to summarize' }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is not configured');
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const summary = await summarizeLapComparison(comparison, track);

    return NextResponse.json({ success: true, summary }, { status: 200 });
  } catch (error) {
    console.error('Lap summary error:', error);
    return aiErrorResponse(error, 'Failed to summarize the laps');
  }
}
