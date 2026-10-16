import { NextResponse } from 'next/server';
import { apiText } from '@/lib/i18n/server';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { createTrack, maintenanceErrorReply, parseTrackInput, TrackMaintenanceError } from '@/lib/trackMaintenance';

// The Admin page's Track and Focus Area Maintenance section: adds a track.
// Body: { key: string, name: string, numberOfCorners: number | null }. Answers { track }.
// Admin role only; anyone else gets a 404, like the Admin page.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !isAdmin(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    const input = parseTrackInput(await request.json().catch(() => ({})));
    if (!input) {
      return NextResponse.json({ error: t.invalidTrack }, { status: 400 });
    }
    const track = await createTrack(input);
    console.log(`Track Maintenance: track ${track.id} (${track.key}) added by user ${user.id}`);
    return NextResponse.json({ track });
  } catch (error) {
    if (error instanceof TrackMaintenanceError) {
      const reply = maintenanceErrorReply(error.reason);
      return NextResponse.json({ error: t[reply.key] }, { status: reply.status });
    }
    console.error('Add track error:', error);
    return NextResponse.json({ error: t.failedSaveTrack }, { status: 500 });
  }
}
