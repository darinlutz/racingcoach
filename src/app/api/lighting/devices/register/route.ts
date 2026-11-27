import { NextResponse } from 'next/server';
import { lightingEnabled, startDevicePairing } from '@/lib/lighting/devices';
import { lightingError, overLightingAttempts } from '@/lib/lighting/routeHelpers';
import { readJsonLimited } from '@/lib/requestBody';

// The lighting agent asks to be paired (src/lib/lighting/devices.ts). POST { name } answers { code, pairingSecret,
// expiresAt }: the agent shows the code, the owner types it on the Admin page's Lighting Control, and the agent
// claims its device token with the secret (POST /api/lighting/devices/claim). No sign-in; 10 an hour per IP address.
export async function POST(request: Request) {
  if (!lightingEnabled()) return lightingError('lightingDisabled', 404, 'Not found');
  if (overLightingAttempts(request, 'register', 10)) return lightingError('tooManyAttempts', 429, 'Too many pairing requests');
  try {
    const body = await readJsonLimited(request, 2000).catch(() => ({}));
    return NextResponse.json(await startDevicePairing(body?.name));
  } catch (error) {
    console.error('Lighting pairing error:', error);
    return lightingError('failed', 500, 'Pairing failed');
  }
}
