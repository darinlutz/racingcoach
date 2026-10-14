import { NextResponse } from 'next/server';
import { authenticateCollector } from '@/lib/collectorKeys';
import { getUserById } from '@/lib/users';

// Lets the telemetry collector check an upload key when the user enters it, and show whose account
// its laps will go to, and tells it the user's Preferred Units ("standard" or "metric"), which its windows show
// speeds, distances, temperatures and fuel in. Authenticated with the key as a bearer token, like /api/collector/laps.
export async function GET(request: Request) {
  try {
    const userId = await authenticateCollector(request);
    const user = userId === null ? null : await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: 'Missing or unknown upload key' }, { status: 401 });
    }
    return NextResponse.json({ userName: user.userName, units: user.units });
  } catch (error) {
    console.error('Collector key check error:', error);
    return NextResponse.json({ error: 'Failed to check the upload key' }, { status: 500 });
  }
}
