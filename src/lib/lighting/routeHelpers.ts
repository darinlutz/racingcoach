import { NextResponse } from 'next/server';
import { clientIp } from '../clientIp';
import { getCurrentUser } from '../session';
import { overAttemptLimit } from '../tvAuth';
import type { User } from '../users';
import { authenticateLightingDevice, canUseLighting, lightingEnabled, type LightingDevice } from './devices';

// Shared by the lighting routes (src/app/api/lighting/, src/app/api/admin/lighting/). The agent's routes answer codes
// with a short English error, as only the agent reads them (its log, for the owner); the Admin page shows its own
// words for each code from the dictionaries.

export const lightingError = (code: string, status: number, error = code) => NextResponse.json({ error, code }, { status });

// The agent's routes: the device from its access token, or a 401 the agent answers by getting a new token
export async function lightingDevice(request: Request): Promise<{ device: LightingDevice; response?: never } | { response: NextResponse }> {
  if (!lightingEnabled()) return { response: lightingError('lightingDisabled', 404, 'Not found') };
  const device = await authenticateLightingDevice(request).catch((error) => {
    console.error('Lighting device sign-in error:', error);
    return null;
  });
  return device ? { device } : { response: lightingError('unauthorized', 401, 'Missing, expired or revoked access token') };
}

// The routes an agent calls before it has a token (register, claim, token): this many an hour per IP address
export function overLightingAttempts(request: Request, route: string, max = 30): boolean {
  return overAttemptLimit(`lighting:${route}:${clientIp(request) ?? 'unknown'}`, max, 60 * 60_000);
}

// The Admin page's lighting routes: Admins only while Lighting Control is being built, 404 for anyone else
export async function lightingAdmin(): Promise<{ user: User; response?: never } | { response: NextResponse }> {
  const user = await getCurrentUser();
  return canUseLighting(user) && user ? { user } : { response: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
}
