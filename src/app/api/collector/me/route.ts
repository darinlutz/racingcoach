import { NextResponse } from 'next/server';
import { authenticateCollector } from '@/lib/collectorKeys';
import { hasAcceptedCurrentPolicies } from '@/lib/policyAcceptances';
import { getUserById } from '@/lib/users';

// Lets the telemetry collector check an upload key when the user enters it, and show whose account
// its laps will go to, and tells it the user's Preferred Units ("standard" or "metric"), which its windows show
// speeds, distances, temperatures and fuel in, Preferred Language ("en", "pt", "es" or "de"), which its overlays are in,
// and "Beeps before braking" (brakeBeeps) and its volume (brakeBeepsVolume, 10-100), which its window shows and changes
// (PUT /api/collector/brake-beeps), and whether the account has accepted the current Terms of Service and Privacy
// Policy (policiesAccepted; when not, the collector's window asks the user to review them on the website).
// Authenticated with the key as a bearer token, like /api/collector/laps.
export async function GET(request: Request) {
  try {
    const userId = await authenticateCollector(request);
    const user = userId === null ? null : await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: 'Missing or unknown upload key' }, { status: 401 });
    }
    return NextResponse.json({
      userName: user.userName,
      units: user.units,
      language: user.preferredLanguage,
      brakeBeeps: user.brakeBeeps,
      brakeBeepsVolume: user.brakeBeepsVolume,
      policiesAccepted: await hasAcceptedCurrentPolicies(user.id),
    });
  } catch (error) {
    console.error('Collector key check error:', error);
    return NextResponse.json({ error: 'Failed to check the upload key' }, { status: 500 });
  }
}
