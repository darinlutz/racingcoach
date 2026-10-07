import { NextResponse } from 'next/server';
import { raceTrendsRequestSchema, runRaceTrends } from '@/lib/raceTrends';

// The agent makes several model calls (one per tool round), so give it more than the default
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = raceTrendsRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Missing or invalid race results (needs at least 1 event)' }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is not configured');
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const { trend, incidents, commentary, steps } = await runRaceTrends(parsed.data);

    return NextResponse.json({ success: true, trend, incidents, commentary, steps }, { status: 200 });
  } catch (error) {
    console.error('Race trends error:', error);
    return NextResponse.json({ error: 'Failed to get the race trends' }, { status: 500 });
  }
}
