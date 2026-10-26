import { NextResponse } from 'next/server';
import { deleteExpertLap, readExpertLap } from '@/lib/expertLaps';
import { apiText } from '@/lib/i18n/server';
import { canCoach } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';

// One of the Coach page's Expert Laps (src/lib/expertLaps.ts).
//   GET     the lap's CSV, as a download
//   DELETE  removes it
// Coach and Admin roles only; anyone else gets a 404, like the Coach page.

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !canCoach(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    const { id } = await params;
    const lap = /^\d{1,9}$/.test(id) ? await readExpertLap(Number(id)) : null;
    if (!lap) {
      return NextResponse.json({ error: t.expertLapNotFound }, { status: 404 });
    }
    // An ASCII fallback name plus the exact name (RFC 6266), as names can hold any characters
    const fallback = lap.fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
    return new Response(lap.csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(lap.fileName)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('Expert Lap read error:', error);
    return NextResponse.json({ error: t.failedLoadExpertLap }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !canCoach(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    const { id } = await params;
    if (!/^\d{1,9}$/.test(id) || !(await deleteExpertLap(Number(id)))) {
      return NextResponse.json({ error: t.expertLapNotFound }, { status: 404 });
    }
    console.log(`Expert Lap ${id} deleted by user ${user.id}`);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Expert Lap delete error:', error);
    return NextResponse.json({ error: t.failedRemoveExpertLap }, { status: 500 });
  }
}
