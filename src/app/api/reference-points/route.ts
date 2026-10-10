import { NextResponse } from 'next/server';
import { aiErrorResponse } from '@/lib/aiErrors';
import { referenceSessionSchema, runReferencePoints } from '@/lib/referencePoints';

// The agent makes several model calls (one per tool round), so give it more than the default
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = referenceSessionSchema.safeParse(body.session);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Missing or invalid session data (needs at least 1 lap and 1 focus area)' }, { status: 400 });
    }
    if (!parsed.data.areas.some((area) => area.runs.length > 0)) {
      return NextResponse.json({ error: 'None of the laps could be measured in any focus area' }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is not configured');
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const { rows, commentary, steps } = await runReferencePoints(parsed.data);

    return NextResponse.json({ success: true, rows, commentary, steps }, { status: 200 });
  } catch (error) {
    console.error('Reference points error:', error);
    return aiErrorResponse(error, 'Failed to get the reference points');
  }
}
