import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { referencePointsInputSchema, saveReferencePoints, TrackNotFoundError } from '@/lib/tracks';

// Saves the Reference Points tab's measured points over the signed-in user's focus area targets
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Log in to save reference points to your tracks' }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const parsed = referencePointsInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Missing or invalid reference points' }, { status: 400 });
    }

    const result = await saveReferencePoints(user.id, parsed.data);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof TrackNotFoundError) {
      return NextResponse.json(
        { error: 'This track is not in your Track Data list. Add it there first.' },
        { status: 404 }
      );
    }
    console.error('Save reference points error:', error);
    return NextResponse.json({ error: 'Failed to save the reference points' }, { status: 500 });
  }
}
