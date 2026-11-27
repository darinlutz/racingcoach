import { NextResponse } from 'next/server';
import { LightingConfigConflict, readLightingConfig, saveLightingConfig } from '@/lib/lighting/lightingConfig';
import { defaultConfig, parseLightingConfig } from '@/lib/lighting/model';
import { lightingAdmin, lightingError } from '@/lib/lighting/routeHelpers';
import { readJsonLimited } from '@/lib/requestBody';

// Lighting Control's configuration (src/lib/lighting/lightingConfig.ts): controllers, zones, scenes, event rules and
// settings. GET { version, config, saved }: the saved configuration, or the defaults (version 0, saved false) before
// the first save or the agent's upload. PUT { expectedVersion, config } replaces it whole: 400 { problems } when it
// doesn't pass parseLightingConfig, 409 { currentVersion } when it changed since it was read. Admins only; 404 otherwise.
export async function GET() {
  const admin = await lightingAdmin();
  if (admin.response) return admin.response;
  try {
    const config = await readLightingConfig(admin.user.id);
    return NextResponse.json(
      config ? { version: config.version, config, saved: true } : { version: 0, config: { ...defaultConfig(), version: 0 }, saved: false },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Lighting config read error:', error);
    return lightingError('failed', 500);
  }
}

export async function PUT(request: Request) {
  const admin = await lightingAdmin();
  if (admin.response) return admin.response;
  const body = await readJsonLimited(request, 200_000).catch(() => null);
  const expectedVersion = typeof body?.expectedVersion === 'number' && Number.isInteger(body.expectedVersion) ? body.expectedVersion : -1;
  const parsed = parseLightingConfig(body?.config);
  if (!parsed.ok) return NextResponse.json({ error: 'invalid', code: 'invalid', problems: parsed.problems.slice(0, 50) }, { status: 400 });
  if (expectedVersion < 0) return lightingError('invalid', 400);
  try {
    const version = await saveLightingConfig(admin.user.id, parsed.config, expectedVersion);
    return NextResponse.json({ version });
  } catch (error) {
    if (error instanceof LightingConfigConflict) return NextResponse.json({ error: 'conflict', code: 'conflict', currentVersion: error.currentVersion }, { status: 409 });
    console.error('Lighting config save error:', error);
    return lightingError('failed', 500);
  }
}
