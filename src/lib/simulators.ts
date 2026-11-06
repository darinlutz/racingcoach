import capabilities from '../../simulators/capabilities.json' with { type: 'json' };

// The simulator capability matrix (simulators/capabilities.json), the same file the collector builds in
// (SimulatorCatalog.cs). See docs/multi-simulator.md.

// Laps from before there were other simulators, and collectors that don't say, are iRacing's: that's the only
// simulator those collectors can read
export const DEFAULT_SIMULATOR = 'iracing';

// The newest format of a lap's details (collectorLapSchema) this site reads. A collector sends the format it wrote;
// one without a payloadVersion wrote format 1. When a format changes meaning, read the older ones here rather than
// refusing them: collectors already installed keep sending them until they update themselves.
export const LATEST_LAP_PAYLOAD_VERSION = 1;

export type SimulatorStatus = 'supported' | 'documented' | 'interfaceIdentified';
export type ChannelSupport = 'collected' | 'collectedAfterStint' | 'documented' | 'unavailable' | 'unknown';

export type SimulatorDescription = {
  id: string;
  displayName: string;
  priority: string;
  status: SimulatorStatus;
  // Laps from an older adapter than this are refused (lapRefusal): their files aren't in iRacing's form
  minAdapterVersion?: number;
  channels: Record<string, { support: ChannelSupport; note?: string }>;
};

export const SIMULATORS = capabilities.simulators as unknown as SimulatorDescription[];
export const CHANNELS: string[] = capabilities.channels.map((channel) => channel.id);

export function findSimulator(id: string): SimulatorDescription | undefined {
  return SIMULATORS.find((simulator) => simulator.id === id);
}

// Laps are only accepted from a simulator whose adapter has been tested: until then a lap from it could be shown as
// if every chart meant what it does for iRacing
export function acceptsLapsFrom(id: string): boolean {
  return findSimulator(id)?.status === 'supported';
}

// Why a lap's details can't be taken, or null when they can. Details without a simulator or version are an older
// iRacing collector's, which always can be. A simulator with a minAdapterVersion refuses laps from an older (or
// unnamed) adapter of it as adapterVersionNotSupported, which the collector keeps locally and doesn't retry.
export function lapRefusal(
  simulator: string | null | undefined,
  payloadVersion: number | null | undefined,
  adapterVersion?: string | null
) {
  const id = simulator ?? DEFAULT_SIMULATOR;
  if (!acceptsLapsFrom(id)) return 'simulatorNotSupported';
  if ((payloadVersion ?? 1) > LATEST_LAP_PAYLOAD_VERSION) return 'payloadVersionNotSupported';
  const minimum = findSimulator(id)?.minAdapterVersion;
  if (minimum !== undefined && !(Number(adapterVersion) >= minimum)) return 'adapterVersionNotSupported';
  return null;
}

// Whether a page may show this channel for this simulator. A channel that's unavailable, unknown or only documented
// shows as Not Available rather than as a 0 or an unverified number.
export function channelAvailable(simulatorId: string, channel: string): boolean {
  const support = findSimulator(simulatorId)?.channels[channel]?.support;
  return support === 'collected' || support === 'collectedAfterStint';
}
