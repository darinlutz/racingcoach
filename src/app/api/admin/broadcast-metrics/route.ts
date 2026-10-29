import { NextResponse } from 'next/server';
import { broadcastMetrics } from '@/lib/broadcastMetrics';
import { apiText } from '@/lib/i18n/server';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';

// The Race Broadcast's performance and cost figures since this server started (src/lib/broadcastMetrics.ts): requests,
// how many needed no AI call, why events were suppressed, lines dropped by the factual check or for going stale,
// AI and speech latency, ElevenLabs characters, and the latest decisions with each event's verdict. Admin role only;
// anyone else gets a 404, like the Admin page.
export async function GET() {
  const user = await getCurrentUser();
  const t = await apiText(user);
  if (!user || !isAdmin(user.role)) {
    return NextResponse.json({ error: t.adminOnly }, { status: 404 });
  }
  return NextResponse.json(broadcastMetrics());
}
