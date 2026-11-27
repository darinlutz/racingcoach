import { NextResponse } from 'next/server';
import { agentStatus } from '@/lib/lighting/agentStatus';
import { approveDevicePairing, listLightingDevices } from '@/lib/lighting/devices';
import { lightingSnapshot } from '@/lib/lighting/hub';
import { lightingAdmin, lightingError, overLightingAttempts } from '@/lib/lighting/routeHelpers';
import { readJsonLimited } from '@/lib/requestBody';

// The Admin page's Lighting Control (docs/lighting/README.md). GET answers { devices, snapshot }: the account's paired
// lighting agents with each one's last heartbeat (src/lib/lighting/agentStatus.ts), and the driver's lighting state.
// POST { code } approves the pairing code an agent shows (src/lib/lighting/devices.ts): 404 notFound when no live
// code matches. Admins only (Lighting Control is being built); anyone else 404.
export async function GET() {
  const admin = await lightingAdmin();
  if (admin.response) return admin.response;
  try {
    const devices = await listLightingDevices(admin.user.id);
    return NextResponse.json({
      devices: devices.map((d) => ({ ...d, status: agentStatus(d.id) })),
      snapshot: lightingSnapshot(admin.user.id),
    });
  } catch (error) {
    console.error('Lighting devices list error:', error);
    return lightingError('failed', 500);
  }
}

export async function POST(request: Request) {
  const admin = await lightingAdmin();
  if (admin.response) return admin.response;
  if (overLightingAttempts(request, `approve:${admin.user.id}`, 20)) return lightingError('tooManyAttempts', 429);
  const body = await readJsonLimited(request, 2000).catch(() => null);
  if (typeof body?.code !== 'string') return lightingError('invalid', 400);
  try {
    const approved = await approveDevicePairing(body.code, admin.user.id);
    return approved ? NextResponse.json(approved) : lightingError('notFound', 404);
  } catch (error) {
    console.error('Lighting approve error:', error);
    return lightingError('failed', 500);
  }
}
