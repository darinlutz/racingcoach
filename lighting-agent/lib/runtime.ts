import { join } from 'node:path';
import type { LightingEvent } from '../../src/lib/lighting/events.ts';
import type { LightingSnapshot } from '../../src/lib/lighting/hub.ts';
import { defaultConfig, parseLightingConfig, type LightingConfig, type Rgbw, type ZoneLook } from '../../src/lib/lighting/model.ts';
import { homeDir, readJson, writePrivate, type Logger } from './platform.ts';
import type { LightingProvider, SegmentCommand } from './providers.ts';
import type { StreamHeartbeat, SiteStatus } from './site.ts';
import { decide, MODES, sameLook, type ActiveEvent, type Decision, type EventSource, type Mode } from './stateMachine.ts';

// The agent's authoritative lighting state (docs/lighting/README.md, State machine): the inputs the state machine
// reads (mode, scene, manual changes, events in force, the telemetry's freshness), the looks the controllers last
// acknowledged, and the work of turning one into the other. Kept apart:
//   - the baseline (scene and manual changes), saved in state.json, so it survives a restart
//   - the racing events in force (live from the site, test from the Test Lab or the CLI), never saved
//   - each zone's desired look (stateMachine.decide) and its acknowledged look (what the controller confirmed)
// Only zones whose desired look differs from the acknowledged one are sent. Every minute everything is sent again
// (cheap, and puts right a controller that was power cycled), and a controller back from offline gets it at once.

const RECONCILE_EVERY_MS = 60_000;
const TICK_MS = 250;
const DIAGNOSTICS_KEPT = 300;

type SavedState = { mode: Mode; sceneId: string; manual: Record<string, Partial<ZoneLook>>; masterBrightness: number; allOff: boolean };

export type Diagnostic = { at: string; kind: string; detail: Record<string, unknown> };

export class LightingRuntime {
  config: LightingConfig;
  mode: Mode;
  sceneId: string;
  manual: Record<string, Partial<ZoneLook>>;
  allOff: boolean;
  masterBrightness: number;
  readonly providers = new Map<string, LightingProvider>();
  private readonly events = new Map<string, ActiveEvent & { until: number | null }>();
  private readonly acked = new Map<string, ZoneLook>();
  private readonly lastChangeAt = new Map<string, number>();
  private readonly diagnostics: Diagnostic[] = [];
  private readonly log: Logger;
  private readonly save: boolean;
  private stream: { epoch: string; sequence: number } | null = null;
  private lastTelemetryAt: number | null = null;
  // Server time minus this Mac's, from the heartbeats, for latency from the server's timestamps
  private clockOffsetMs: number | null = null;
  siteStatus: SiteStatus = 'connecting';
  lastEvent: { type: string; source: string; at: string; sequence: number } | null = null;
  lastEventLatencyMs: number | null = null;
  lastAgentLatencyMs: number | null = null;
  private applying = false;
  private again = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastFullSend = 0;

  constructor(config: LightingConfig, log: Logger, options: { save?: boolean; state?: Partial<SavedState> } = {}) {
    this.config = config;
    this.log = log;
    this.save = options.save ?? true;
    const saved: Partial<SavedState> = options.state ?? (this.save ? (readJson<SavedState>(join(homeDir(), 'state.json')) ?? {}) : {});
    this.mode = MODES.includes(saved.mode as Mode) ? (saved.mode as Mode) : 'AUTOMATIC';
    this.sceneId = config.scenes.some((s) => s.id === saved.sceneId) ? saved.sceneId! : config.startScene;
    this.manual = saved.manual ?? {};
    this.allOff = saved.allOff === true;
    this.masterBrightness = typeof saved.masterBrightness === 'number' ? Math.min(1, Math.max(0, saved.masterBrightness)) : config.settings.masterBrightness;
  }

  // ---- Inputs ----

  private persist() {
    if (!this.save) return;
    const state: SavedState = { mode: this.mode, sceneId: this.sceneId, manual: this.manual, masterBrightness: this.masterBrightness, allOff: this.allOff };
    writePrivate(join(homeDir(), 'state.json'), JSON.stringify(state, null, 2));
  }

  private note(kind: string, detail: Record<string, unknown>) {
    this.diagnostics.push({ at: new Date().toISOString(), kind, detail });
    if (this.diagnostics.length > DIAGNOSTICS_KEPT) this.diagnostics.splice(0, this.diagnostics.length - DIAGNOSTICS_KEPT);
  }

  liveFresh(now = Date.now()): boolean {
    return this.lastTelemetryAt !== null && now - this.lastTelemetryAt <= this.config.settings.staleTelemetryMs;
  }

  private setEvent(event: ActiveEvent['event'], source: EventSource, active: boolean, now: number) {
    const key = `${source}:${event}`;
    if (active) {
      if (!this.events.has(key)) {
        const until = source === 'live' ? null : now + this.config.settings.testEventMaxMs;
        this.events.set(key, { event, source, since: now, until });
      }
    } else this.events.delete(key);
  }

  private clearEvents(source?: EventSource) {
    for (const [key, e] of this.events) if (!source || e.source === source) this.events.delete(key);
  }

  setMode(mode: Mode) {
    this.mode = mode;
    this.persist();
    this.note('mode', { mode });
    this.changed();
  }

  activateScene(sceneId: string): boolean {
    if (!this.config.scenes.some((s) => s.id === sceneId)) return false;
    this.sceneId = sceneId;
    // Manual changes were on top of the old scene; protected zones keep theirs
    for (const id of Object.keys(this.manual)) if (!this.config.zones.find((z) => z.id === id)?.protected) delete this.manual[id];
    this.allOff = false;
    this.persist();
    this.note('scene', { sceneId });
    this.changed();
    return true;
  }

  // A manual change to one zone: it becomes part of the baseline, under any event's look in force
  changeZone(zoneId: string, change: { toggle?: boolean; on?: boolean; color?: Rgbw; brightness?: number; effect?: number }): boolean {
    const zone = this.config.zones.find((z) => z.id === zoneId);
    if (!zone) return false;
    const current = this.decisions().find((d) => d.zoneId === zoneId)?.look;
    const next: Partial<ZoneLook> = { ...this.manual[zoneId] };
    if (change.toggle) next.on = !(current?.on ?? false);
    if (change.on !== undefined) next.on = change.on;
    if (change.color) {
      next.color = change.color;
      next.on = next.on ?? true;
    }
    if (change.brightness !== undefined) next.brightness = Math.max(0, Math.min(255, Math.round(change.brightness)));
    if (change.effect !== undefined) next.effect = change.effect;
    this.manual[zoneId] = next;
    if (next.on) this.allOff = false;
    this.persist();
    this.note('zone', { zoneId, change });
    this.changed();
    return true;
  }

  setAllOff(off: boolean) {
    this.allOff = off;
    this.persist();
    this.note(off ? 'allOff' : 'allOn', {});
    this.changed();
  }

  setMasterBrightness(value: number) {
    this.masterBrightness = Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
    this.persist();
    this.changed();
  }

  // Every enabled, unprotected zone in one color (a Stream Deck color key): a manual change on top of the scene
  setColor(color: Rgbw) {
    for (const zone of this.config.zones) {
      if (!zone.enabled || zone.protected) continue;
      this.manual[zone.id] = { ...this.manual[zone.id], color, on: true };
    }
    this.allOff = false;
    this.persist();
    this.note('color', { color });
    this.changed();
  }

  // The CLI's and Test Lab's simulated events (the pit limiter, flags): never touch the live state. 'toggle' turns
  // this source's event on when it's off and off when it's on; answers whether it's on now
  testEvent(event: ActiveEvent['event'], active: boolean | 'toggle', source: Exclude<EventSource, 'live'> = 'local'): boolean {
    const on = active === 'toggle' ? !this.events.has(`${source}:${event}`) : active;
    this.setEvent(event, source, on, Date.now());
    this.note('testEvent', { event, active: on, source });
    this.changed();
    return on;
  }

  // Whether any enabled rule follows this event (a test of an event no rule follows changes nothing)
  ruleFollows(event: ActiveEvent['event']): boolean {
    return this.config.rules.some((r) => r.enabled && r.event === event);
  }

  restoreBaseline() {
    this.clearEvents('test');
    this.clearEvents('local');
    this.note('restoreBaseline', {});
    this.changed();
  }

  restoreDefaults() {
    this.clearEvents('test');
    this.clearEvents('local');
    this.mode = 'AUTOMATIC';
    this.sceneId = this.config.startScene;
    this.manual = {};
    this.allOff = false;
    this.masterBrightness = this.config.settings.masterBrightness;
    this.persist();
    this.note('restoreDefaults', {});
    this.changed();
  }

  // A new configuration from the site (agent.ts has already validated, cached it and rebuilt the providers): the mode,
  // scene and manual changes stay where they still fit, and every zone is sent again
  applyConfig(config: LightingConfig) {
    this.config = config;
    if (!config.scenes.some((s) => s.id === this.sceneId)) this.sceneId = config.startScene;
    for (const id of Object.keys(this.manual)) if (!config.zones.some((z) => z.id === id)) delete this.manual[id];
    for (const id of [...this.acked.keys()]) if (!config.zones.some((z) => z.id === id)) this.acked.delete(id);
    this.persist();
    this.note('config', { version: config.version });
    this.log('info', `Configuration version ${config.version} applied`);
    void this.apply(true);
  }

  // ---- From the site ----

  onSiteStatus(status: SiteStatus) {
    this.siteStatus = status;
  }

  onSnapshot(snapshot: LightingSnapshot, now = Date.now()) {
    this.stream = { epoch: snapshot.epoch, sequence: snapshot.sequence };
    this.clearEvents('live');
    this.clearEvents('test');
    if (snapshot.live) {
      this.lastTelemetryAt = now - snapshot.live.telemetryAgeMs;
      if (snapshot.live.pitLimiterActive) this.setEvent('pitLimiter', 'live', true, now);
    } else this.lastTelemetryAt = null;
    if (snapshot.test?.pitLimiterActive) this.setEvent('pitLimiter', 'test', true, now);
    this.note('snapshot', { epoch: snapshot.epoch, sequence: snapshot.sequence, live: snapshot.live, test: snapshot.test });
    this.changed();
  }

  // An event from the stream: duplicates and late arrivals (an older sequence of this epoch) are dropped
  onEvent(event: LightingEvent, now = Date.now()): boolean {
    if (this.stream && event.epoch === this.stream.epoch && event.sequence <= this.stream.sequence) {
      this.note('duplicate', { sequence: event.sequence });
      return false;
    }
    if (this.stream && event.epoch !== this.stream.epoch) {
      // A new server: only a snapshot says where things stand; the stream sends one on reconnecting
      this.note('otherEpoch', { epoch: event.epoch });
      return false;
    }
    this.stream = { epoch: event.epoch, sequence: event.sequence };
    const source: EventSource = event.source === 'test' ? 'test' : 'live';
    if (source === 'live') this.lastTelemetryAt = now;
    if (event.eventType === 'pitLimiter.changed') this.setEvent('pitLimiter', source, event.data.active === true, now);
    else if (event.eventType === 'session.ended') this.clearEvents(source);
    this.lastEvent = { type: event.eventType, source: event.source, at: event.timestampUtc, sequence: event.sequence };
    this.note('event', { eventType: event.eventType, source: event.source, sequence: event.sequence, data: event.data });
    void this.changed().then(() => this.measure(event, now));
    return true;
  }

  onHeartbeat(heartbeat: StreamHeartbeat, receivedAt: number) {
    const offset = Date.parse(heartbeat.serverTimeUtc) - receivedAt;
    if (Number.isFinite(offset)) this.clockOffsetMs = this.clockOffsetMs === null ? offset : Math.round(this.clockOffsetMs * 0.8 + offset * 0.2);
    if (heartbeat.telemetryAgeMs !== null) this.lastTelemetryAt = receivedAt - heartbeat.telemetryAgeMs;
    else if (!heartbeat.fresh) this.lastTelemetryAt = null;
  }

  // From the server receiving the collector's update to the controllers acknowledging, and the agent's own part
  private measure(event: LightingEvent, receivedAt: number) {
    if (event.eventType !== 'pitLimiter.changed') return;
    const ackedAt = Date.now();
    this.lastAgentLatencyMs = ackedAt - receivedAt;
    if (this.clockOffsetMs !== null) this.lastEventLatencyMs = ackedAt + this.clockOffsetMs - Date.parse(event.timestampUtc);
    this.log('info', 'Pit limiter applied', { active: event.data.active, source: event.source, agentMs: this.lastAgentLatencyMs, fromServerMs: this.lastEventLatencyMs });
  }

  // ---- Out to the controllers ----

  decisions(now = Date.now()): Decision[] {
    for (const [key, e] of this.events) if (e.until !== null && now > e.until) this.events.delete(key);
    return decide(
      { ...this.config, settings: { ...this.config.settings, masterBrightness: this.masterBrightness } },
      { mode: this.mode, allOff: this.allOff, sceneId: this.sceneId, manual: this.manual, events: [...this.events.values()], liveFresh: this.liveFresh(now), now }
    );
  }

  private changed(): Promise<void> {
    if (this.applying) {
      this.again = true;
      return Promise.resolve();
    }
    return this.apply();
  }

  // Sends each zone whose desired look isn't what its controller acknowledged; one request per controller
  async apply(force = false): Promise<void> {
    this.applying = true;
    try {
      do {
        this.again = false;
        const now = Date.now();
        const byController = new Map<string, { zoneId: string; command: SegmentCommand }[]>();
        let waiting = false;
        for (const d of this.decisions(now)) {
          if (!d.look) continue;
          if (!force && sameLook(d.look, this.acked.get(d.zoneId))) continue;
          if (!force && now - (this.lastChangeAt.get(d.zoneId) ?? 0) < this.config.settings.minChangeIntervalMs) {
            waiting = true;
            continue;
          }
          const zone = this.config.zones.find((z) => z.id === d.zoneId)!;
          const look = { ...d.look, transitionMs: d.look.transitionMs ?? this.config.settings.defaultTransitionMs };
          const list = byController.get(zone.controllerId) ?? [];
          list.push({ zoneId: zone.id, command: { segmentId: zone.segmentId, look } });
          byController.set(zone.controllerId, list);
        }
        await Promise.all(
          [...byController].map(async ([controllerId, items]) => {
            const provider = this.providers.get(controllerId);
            if (!provider) return;
            const result = await provider.apply(items.map((i) => i.command));
            this.note('controller', { controllerId, zones: items.map((i) => i.zoneId), ok: result.ok, latencyMs: result.latencyMs, attempts: result.attempts, error: result.error });
            for (const item of items) {
              if (result.ok) {
                this.acked.set(item.zoneId, item.command.look);
                this.lastChangeAt.set(item.zoneId, Date.now());
              } else this.acked.delete(item.zoneId);
            }
          })
        );
        // A change that arrived while sending goes at once; one held by minChangeIntervalMs waits a tick
        if (waiting && !this.again) {
          await new Promise((resolve) => setTimeout(resolve, TICK_MS));
          this.again = true;
        }
      } while (this.again);
    } finally {
      this.applying = false;
    }
  }

  // The runtime's clock: stale telemetry, test events running out, the minute's full send, controllers coming back
  start() {
    let wasFresh = this.liveFresh();
    const wasOnline = new Map<string, boolean>();
    this.timer = setInterval(() => {
      const now = Date.now();
      const fresh = this.liveFresh(now);
      if (wasFresh && !fresh) {
        this.log('warn', 'Telemetry stale: racing overrides end, the baseline comes back');
        this.note('stale', {});
      }
      wasFresh = fresh;
      let force = now - this.lastFullSend > RECONCILE_EVERY_MS;
      for (const [id, provider] of this.providers) {
        if (provider.online && wasOnline.get(id) === false) {
          this.log('info', `Controller ${id} is back: sending every zone`);
          force = true;
        }
        wasOnline.set(id, provider.online);
      }
      if (force) this.lastFullSend = now;
      if (!this.applying) void this.apply(force);
    }, 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---- Reports ----

  status() {
    const decisions = this.decisions();
    return {
      mode: this.mode,
      scene: this.sceneId,
      allOff: this.allOff,
      masterBrightness: this.masterBrightness,
      site: this.siteStatus,
      telemetryFresh: this.liveFresh(),
      eventsInForce: [...this.events.values()].map((e) => ({ event: e.event, source: e.source, since: new Date(e.since).toISOString() })),
      activeOverride: decisions.find((d) => d.reason.startsWith('rule:'))?.reason.slice(5) ?? null,
      lastEvent: this.lastEvent,
      lastEventLatencyMs: this.lastEventLatencyMs,
      lastAgentLatencyMs: this.lastAgentLatencyMs,
      zones: this.config.zones.map((z) => {
        const d = decisions.find((x) => x.zoneId === z.id);
        return { id: z.id, name: z.name, enabled: z.enabled, protected: z.protected, reason: d?.reason, desired: d?.look ?? null, acknowledged: this.acked.get(z.id) ?? null };
      }),
      controllers: [...this.providers.values()].map((p) => ({
        id: p.controller.id,
        name: p.controller.name,
        online: p.online,
        firmware: p.firmware,
        lastAckMs: p.lastAckAt === null ? null : Date.now() - p.lastAckAt,
        latencyMs: p.lastLatencyMs,
      })),
    };
  }

  // What the site's Admin page sees: no addresses, no zone details beyond names
  siteReport(version: string): Record<string, unknown> {
    const s = this.status();
    return {
      version,
      mode: s.mode,
      scene: s.scene,
      activeOverride: s.activeOverride,
      lastEventSequence: this.lastEvent?.sequence ?? null,
      lastEventLatencyMs: s.lastEventLatencyMs,
      controllers: s.controllers,
    };
  }

  recentDiagnostics(): Diagnostic[] {
    return [...this.diagnostics];
  }
}

// The installation's configuration from config.json: the cache of the site's (version above 0), or, before the
// site has one, this Mac's own, written with the defaults the first time. A config with problems isn't used (the
// agent says why and keeps the defaults until the site's arrives)
export function loadConfig(log: Logger): LightingConfig {
  const path = join(homeDir(), 'config.json');
  const saved = readJson<unknown>(path);
  if (!saved) {
    const config = defaultConfig();
    writePrivate(path, JSON.stringify(config, null, 2));
    log('info', `Wrote the default configuration to ${path}`);
    return config;
  }
  const parsed = parseLightingConfig(saved);
  if (!parsed.ok) {
    log('error', `config.json has problems, so the defaults are used until it's fixed`, { problems: parsed.problems });
    return defaultConfig();
  }
  return parsed.config;
}

// Keeps the site's configuration as the local cache, so the lights work with the site out of reach
export function cacheConfig(config: LightingConfig): void {
  writePrivate(join(homeDir(), 'config.json'), JSON.stringify(config, null, 2));
}
