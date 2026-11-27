import { DEFAULT_LOOK, type LightingConfig, type Rule, type RuleEvent, type Zone, type ZoneLook } from './model.ts';

// The lighting state machine (docs/lighting/README.md, State machine): from the mode, the baseline scene, the manual
// changes made on top of it and the racing events in force, what each zone should show. Pure: the agent's runtime
// (runtime.ts) owns the inputs, the controllers' acknowledged state and the timers, and sends only differences.
//
// Precedence, highest first (rules' order among themselves is their configurable priority):
//   1. DISABLED mode: the agent leaves every zone as it is; All Off: unprotected zones off
//   2. MANUAL mode: the baseline only, events ignored
//   3. event rules in force (red flag 30, yellow flag 20, pit limiter 10 by default): AUTOMATIC mode follows live
//      events while the telemetry is fresh, and test events; TEST mode follows test events only
//   4. the baseline: the scene, with the manual changes made since it was picked
// Protected zones (pedals, the engineer's light) are changed only by what names them: a scene or rule listing them,
// or a command to that zone. A disabled zone is never sent anything. Every look is capped by the zone's
// maxBrightness and scaled by the master brightness.

export type Mode = 'AUTOMATIC' | 'MANUAL' | 'DISABLED' | 'TEST';
export const MODES: readonly Mode[] = ['AUTOMATIC', 'MANUAL', 'DISABLED', 'TEST'];

// live: the website's event stream; test: the Admin page's Test Lab; local: the agent's own test command
export type EventSource = 'live' | 'test' | 'local';

export type ActiveEvent = { event: RuleEvent; source: EventSource; since: number };

export type Inputs = {
  mode: Mode;
  allOff: boolean;
  sceneId: string;
  // Manual changes on top of the scene, by zone: they stay when an event's look ends
  manual: Record<string, Partial<ZoneLook>>;
  events: ActiveEvent[];
  // The live telemetry is fresh (runtime.ts: the stream is up and the collector's last update is recent)
  liveFresh: boolean;
  now: number;
};

export type Decision = {
  zoneId: string;
  // null: leave the zone as it is
  look: ZoneLook | null;
  reason: 'zoneDisabled' | 'modeDisabled' | 'allOff' | 'protected' | 'baseline' | `rule:${string}`;
};

const merge = (...looks: (Partial<ZoneLook> | undefined)[]): ZoneLook => Object.assign({}, DEFAULT_LOOK, ...looks.filter(Boolean));

function finish(look: ZoneLook, zone: Zone, config: LightingConfig): ZoneLook {
  const brightness = Math.round(Math.min(look.brightness, zone.maxBrightness) * config.settings.masterBrightness);
  return { ...look, brightness: Math.max(0, Math.min(255, brightness)) };
}

// The baseline look of a zone, or null for a protected zone nothing has named
export function baselineLook(zone: Zone, config: LightingConfig, inputs: Pick<Inputs, 'sceneId' | 'manual'>): ZoneLook | null {
  const scene = config.scenes.find((s) => s.id === inputs.sceneId);
  const own = scene?.zones[zone.id];
  const manual = inputs.manual[zone.id];
  if (zone.protected) return own || manual ? merge(own, manual) : null;
  return merge(scene?.all, own, manual);
}

function ruleTargets(rule: Rule, zone: Zone): boolean {
  return rule.zones === 'automatic' ? zone.automatic && !zone.protected : rule.zones.includes(zone.id);
}

// The events the mode lets in: live ones only while fresh
export function eventsInForce(inputs: Inputs): ActiveEvent[] {
  if (inputs.mode === 'AUTOMATIC') return inputs.events.filter((e) => e.source !== 'live' || inputs.liveFresh);
  if (inputs.mode === 'TEST') return inputs.events.filter((e) => e.source !== 'live');
  return [];
}

// The rule in force for a zone, the highest priority one (the earlier in the list on a tie)
export function winningRule(zone: Zone, config: LightingConfig, events: ActiveEvent[], now: number): Rule | null {
  let best: Rule | null = null;
  for (const rule of config.rules) {
    if (!rule.enabled || !ruleTargets(rule, zone)) continue;
    const event = events.find((e) => e.event === rule.event);
    if (!event) continue;
    if (rule.durationSeconds > 0 && now - event.since > rule.durationSeconds * 1000) continue;
    if (!best || rule.priority > best.priority) best = rule;
  }
  return best;
}

export function decide(config: LightingConfig, inputs: Inputs): Decision[] {
  const events = eventsInForce(inputs);
  return config.zones.map((zone): Decision => {
    if (!zone.enabled) return { zoneId: zone.id, look: null, reason: 'zoneDisabled' };
    if (inputs.mode === 'DISABLED') return { zoneId: zone.id, look: null, reason: 'modeDisabled' };
    const base = baselineLook(zone, config, inputs);
    if (inputs.allOff && !zone.protected) return { zoneId: zone.id, look: finish({ ...(base ?? DEFAULT_LOOK), on: false }, zone, config), reason: 'allOff' };
    const rule = inputs.allOff ? null : winningRule(zone, config, events, inputs.now);
    if (rule) return { zoneId: zone.id, look: finish(merge(base ?? undefined, rule.look), zone, config), reason: `rule:${rule.id}` };
    if (!base) return { zoneId: zone.id, look: null, reason: 'protected' };
    return { zoneId: zone.id, look: finish(base, zone, config), reason: 'baseline' };
  });
}

export const sameLook = (a: ZoneLook | null | undefined, b: ZoneLook | null | undefined) =>
  !!a && !!b && a.on === b.on && a.brightness === b.brightness && a.effect === b.effect && a.color.every((c, i) => c === b.color[i]);
