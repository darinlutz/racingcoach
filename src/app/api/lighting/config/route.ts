import { NextResponse } from 'next/server';
import { readLightingConfig } from '@/lib/lighting/lightingConfig';
import { lightingDevice, lightingError } from '@/lib/lighting/routeHelpers';

// The installation's configuration for the device's own account (src/lib/lighting/lightingConfig.ts), which the agent
// caches: { version, config }, config null (version 0) when there's none yet, and the agent uploads its own once
// (POST /api/lighting/config/import). It has the controllers' home network addresses, so only the owner's agents get it.
export async function GET(request: Request) {
  const auth = await lightingDevice(request);
  if (auth.response) return auth.response;
  try {
    const config = await readLightingConfig(auth.device.userId);
    return NextResponse.json({ version: config?.version ?? 0, config }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Lighting config read error:', error);
    return lightingError('failed', 500, 'Config read failed');
  }
}
