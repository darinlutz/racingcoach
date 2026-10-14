import { NextResponse } from 'next/server';
import { readCollectorLapCsv } from '@/lib/collectorLaps';
import { canSeeAllLaps } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { apiText } from '@/lib/i18n/server';

// One uploaded lap as CSV, for analysing it in the browser like a dropped file. Users can only open their own
// laps (anyone else's is a 404, as if it didn't exist); Coaches and Admins can open any driver's.
// ?download=<file name> sends it as an attachment, so every browser saves it (Safari can ignore the
// link's download attribute and show the CSV as text instead).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    const headers: Record<string, string> = {
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': 'private, max-age=86400',
    };
    const download = new URL(request.url).searchParams.get('download');
    if (download) {
      // An ASCII fallback name plus the exact name (RFC 6266), as names can hold any characters
      const fallback = download.replace(/[^\x20-\x7e]|["\\]/g, '_');
      headers['Content-Disposition'] =
        `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(download)}`;
    }
    return new Response(csv, { headers });
  } catch (error) {
    console.error('Collector lap read error:', error);
    return NextResponse.json({ error: t.failedLoadLap }, { status: 500 });
  }
}
