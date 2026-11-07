import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { apiText } from '@/lib/i18n/server';
import { canCoach } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { ensureUserSchema } from '@/lib/users';

// The Coach page's Track Maintenance: Reset Learned Map clears what uploaded laps taught a track (its length,
// location, bounds and outline; src/lib/trackDataTrust.ts), for a track taught wrong. Its next clean lap with track
// positions teaches them again. Coach and Admin roles only; anyone else gets a 404, like the Coach page.
type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  if (!user || !canCoach(user.role)) {
    return NextResponse.json({ error: t.adminOnly }, { status: 404 });
  }
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) {
    return NextResponse.json({ error: t.trackNotFound }, { status: 404 });
  }
  try {
    await ensureUserSchema();
    const rows = await query(
      `UPDATE racingcoach."Tracks"
       SET track_length_feet = NULL, track_latitude = NULL, track_longitude = NULL, track_south = NULL, track_west = NULL,
           track_north = NULL, track_east = NULL, track_outline = NULL, updated_at = now()
       WHERE id = $1 RETURNING id`,
      [Number(id)]
    );
    if (rows.length === 0) return NextResponse.json({ error: t.trackNotFound }, { status: 404 });
    console.log(`Track Maintenance: learned map of track ${id} reset by user ${user.id}`);
    return NextResponse.json({ reset: true });
  } catch (error) {
    console.error('Reset learned track data error:', error);
    return NextResponse.json({ error: t.failedSaveTrack }, { status: 500 });
  }
}
