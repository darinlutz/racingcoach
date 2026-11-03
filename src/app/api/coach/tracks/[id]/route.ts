import { NextResponse } from 'next/server';
import { apiText } from '@/lib/i18n/server';
import { canCoach } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import {
  maintenanceErrorReply,
  parseTrackAnalysisInput,
  TrackMaintenanceError,
  updateTrackAnalysis,
} from '@/lib/trackMaintenance';

// The Coach page's Track and Focus Area Maintenance section: saves a track's Racecar Analysis details.
// Body: { averageSpeedMph: number | null, typicalLapSeconds: number | null, analysisNotes: string | null }, the
// speed in mph whatever the user's Preferred Units. Answers { track }.
// Coach and Admin roles only; anyone else gets a 404, like the Coach page.

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !canCoach(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    const { id } = await params;
    if (!/^\d{1,9}$/.test(id)) {
      return NextResponse.json({ error: t.trackNotFound }, { status: 404 });
    }
    const input = parseTrackAnalysisInput(await request.json().catch(() => ({})));
    if (!input) {
      return NextResponse.json({ error: t.invalidTrackAnalysis }, { status: 400 });
    }
    const track = await updateTrackAnalysis(Number(id), input);
    console.log(`Track Maintenance: Racecar Analysis details of track ${id} saved by user ${user.id}`);
    return NextResponse.json({ track });
  } catch (error) {
    if (error instanceof TrackMaintenanceError) {
      const reply = maintenanceErrorReply(error.reason);
      return NextResponse.json({ error: t[reply.key] }, { status: reply.status });
    }
    console.error('Save track details error:', error);
    return NextResponse.json({ error: t.failedSaveTrack }, { status: 500 });
  }
}
