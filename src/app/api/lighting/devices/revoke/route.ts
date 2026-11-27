import { NextResponse } from 'next/server';
import { forgetAgentStatus } from '@/lib/lighting/agentStatus';
import { revokeLightingDevice } from '@/lib/lighting/devices';
import { lightingDevice, lightingError } from '@/lib/lighting/routeHelpers';

// The lighting agent unpairs itself (racingcoach-lighting unpair): its device and access tokens end at once
export async function POST(request: Request) {
  const auth = await lightingDevice(request);
  if (auth.response) return auth.response;
  try {
    await revokeLightingDevice(auth.device.deviceId, auth.device.userId);
    forgetAgentStatus(auth.device.deviceId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Lighting revoke error:', error);
    return lightingError('failed', 500, 'Revoke failed');
  }
}
