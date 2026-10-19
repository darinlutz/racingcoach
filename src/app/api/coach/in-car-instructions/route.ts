import { NextResponse } from 'next/server';
import { apiText } from '@/lib/i18n/server';
import { canCoach } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { MAX_COACH_INSTRUCTIONS, setHeadCoachInCarInstructions } from '@/lib/siteSettings';

// The Coach page's In-Car AI Coach Instructions, for every driver's In-Car AI Coach. Body: { instructions: string }
// (empty clears them). Coach and Admin roles only; anyone else gets a 404, like the Coach page.
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !canCoach(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    if (typeof body.instructions !== 'string') {
      return NextResponse.json({ error: t.failedSaveInCarInstructions }, { status: 400 });
    }
    const instructions = body.instructions.trim();
    if (instructions.length > MAX_COACH_INSTRUCTIONS) {
      return NextResponse.json({ error: t.inCarInstructionsTooLong }, { status: 400 });
    }

    await setHeadCoachInCarInstructions(instructions, user.id);
    console.log(`Head coach's In-Car AI Coach Instructions saved (${instructions.length} characters) by user ${user.id}`);
    return NextResponse.json({ instructions });
  } catch (error) {
    console.error('Head coach In-Car AI Coach Instructions error:', error);
    return NextResponse.json({ error: t.failedSaveInCarInstructions }, { status: 500 });
  }
}
