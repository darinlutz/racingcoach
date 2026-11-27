import { NextResponse } from 'next/server';
import { lightingSnapshot } from '@/lib/lighting/hub';
import { lightingDevice } from '@/lib/lighting/routeHelpers';

// The driver's lighting state now (src/lib/lighting/hub.ts): the agent's starting point, and its fallback when the
// event stream can't be held open. Only the device's own account: the driver is never a parameter.
export async function GET(request: Request) {
  const auth = await lightingDevice(request);
  if (auth.response) return auth.response;
  return NextResponse.json(lightingSnapshot(auth.device.userId), { headers: { 'Cache-Control': 'no-store' } });
}
