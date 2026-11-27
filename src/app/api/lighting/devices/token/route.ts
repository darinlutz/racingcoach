import { NextResponse } from 'next/server';
import { issueAccessToken, lightingEnabled } from '@/lib/lighting/devices';
import { lightingError, overLightingAttempts } from '@/lib/lighting/routeHelpers';
import { readJsonLimited } from '@/lib/requestBody';

// A short-lived access token for a paired lighting agent (src/lib/lighting/devices.ts). POST { deviceToken } answers
// { accessToken, expiresAt } (15 minutes; the agent gets a new one before then), or 401 when the device was revoked
// or its account can no longer use Lighting Control, which the agent answers by asking to be paired again.
export async function POST(request: Request) {
  if (!lightingEnabled()) return lightingError('lightingDisabled', 404, 'Not found');
  if (overLightingAttempts(request, 'token', 120)) return lightingError('tooManyAttempts', 429, 'Too many token requests');
  const body = await readJsonLimited(request, 2000).catch(() => null);
  const deviceToken = typeof body?.deviceToken === 'string' ? body.deviceToken : '';
  if (!/^rcld_[A-Za-z0-9_-]{20,100}$/.test(deviceToken)) return lightingError('invalid', 400, 'Missing deviceToken');
  try {
    const issued = await issueAccessToken(deviceToken);
    return issued ? NextResponse.json(issued) : lightingError('revoked', 401, 'Device revoked');
  } catch (error) {
    console.error('Lighting token error:', error);
    return lightingError('failed', 500, 'Token failed');
  }
}
