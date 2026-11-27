// The lighting installation's configuration: controllers, zones, scenes and event rules (docs/lighting/README.md).
// Pure types, defaults and validation; no I/O. Shared by the website (lightingConfig.ts keeps it in Postgres, the
// authoritative copy) and the Mac agent (lighting-agent/, which caches it), so both accept exactly the same configs.

export type Rgbw = [number, number, number, number];

// What a zone shows. brightness 0-255 (WLED's segment bri); effect is WLED's effect id (0 is solid); transitionMs is
// the fade into it
export type ZoneLook = {
  on: boolean;
  color: Rgbw;
  brightness: number;
  effect: number;
  transitionMs: number;
};

export type Controller = {
  id: string;
  name: string;
  // A private address on the home network (a DHCP reservation), only ever used by this agent
  host: string;
  port: number;
};

export type Zone = {
  id: string;
  name: string;
  controllerId: string;
  // The WLED segment this zone is
  segmentId: number;
  enabled: boolean;
  // A ceiling on this zone's brightness, 0-255, whatever a scene, rule or command asks for
  maxBrightness: number;
  // Takes part in racing events (rules whose zones are 'automatic')
  automatic: boolean;
  // Never changed by scenes, rules or all off unless they name it (pedal illumination, the engineer's task light)
  protected: boolean;
};

export type Scene = {
  id: string;
  name: string;
  // Each zone's look in this scene; zones not listed keep their look, protected zones are skipped unless listed
  zones: Record<string, Partial<ZoneLook>>;
  // The look of every other unprotected zone, when given
  all?: Partial<ZoneLook>;
};

// The racing events rules answer. Only the pit limiter has a verified source; the others are ready for when one is
// (docs/lighting/README.md, Event rules)
export const RULE_EVENTS = ['pitLimiter', 'greenFlag', 'yellowFlag', 'redFlag', 'checkeredFlag', 'lowFuel', 'personalBest', 'positionChange'] as const;
export type RuleEvent = (typeof RULE_EVENTS)[number];
export const SUPPORTED_RULE_EVENTS: readonly RuleEvent[] = ['pitLimiter'];

export type Rule = {
  id: string;
  name: string;
  event: RuleEvent;
  enabled: boolean;
  // Higher wins when several apply to a zone
  priority: number;
  // 'automatic' is every enabled zone that takes part in racing events
  zones: 'automatic' | string[];
  look: Partial<ZoneLook>;
  // Seconds an event's look lasts at most (0: while the event lasts)
  durationSeconds: number;
};

export type Settings = {
  // Telemetry older than this ends racing overrides and the baseline comes back
  staleTelemetryMs: number;
  // A test event's look ends after this, in case its off never comes
  testEventMaxMs: number;
  // The master brightness, 0-1, applied on top of every look
  masterBrightness: number;
  // Shortest time between changes of one zone, so an event flapping on and off doesn't flash the room
  minChangeIntervalMs: number;
  // The fade between looks when one doesn't say
  defaultTransitionMs: number;
};

export type LightingConfig = {
  // The site's version of it (lightingConfig.ts), or 0 for one that isn't the site's (the Mac's own, before its first
  // sync)
  version: number;
  controllers: Controller[];
  zones: Zone[];
  scenes: Scene[];
  rules: Rule[];
  settings: Settings;
  // The baseline scene the agent starts in
  startScene: string;
};

export const OFF: Rgbw = [0, 0, 0, 0];
export const WHITE: Rgbw = [0, 0, 0, 255];
export const BLUE: Rgbw = [0, 0, 255, 0];
export const RED: Rgbw = [255, 0, 0, 0];

export const DEFAULT_LOOK: ZoneLook = { on: true, color: WHITE, brightness: 128, effect: 0, transitionMs: 300 };

const zone = (id: string, name: string, segmentId: number, extra: Partial<Zone> = {}): Zone => ({
  id,
  name,
  controllerId: 'main',
  segmentId,
  enabled: false,
  maxBrightness: 200,
  automatic: true,
  protected: false,
  ...extra,
});

export function defaultConfig(): LightingConfig {
  return {
    // 0: not from the site; the site's saves count from 1
    version: 0,
    controllers: [{ id: 'main', name: 'Dig-Quad', host: '', port: 80 }],
    zones: [
      zone('cockpit', 'Cockpit underglow', 0, { enabled: true }),
      zone('monitor', 'Monitor backlighting', 1),
      zone('perimeter', 'Room perimeter', 2),
      zone('engineer', 'Race engineer station', 3, { protected: true, automatic: false }),
      zone('pedals', 'Pedal illumination', 4, { protected: true, automatic: false, maxBrightness: 120 }),
      zone('wall', 'Display wall', 5),
    ],
    scenes: [
      { id: 'race', name: 'Race Mode', zones: {}, all: { on: true, color: WHITE, brightness: 90, effect: 0 } },
      { id: 'garage', name: 'F1 Garage Mode', zones: {}, all: { on: true, color: WHITE, brightness: 220, effect: 0 } },
      { id: 'broadcast', name: 'Broadcast Mode', zones: {}, all: { on: true, color: [0, 40, 255, 60], brightness: 140, effect: 0 } },
      { id: 'night', name: 'Night Mode', zones: {}, all: { on: true, color: [255, 60, 0, 0], brightness: 25, effect: 0 } },
      { id: 'white', name: 'All White', zones: {}, all: { on: true, color: WHITE, brightness: 160, effect: 0 } },
      { id: 'blue', name: 'All Blue', zones: {}, all: { on: true, color: BLUE, brightness: 160, effect: 0 } },
      { id: 'red', name: 'All Red', zones: {}, all: { on: true, color: RED, brightness: 160, effect: 0 } },
      { id: 'off', name: 'All Off', zones: {}, all: { on: false } },
    ],
    rules: [
      {
        id: 'pit-limiter',
        name: 'Pit limiter',
        event: 'pitLimiter',
        enabled: true,
        priority: 10,
        zones: 'automatic',
        look: { on: true, color: BLUE, brightness: 128, effect: 0, transitionMs: 150 },
        durationSeconds: 0,
      },
      // Ready for when the collector sends flags; their source isn't verified yet, so they're off
      { id: 'yellow-flag', name: 'Yellow flag', event: 'yellowFlag', enabled: false, priority: 20, zones: 'automatic', look: { on: true, color: [255, 180, 0, 0], brightness: 140, effect: 0 }, durationSeconds: 0 },
      { id: 'red-flag', name: 'Red flag', event: 'redFlag', enabled: false, priority: 30, zones: 'automatic', look: { on: true, color: RED, brightness: 160, effect: 0 }, durationSeconds: 0 },
    ],
    settings: { staleTelemetryMs: 5000, testEventMaxMs: 5 * 60_000, masterBrightness: 1, minChangeIntervalMs: 250, defaultTransitionMs: 300 },
    startScene: 'race',
  };
}

// ---- Validation: a config from a file or the website is checked before it's used; a bad one is refused whole ----

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const byte = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255;
export const isRgbw = (v: unknown): v is Rgbw => Array.isArray(v) && v.length === 4 && v.every(byte);

// A private (home network) IPv4 address or a .local name: never a public address, so a config can't make the agent
// send requests to the internet
export function isLocalHost(host: string): boolean {
  if (/^[a-z0-9-]{1,63}\.local$/i.test(host)) return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function lookProblems(look: unknown, where: string): string[] {
  if (!look || typeof look !== 'object') return [`${where}: not an object`];
  const l = look as Record<string, unknown>;
  const problems: string[] = [];
  if ('on' in l && typeof l.on !== 'boolean') problems.push(`${where}.on`);
  if ('color' in l && !isRgbw(l.color)) problems.push(`${where}.color must be [r,g,b,w] 0-255`);
  if ('brightness' in l && !byte(l.brightness)) problems.push(`${where}.brightness must be 0-255`);
  if ('effect' in l && !(typeof l.effect === 'number' && Number.isInteger(l.effect) && l.effect >= 0 && l.effect <= 255)) problems.push(`${where}.effect`);
  if ('transitionMs' in l && !(typeof l.transitionMs === 'number' && l.transitionMs >= 0 && l.transitionMs <= 60_000)) problems.push(`${where}.transitionMs`);
  return problems;
}

export function configProblems(config: LightingConfig): string[] {
  const problems: string[] = [];
  const ids = (list: { id: string }[], kind: string) => {
    const seen = new Set<string>();
    for (const item of list) {
      if (!ID.test(item.id)) problems.push(`${kind} id "${item.id}"`);
      if (seen.has(item.id)) problems.push(`${kind} "${item.id}" twice`);
      seen.add(item.id);
    }
    return seen;
  };
  const controllers = ids(config.controllers, 'controller');
  const zones = ids(config.zones, 'zone');
  const scenes = ids(config.scenes, 'scene');
  ids(config.rules, 'rule');
  for (const c of config.controllers) {
    if (c.host && !isLocalHost(c.host)) problems.push(`controller ${c.id}: host must be a home network address or .local name`);
    if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) problems.push(`controller ${c.id}: port`);
  }
  const segments = new Set<string>();
  for (const z of config.zones) {
    if (!controllers.has(z.controllerId)) problems.push(`zone ${z.id}: unknown controller ${z.controllerId}`);
    if (!Number.isInteger(z.segmentId) || z.segmentId < 0 || z.segmentId > 31) problems.push(`zone ${z.id}: segment 0-31`);
    if (!byte(z.maxBrightness)) problems.push(`zone ${z.id}: maxBrightness 0-255`);
    const key = `${z.controllerId}/${z.segmentId}`;
    if (z.enabled && segments.has(key)) problems.push(`zone ${z.id}: segment ${key} used by another enabled zone`);
    if (z.enabled) segments.add(key);
  }
  for (const s of config.scenes) {
    for (const [zoneId, look] of Object.entries(s.zones)) {
      if (!zones.has(zoneId)) problems.push(`scene ${s.id}: unknown zone ${zoneId}`);
      problems.push(...lookProblems(look, `scene ${s.id}.${zoneId}`));
    }
    if (s.all) problems.push(...lookProblems(s.all, `scene ${s.id}.all`));
  }
  for (const r of config.rules) {
    if (!(RULE_EVENTS as readonly string[]).includes(r.event)) problems.push(`rule ${r.id}: unknown event ${r.event}`);
    if (r.zones !== 'automatic') for (const z of r.zones) if (!zones.has(z)) problems.push(`rule ${r.id}: unknown zone ${z}`);
    if (!Number.isInteger(r.priority) || r.priority < 1 || r.priority > 1000) problems.push(`rule ${r.id}: priority 1-1000`);
    problems.push(...lookProblems(r.look, `rule ${r.id}.look`));
  }
  if (!scenes.has(config.startScene)) problems.push(`startScene ${config.startScene} isn't a scene`);
  const s = config.settings;
  if (!(s.staleTelemetryMs >= 1000 && s.staleTelemetryMs <= 60_000)) problems.push('settings.staleTelemetryMs 1000-60000');
  if (!(s.masterBrightness >= 0 && s.masterBrightness <= 1)) problems.push('settings.masterBrightness 0-1');
  if (!(s.minChangeIntervalMs >= 0 && s.minChangeIntervalMs <= 5000)) problems.push('settings.minChangeIntervalMs 0-5000');
  return problems;
}

// ---- Parsing: a config from JSON (the Admin page, the agent's first upload, a cached file) rebuilt from known fields
// only, with sizes capped, then checked by configProblems ----

export const CONFIG_LIMITS = { controllers: 16, zones: 64, scenes: 64, rules: 64, name: 80 } as const;

type Parsed = { ok: true; config: LightingConfig } | { ok: false; problems: string[] };

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isInteger(v) ? v : fallback);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown) => v === true;

function parseLook(v: unknown): Partial<ZoneLook> {
  const l = obj(v);
  if (!l) return {};
  const look: Partial<ZoneLook> = {};
  if (typeof l.on === 'boolean') look.on = l.on;
  if (l.color !== undefined) look.color = l.color as Rgbw;
  if (l.brightness !== undefined) look.brightness = l.brightness as number;
  if (l.effect !== undefined) look.effect = l.effect as number;
  if (l.transitionMs !== undefined) look.transitionMs = l.transitionMs as number;
  return look;
}

export function parseLightingConfig(value: unknown): Parsed {
  const c = obj(value);
  if (!c) return { ok: false, problems: ['not a configuration'] };
  const list = (v: unknown, max: number, kind: string, problems: string[]) => {
    if (!Array.isArray(v)) {
      problems.push(`${kind} must be a list`);
      return [];
    }
    if (v.length > max) problems.push(`at most ${max} ${kind}`);
    return v.slice(0, max).map(obj).filter((x): x is Record<string, unknown> => !!x);
  };
  const problems: string[] = [];
  const s = obj(c.settings) ?? {};
  const defaults = defaultConfig().settings;
  const config: LightingConfig = {
    version: Math.max(0, int(c.version, 0)),
    controllers: list(c.controllers, CONFIG_LIMITS.controllers, 'controllers', problems).map((x) => ({
      id: str(x.id, 40),
      name: str(x.name, CONFIG_LIMITS.name) || str(x.id, 40),
      host: str(x.host, 253),
      port: int(x.port, 80),
    })),
    zones: list(c.zones, CONFIG_LIMITS.zones, 'zones', problems).map((x) => ({
      id: str(x.id, 40),
      name: str(x.name, CONFIG_LIMITS.name) || str(x.id, 40),
      controllerId: str(x.controllerId, 40),
      segmentId: int(x.segmentId, -1),
      enabled: bool(x.enabled),
      maxBrightness: int(x.maxBrightness, -1),
      automatic: bool(x.automatic),
      protected: bool(x.protected),
    })),
    scenes: list(c.scenes, CONFIG_LIMITS.scenes, 'scenes', problems).map((x) => {
      const zones = obj(x.zones) ?? {};
      const all = obj(x.all);
      return {
        id: str(x.id, 40),
        name: str(x.name, CONFIG_LIMITS.name) || str(x.id, 40),
        zones: Object.fromEntries(Object.entries(zones).slice(0, CONFIG_LIMITS.zones).map(([k, v]) => [k, parseLook(v)])),
        ...(all ? { all: parseLook(all) } : {}),
      };
    }),
    rules: list(c.rules, CONFIG_LIMITS.rules, 'rules', problems).map((x) => ({
      id: str(x.id, 40),
      name: str(x.name, CONFIG_LIMITS.name) || str(x.id, 40),
      event: str(x.event, 40) as RuleEvent,
      enabled: bool(x.enabled),
      priority: int(x.priority, 0),
      zones: x.zones === 'automatic' ? 'automatic' : Array.isArray(x.zones) ? x.zones.slice(0, CONFIG_LIMITS.zones).map((z) => str(z, 40)) : 'automatic',
      look: parseLook(x.look),
      durationSeconds: Math.max(0, Math.min(3600, int(x.durationSeconds, 0))),
    })),
    settings: {
      staleTelemetryMs: num(s.staleTelemetryMs, defaults.staleTelemetryMs),
      testEventMaxMs: Math.max(10_000, Math.min(3_600_000, num(s.testEventMaxMs, defaults.testEventMaxMs))),
      masterBrightness: num(s.masterBrightness, defaults.masterBrightness),
      minChangeIntervalMs: num(s.minChangeIntervalMs, defaults.minChangeIntervalMs),
      defaultTransitionMs: Math.max(0, Math.min(60_000, num(s.defaultTransitionMs, defaults.defaultTransitionMs))),
    },
    startScene: str(c.startScene, 40),
  };
  problems.push(...configProblems(config));
  return problems.length ? { ok: false, problems } : { ok: true, config };
}
