import { NextResponse } from 'next/server';
import { aiErrorResponse } from '@/lib/aiErrors';
import { referenceSessionSchema, runReferencePoints } from '@/lib/referencePoints';
import { apiText, getLanguage } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';
import { getUnits } from '@/lib/unitsServer';

// The agent makes several model calls (one per tool round), so give it more than the default
export const maxDuration = 60;

export async function POST(request: Request) {
  const t = await apiText();
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = referenceSessionSchema.safeParse(body.session);

    if (!parsed.success) {
      return NextResponse.json({ error: t.referenceSessionInvalid }, { status: 400 });
    }
    if (!parsed.data.areas.some((area) => area.runs.length > 0)) {
      return NextResponse.json({ error: t.nothingMeasured }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is not configured');
      return NextResponse.json({ error: t.aiNotConfigured }, { status: 500 });
    }

    const user = await getCurrentUser();
    const { rows, commentary, steps } = await runReferencePoints(parsed.data, await getLanguage(user), await getUnits(user));

    return NextResponse.json({ success: true, rows, commentary, steps }, { status: 200 });
  } catch (error) {
    console.error('Reference points error:', error);
    return aiErrorResponse(error, t.failedReferencePoints, t.aiOutOfCredits);
  }
}
