import { NextResponse } from 'next/server';
import { parseAgentStatus, recordAgentStatus } from '@/lib/lighting/agentStatus';
import { setDeviceVersion } from '@/lib/lighting/devices';
import { lightingSnapshot } from '@/lib/lighting/hub';
import { lightingConfigVersion } from '@/lib/lighting/lightingConfig';
import { lightingDevice, lightingError } from '@/lib/lighting/routeHelpers';
import { readJsonLimited } from '@/lib/requestBody';

// The lighting agent's status every few seconds, for the Admin page's Lighting Control dashboard
// (src/lib/lighting/agentStatus.ts, server memory). POST { version, mode, scene, activeOverride, lastEventSequence,
// lastEventLatencyMs, controllers: [{ id, name, online, firmware, lastAckMs, latencyMs }] }; never controller
// addresses. Answers the driver's lighting snapshot, so an agent whose event stream dropped still sees the state, and
// the configuration's version (src/lib/lighting/lightingConfig.ts), so the agent fetches it when it changed.
const versionWritten = new Map<number, string | null>();

export async function POST(request: Request) {
  const auth = await lightingDevice(request);
  if (auth.response) return auth.response;
  const { device } = auth;
  try {
    const status = parseAgentStatus(await readJsonLimited(request, 16_000).catch(() => null));
    recordAgentStatus(device.deviceId, status);
    if (versionWritten.get(device.deviceId) !== status.version) {
      versionWritten.set(device.deviceId, status.version);
      await setDeviceVersion(device.deviceId, status.version);
    }
    return NextResponse.json({ snapshot: lightingSnapshot(device.userId), configVersion: await lightingConfigVersion(device.userId) });
  } catch (error) {
    console.error('Lighting heartbeat error:', error);
    return lightingError('failed', 500, 'Heartbeat failed');
  }
}
