import { NextResponse } from 'next/server';
import { IRacePlanAuthError } from '@/lib/iRacePlan';
import { connect, disconnect, NoIRacingProfileError } from '@/lib/raceHistory';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { apiText } from '@/lib/i18n/server';


// Saves the user's iRacePlan API key after checking it with iRacePlan
export async function PUT(request: Request) {
  const t = await apiText();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: t.logInConnect }, { status: 401 });
    }
    // My Race Trends is for Admins only
    if (!isAdmin(user.role)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!apiKey || apiKey.length > 500) {
      return NextResponse.json({ error: t.enterApiKey }, { status: 400 });
    }

    const connection = await connect(user.id, apiKey);
    return NextResponse.json({ connection });
  } catch (error) {
    if (error instanceof IRacePlanAuthError) {
      return NextResponse.json({ error: t.apiKeyRejected }, { status: 400 });
    }
    if (error instanceof NoIRacingProfileError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('iRacePlan connect error:', error);
    return NextResponse.json({ error: t.failedConnect }, { status: 502 });
  }
}

// Forgets the key; races already loaded stay
export async function DELETE() {
  const t = await apiText();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: t.logInConnect }, { status: 401 });
    }
    // My Race Trends is for Admins only
    if (!isAdmin(user.role)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await disconnect(user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('iRacePlan disconnect error:', error);
    return NextResponse.json({ error: t.failedDisconnect }, { status: 500 });
  }
}
