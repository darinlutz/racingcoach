import { NextResponse } from 'next/server';
import { readCollectorLapCsv } from '@/lib/collectorLaps';
import { canSeeAllLaps } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { apiText } from '@/lib/i18n/server';

// One uploaded lap as CSV, for analysing it in the browser like a dropped file. Users can only open their own
// laps (anyone else's is a 404, as if it didn't exist); Coaches and Admins can open any driver's.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const t = await apiText();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: t.logInRecordedLaps }, { status: 401 });
    }
    const { id } = await params;
    if (!/^\d{1,9}$/.test(id)) {
      return NextResponse.json({ error: t.lapNotFound }, { status: 404 });
    }

    const csv = await readCollectorLapCsv(canSeeAllLaps(user.role) ? null : user.id, Number(id));
    if (csv === null) {
      return NextResponse.json({ error: t.lapNotFound }, { status: 404 });
    }
    return new Response(csv, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'private, max-age=86400' },
    });
  } catch (error) {
    console.error('Collector lap read error:', error);
    return NextResponse.json({ error: t.failedLoadLap }, { status: 500 });
  }
}
