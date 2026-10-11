import { NextResponse } from 'next/server';
import { readCollectorLapCsv } from '@/lib/collectorLaps';
import { getCurrentUser } from '@/lib/session';

// One of the signed-in user's uploaded laps as CSV, for analysing it in the browser like a dropped file
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Log in to see your recorded laps' }, { status: 401 });
    }
    const { id } = await params;
    if (!/^\d{1,9}$/.test(id)) {
      return NextResponse.json({ error: 'Lap not found' }, { status: 404 });
    }

    const csv = await readCollectorLapCsv(user.id, Number(id));
    if (csv === null) {
      return NextResponse.json({ error: 'Lap not found' }, { status: 404 });
    }
    return new Response(csv, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'private, max-age=86400' },
    });
  } catch (error) {
    console.error('Collector lap read error:', error);
    return NextResponse.json({ error: 'Failed to load the lap' }, { status: 500 });
  }
}
