import { NextResponse } from 'next/server';
import { apiText } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';
import { MAX_IN_CAR_COACH_INSTRUCTIONS, setInCarCoachInstructions } from '@/lib/users';

// The Account page's In-Car AI Coach Instructions, saved for the signed-in user only
// (racingcoach."Users".in_car_coach_instructions). Body: { instructions: string } (empty clears them).
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInInCarInstructions }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    if (typeof body.instructions !== 'string') {
      return NextResponse.json({ error: t.failedSaveInCarInstructions }, { status: 400 });
    }
    const instructions = body.instructions.trim();
    if (instructions.length > MAX_IN_CAR_COACH_INSTRUCTIONS) {
      return NextResponse.json({ error: t.inCarInstructionsTooLong }, { status: 400 });
    }

    await setInCarCoachInstructions(user.id, instructions);
    return NextResponse.json({ instructions });
  } catch (error) {
    console.error('In-Car AI Coach Instructions error:', error);
    return NextResponse.json({ error: t.failedSaveInCarInstructions }, { status: 500 });
  }
}
