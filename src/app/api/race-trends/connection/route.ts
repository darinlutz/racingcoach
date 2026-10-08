import { NextResponse } from 'next/server';
import { IRacePlanAuthError } from '@/lib/iRacePlan';
import { connect, disconnect, NoIRacingProfileError } from '@/lib/raceHistory';
import { getCurrentUser } from '@/lib/session';

const NOT_SIGNED_IN = { error: 'Log in to connect iRacePlan' };

// Saves the user's iRacePlan API key after checking it with iRacePlan
export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(NOT_SIGNED_IN, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!apiKey || apiKey.length > 500) {
      return NextResponse.json({ error: 'Enter your iRacePlan API key' }, { status: 400 });
    }

    const connection = await connect(user.id, apiKey);
    return NextResponse.json({ connection });
  } catch (error) {
    if (error instanceof IRacePlanAuthError) {
      return NextResponse.json({ error: 'iRacePlan did not accept that API key' }, { status: 400 });
    }
    if (error instanceof NoIRacingProfileError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('iRacePlan connect error:', error);
    return NextResponse.json({ error: 'Failed to connect iRacePlan' }, { status: 502 });
  }
}

// Forgets the key; races already loaded stay
export async function DELETE() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(NOT_SIGNED_IN, { status: 401 });
    }
    await disconnect(user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('iRacePlan disconnect error:', error);
    return NextResponse.json({ error: 'Failed to disconnect iRacePlan' }, { status: 500 });
  }
}
