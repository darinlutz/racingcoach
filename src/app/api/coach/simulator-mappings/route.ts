import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { apiText } from '@/lib/i18n/server';
import { canCoach } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { MAPPABLE_SIMULATORS } from '@/lib/simulatorCatalogs';
import { listSimulatorMappings, mapSimulatorCar, mapSimulatorTrack } from '@/lib/simulatorMappings';
import { ensureUserSchema } from '@/lib/users';

// The Coach page's Simulator Mapping (src/components/SimulatorMappings.tsx): which of the site's tracks and cars
// another simulator's are (simulatorMappings.ts).
//   GET ?simulator=acc answers listSimulatorMappings.
//   PUT { simulator, kind: "track" | "car", nativeKey, siteId: number | null } maps one (null removes the mapping),
//   re-labelling that track's or car's stored laps, and answers the list again.
// Coach and Admin roles only; anyone else gets a 404, like the Coach page.

function simulatorOf(value: unknown): string | null {
  return typeof value === 'string' && MAPPABLE_SIMULATORS.includes(value) ? value : null;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  if (!user || !canCoach(user.role)) {
    return NextResponse.json({ error: t.adminOnly }, { status: 404 });
  }
  const simulator = simulatorOf(new URL(request.url).searchParams.get('simulator'));
  if (!simulator) {
    return NextResponse.json({ error: t.invalidSimulatorMapping }, { status: 400 });
  }
  try {
    await ensureUserSchema();
    return NextResponse.json(await listSimulatorMappings(simulator));
  } catch (error) {
    console.error('Simulator mapping list error:', error);
    return NextResponse.json({ error: t.failedSaveSimulatorMapping }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  if (!user || !canCoach(user.role)) {
    return NextResponse.json({ error: t.adminOnly }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const simulator = simulatorOf(body?.simulator);
  const kind = body?.kind;
  const nativeKey = typeof body?.nativeKey === 'string' ? body.nativeKey.trim() : '';
  const siteId = body?.siteId;
  if (
    !simulator ||
    (kind !== 'track' && kind !== 'car') ||
    !nativeKey ||
    nativeKey.length > 200 ||
    !(siteId === null || (Number.isInteger(siteId) && (siteId as number) > 0))
  ) {
    return NextResponse.json({ error: t.invalidSimulatorMapping }, { status: 400 });
  }
  try {
    await ensureUserSchema();
    const id = siteId as number | null;
    if (id !== null) {
      const table = kind === 'track' ? 'Tracks' : 'Cars';
      const rows = await query(`SELECT 1 FROM racingcoach."${table}" WHERE id = $1`, [id]);
      if (rows.length === 0) return NextResponse.json({ error: t.invalidSimulatorMapping }, { status: 400 });
    }
    const mapped = kind === 'track' ? await mapSimulatorTrack(simulator, nativeKey, id) : await mapSimulatorCar(simulator, nativeKey, id);
    if (!mapped) return NextResponse.json({ error: t.invalidSimulatorMapping }, { status: 400 });
    console.log(`Simulator Mapping: ${simulator} ${kind} ${nativeKey} -> ${id ?? 'none'} by user ${user.id}`);
    return NextResponse.json(await listSimulatorMappings(simulator));
  } catch (error) {
    console.error('Simulator mapping save error:', error);
    return NextResponse.json({ error: t.failedSaveSimulatorMapping }, { status: 500 });
  }
}
