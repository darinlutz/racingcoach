import { NextResponse } from 'next/server';
import { apiText } from '@/lib/i18n/server';
import { canCoach } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import {
  deleteFocusArea,
  maintenanceErrorReply,
  parseFocusAreaInput,
  TrackMaintenanceError,
  updateFocusArea,
} from '@/lib/trackMaintenance';

// The Coach page's Track and Focus Area Maintenance section: edits (PUT, same body as adding one) or deletes
// (DELETE) one of a track's focus areas. Both answer { areas }, the track's focus areas renumbered by start point.
// Coach and Admin roles only; anyone else gets a 404, like the Coach page.

type Params = { params: Promise<{ id: string; areaId: string }> };

export async function PUT(request: Request, { params }: Params) {
  return handle(params, 'edit', request);
}

export async function DELETE(request: Request, { params }: Params) {
  return handle(params, 'delete');
}

async function handle(params: Params['params'], action: 'edit' | 'delete', request?: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !canCoach(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    const { id, areaId } = await params;
    if (!/^\d{1,9}$/.test(id) || !/^\d{1,9}$/.test(areaId)) {
      return NextResponse.json({ error: t.focusAreaNotFound }, { status: 404 });
    }
    if (action === 'delete') {
      const areas = await deleteFocusArea(Number(id), Number(areaId));
      console.log(`Track Maintenance: focus area ${areaId} of track ${id} deleted by user ${user.id}`);
      return NextResponse.json({ areas });
    }
    const input = parseFocusAreaInput(await request!.json().catch(() => ({})));
    if (!input) {
      return NextResponse.json({ error: t.invalidFocusArea }, { status: 400 });
    }
    const areas = await updateFocusArea(Number(id), Number(areaId), input);
    console.log(`Track Maintenance: focus area ${areaId} of track ${id} edited by user ${user.id}`);
    return NextResponse.json({ areas });
  } catch (error) {
    if (error instanceof TrackMaintenanceError) {
      const reply = maintenanceErrorReply(error.reason);
      return NextResponse.json({ error: t[reply.key] }, { status: reply.status });
    }
    console.error(`Focus area ${action} error:`, error);
    return NextResponse.json({ error: t.failedSaveFocusArea }, { status: 500 });
  }
}
