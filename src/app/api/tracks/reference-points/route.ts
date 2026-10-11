import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { referencePointsInputSchema, saveReferencePoints, TrackNotFoundError } from '@/lib/tracks';
import { apiText } from '@/lib/i18n/server';

// Saves the Reference Points tab's measured points over the signed-in user's focus area targets
export async function POST(request: Request) {
  const t = await apiText();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: t.logInReferencePoints }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const parsed = referencePointsInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: t.invalidReferencePoints }, { status: 400 });
    }

    const result = await saveReferencePoints(user.id, parsed.data);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof TrackNotFoundError) {
      return NextResponse.json(
        { error: t.trackNotInList },
        { status: 404 }
      );
    }
    console.error('Save reference points error:', error);
    return NextResponse.json({ error: t.failedSaveReferencePoints }, { status: 500 });
  }
}
