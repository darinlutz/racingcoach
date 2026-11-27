import { NextResponse } from 'next/server';
import { claimDevicePairing, lightingEnabled } from '@/lib/lighting/devices';
import { lightingError, overLightingAttempts } from '@/lib/lighting/routeHelpers';
import { readJsonLimited } from '@/lib/requestBody';

// The lighting agent's check on its pairing (src/lib/lighting/devices.ts). POST { pairingSecret } answers
// { status: 'pending', expiresAt }, { status: 'expired' }, or once the owner approved the code, { status: 'paired',
// deviceId, deviceToken }: the token is answered this once, for the agent's Keychain. 240 an hour per IP address (the
// agent checks every few seconds for the code's 10 minutes).
export async function POST(request: Request) {
  if (!lightingEnabled()) return lightingError('lightingDisabled', 404, 'Not found');
  if (overLightingAttempts(request, 'claim', 240)) return lightingError('tooManyAttempts', 429, 'Too many checks');
  const body = await readJsonLimited(request, 2000).catch(() => null);
  const secret = typeof body?.pairingSecret === 'string' ? body.pairingSecret : '';
  if (!/^rclp_[A-Za-z0-9_-]{20,100}$/.test(secret)) return lightingError('invalid', 400, 'Missing pairingSecret');
  try {
    return NextResponse.json(await claimDevicePairing(secret));
  } catch (error) {
    console.error('Lighting claim error:', error);
    return lightingError('failed', 500, 'Claim failed');
  }
}
