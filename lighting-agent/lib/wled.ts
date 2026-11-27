import type { Controller, ZoneLook } from './model.ts';
import type { ApplyResult, ControllerInfo, LightingProvider, ProviderLog, SegmentCommand } from './providers.ts';

// The WLED provider (https://kno.wled.ge/interfaces/json-api/): GET /json/info and POST /json/state on a controller
// on the home network. Only this agent talks to it; nothing on the internet does.
//
// A command touches only the segments it names: each segment's on, bri, col and fx. The controller's own brightness
// is never changed; its power is turned on (never off) when a segment is lit, since WLED shows nothing while it's
// off. Colors go as [r, g, b, w] for the RGBW strip. Transitions are WLED's tenths of a second.
//
// Requests to one controller go one at a time; commands that arrive meanwhile are merged, the newest look per segment
// winning, and sent next. Each request times out after TIMEOUT_MS and is tried MAX_ATTEMPTS times; the controller is
// offline after a failed command until one succeeds.

const TIMEOUT_MS = 1500;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [150, 450];

export type WledSegmentState = { id: number; on?: boolean; bri?: number; col?: number[][]; fx?: number; transition?: number };

// The /json/state body for these commands
export function wledStateBody(commands: SegmentCommand[]): Record<string, unknown> {
  const anyOn = commands.some((c) => c.look.on);
  const transition = Math.round(Math.max(0, ...commands.map((c) => c.look.transitionMs)) / 100);
  return {
    ...(anyOn ? { on: true } : {}),
    transition,
    seg: commands.map((c) => ({
      id: c.segmentId,
      on: c.look.on,
      bri: c.look.brightness,
      col: [c.look.color.slice(0, 4)],
      fx: c.look.effect,
    })),
  };
}

export function parseWledInfo(info: unknown, state?: unknown): ControllerInfo {
  const i = (info && typeof info === 'object' ? info : {}) as Record<string, unknown>;
  const leds = (i.leds && typeof i.leds === 'object' ? i.leds : {}) as Record<string, unknown>;
  const s = (state && typeof state === 'object' ? state : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const segs = Array.isArray(s.seg) ? s.seg : [];
  return {
    name: typeof i.name === 'string' ? i.name : null,
    firmware: typeof i.ver === 'string' ? i.ver : null,
    pixelCount: num(leds.count),
    // Newer WLED gives the white channel per bus in lc/seglc (bit 1 is white); older ones a rgbw flag
    rgbw: typeof leds.rgbw === 'boolean' ? leds.rgbw : typeof leds.lc === 'number' ? (leds.lc & 2) !== 0 : null,
    outputs: Array.isArray(leds.seglc) ? leds.seglc.length : null,
    maxSegments: num(leds.maxseg),
    segments: segs
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x) => ({ id: num(x.id) ?? 0, start: num(x.start) ?? 0, stop: num(x.stop) ?? 0, on: x.on === true })),
  };
}

type Pending = { commands: Map<number, ZoneLook>; waiters: ((result: ApplyResult) => void)[] };

export class WledProvider implements LightingProvider {
  readonly controller: Controller;
  online = false;
  lastAckAt: number | null = null;
  lastLatencyMs: number | null = null;
  firmware: string | null = null;
  private readonly log: ProviderLog;
  private readonly fetchImpl: typeof fetch;
  private busy = false;
  private pending: Pending | null = null;

  constructor(controller: Controller, log: ProviderLog, fetchImpl: typeof fetch = fetch) {
    this.controller = controller;
    this.log = log;
    this.fetchImpl = fetchImpl;
  }

  private url(path: string): string {
    return `http://${this.controller.host}:${this.controller.port}${path}`;
  }

  private async request(path: string, body?: unknown): Promise<unknown> {
    const response = await this.fetchImpl(this.url(path), {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async info(): Promise<ControllerInfo> {
    if (!this.controller.host) throw new Error('No address set for this controller');
    const [info, state] = await Promise.all([this.request('/json/info'), this.request('/json/state')]);
    const parsed = parseWledInfo(info, state);
    this.firmware = parsed.firmware;
    this.online = true;
    return parsed;
  }

  // The segments' looks, merged with any not sent yet; resolves when the controller acknowledged them, or gave up
  apply(commands: SegmentCommand[]): Promise<ApplyResult> {
    return new Promise((resolve) => {
      this.pending ??= { commands: new Map(), waiters: [] };
      for (const c of commands) this.pending.commands.set(c.segmentId, c.look);
      this.pending.waiters.push(resolve);
      if (!this.busy) void this.drain();
    });
  }

  private async drain(): Promise<void> {
    this.busy = true;
    while (this.pending) {
      const batch = this.pending;
      this.pending = null;
      const commands = [...batch.commands].map(([segmentId, look]) => ({ segmentId, look }));
      const result = await this.send(commands);
      for (const resolve of batch.waiters) resolve(result);
    }
    this.busy = false;
  }

  private async send(commands: SegmentCommand[]): Promise<ApplyResult> {
    const started = Date.now();
    if (!this.controller.host) return { ok: false, latencyMs: 0, attempts: 0, error: 'No address set for this controller' };
    const body = wledStateBody(commands);
    let error = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      this.log({ controllerId: this.controller.id, kind: 'request', detail: { attempt, segments: commands.map((c) => c.segmentId), body } });
      try {
        const answer = (await this.request('/json/state', body)) as { success?: boolean } | null;
        if (answer && answer.success === false) throw new Error('WLED refused the state');
        const latencyMs = Date.now() - started;
        this.online = true;
        this.lastAckAt = Date.now();
        this.lastLatencyMs = latencyMs;
        this.log({ controllerId: this.controller.id, kind: 'response', detail: { attempt, latencyMs } });
        return { ok: true, latencyMs, attempts: attempt };
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        this.log({ controllerId: this.controller.id, kind: 'error', detail: { attempt, error } });
        if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1] ?? 500));
      }
    }
    this.online = false;
    return { ok: false, latencyMs: Date.now() - started, attempts: MAX_ATTEMPTS, error };
  }
}
