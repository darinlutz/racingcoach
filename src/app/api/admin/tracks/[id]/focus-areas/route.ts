import { NextResponse } from 'next/server';
import { apiText } from '@/lib/i18n/server';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { addFocusArea, maintenanceErrorReply, parseFocusAreaInput, TrackMaintenanceError } from '@/lib/trackMaintenance';

// The Admin page's Track and Focus Area Maintenance section: adds a focus area to a track.
// Body: { name, startPoint, endPoint (fractions of a lap), notes, brakePointFeet, maxBrakePct, throttlePointFeet }.
// Answers { areas }, the track's focus areas renumbered by start point.
// Admin role only; anyone else gets a 404, like the Admin page.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !isAdmin(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    const { id } = await params;
    if (!/^\d{1,9}$/.test(id)) {
      return NextResponse.json({ error: t.trackNotFound }, { status: 404 });
    }
    const input = parseFocusAreaInput(await request.json().catch(() => ({})));
    if (!input) {
      return NextResponse.json({ error: t.invalidFocusArea }, { status: 400 });
    }
    const areas = await addFocusArea(Number(id), input);
    console.log(`Track Maintenance: focus area "${input.name}" added to track ${id} by user ${user.id}`);
    return NextResponse.json({ areas });
  } catch (error) {
    if (error instanceof TrackMaintenanceError) {
      const reply = maintenanceErrorReply(error.reason);
      return NextResponse.json({ error: t[reply.key] }, { status: reply.status });
    }
    console.error('Add focus area error:', error);
    return NextResponse.json({ error: t.failedSaveFocusArea }, { status: 500 });
  }
}
