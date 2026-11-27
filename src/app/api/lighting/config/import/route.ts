import { NextResponse } from 'next/server';
import { LightingConfigConflict, saveLightingConfig } from '@/lib/lighting/lightingConfig';
import { parseLightingConfig } from '@/lib/lighting/model';
import { lightingDevice, lightingError } from '@/lib/lighting/routeHelpers';
import { readJsonLimited } from '@/lib/requestBody';

// The agent's own config.json, uploaded once when the account has no configuration yet (the move to Postgres keeps
// the controller address set on the Mac). POST { config }: 409 { currentVersion } once there is one, 400 { problems }
// when it doesn't pass parseLightingConfig.
export async function POST(request: Request) {
  const auth = await lightingDevice(request);
  if (auth.response) return auth.response;
  const body = await readJsonLimited(request, 200_000).catch(() => null);
  const parsed = parseLightingConfig(body?.config);
  if (!parsed.ok) return NextResponse.json({ error: 'Invalid configuration', code: 'invalid', problems: parsed.problems.slice(0, 50) }, { status: 400 });
  try {
    const version = await saveLightingConfig(auth.device.userId, parsed.config, 0);
    return NextResponse.json({ version });
  } catch (error) {
    if (error instanceof LightingConfigConflict) return NextResponse.json({ error: 'Already configured', code: 'conflict', currentVersion: error.currentVersion }, { status: 409 });
    console.error('Lighting config import error:', error);
    return lightingError('failed', 500, 'Config import failed');
  }
}
