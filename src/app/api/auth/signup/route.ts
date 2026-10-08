import { NextResponse } from 'next/server';
import { IRacePlanAuthError } from '@/lib/iRacePlan';
import { fetchIRacingProfile, NoIRacingProfileError, saveConnection } from '@/lib/raceHistory';
import { createSession } from '@/lib/session';
import { createUser, EmailTakenError } from '@/lib/users';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const emailAddress = typeof body.emailAddress === 'string' ? body.emailAddress.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!apiKey || !emailAddress || !password) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
    }
    if (apiKey.length > 500) {
      return NextResponse.json({ error: 'Invalid iRacePlan API key' }, { status: 400 });
    }
    if (!EMAIL_REGEX.test(emailAddress)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    // The account's name is the driver's iRacing name, and the key becomes their iRacePlan connection
    const profile = await fetchIRacingProfile(apiKey);
    const user = await createUser({ userName: profile.display_name, emailAddress, password });
    await saveConnection(user.id, apiKey, profile);
    await createSession(user.id);
    return NextResponse.json({ user: { userName: user.userName } }, { status: 201 });
  } catch (error) {
    if (error instanceof EmailTakenError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof IRacePlanAuthError) {
      return NextResponse.json({ error: 'iRacePlan did not accept that API key' }, { status: 400 });
    }
    if (error instanceof NoIRacingProfileError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Signup error:', error);
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
  }
}
