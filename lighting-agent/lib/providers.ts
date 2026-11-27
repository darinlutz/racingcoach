import type { Controller, ZoneLook } from '../../src/lib/lighting/model.ts';

// Lighting providers (docs/lighting/README.md, WLED): one per controller, behind one interface, so another kind of
// controller can be added beside WLED. Each serializes its own commands (one request at a time, later commands for
// the same segment replacing ones not yet sent), retries a bounded number of times, and says when it's offline.

export type SegmentCommand = { segmentId: number; look: ZoneLook };

export type ControllerInfo = {
  name: string | null;
  firmware: string | null;
  // The addressable pixels the controller is configured for: a WS2814 COB strip's IC groups (14 a meter), never the
  // LED count printed on the reel
  pixelCount: number | null;
  rgbw: boolean | null;
  outputs: number | null;
  maxSegments: number | null;
  segments: { id: number; start: number; stop: number; on: boolean }[];
};

export type ApplyResult = { ok: boolean; latencyMs: number; attempts: number; error?: string };

export interface LightingProvider {
  readonly controller: Controller;
  readonly online: boolean;
  readonly lastAckAt: number | null;
  readonly lastLatencyMs: number | null;
  readonly firmware: string | null;
  info(): Promise<ControllerInfo>;
  apply(commands: SegmentCommand[]): Promise<ApplyResult>;
}

// What happened at the controllers, for the diagnostics log
export type ProviderLog = (entry: { controllerId: string; kind: 'request' | 'response' | 'error'; detail: Record<string, unknown> }) => void;

// For development and tests before the hardware arrives: remembers every segment's look and answers like a controller
export class MockProvider implements LightingProvider {
  readonly controller: Controller;
  online = true;
  lastAckAt: number | null = null;
  lastLatencyMs: number | null = null;
  firmware = 'mock';
  readonly segments = new Map<number, ZoneLook>();
  readonly applied: SegmentCommand[][] = [];
  failNext = 0;
  private readonly delayMs: number;

  constructor(controller: Controller, delayMs = 0) {
    this.controller = controller;
    this.delayMs = delayMs;
  }

  async info(): Promise<ControllerInfo> {
    return { name: this.controller.name, firmware: 'mock', pixelCount: 42, rgbw: true, outputs: 4, maxSegments: 32, segments: [] };
  }

  async apply(commands: SegmentCommand[]): Promise<ApplyResult> {
    const started = Date.now();
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.failNext > 0) {
      this.failNext--;
      this.online = false;
      return { ok: false, latencyMs: Date.now() - started, attempts: 1, error: 'mock failure' };
    }
    this.online = true;
    this.applied.push(commands);
    for (const c of commands) this.segments.set(c.segmentId, c.look);
    this.lastAckAt = Date.now();
    this.lastLatencyMs = this.lastAckAt - started;
    return { ok: true, latencyMs: this.lastLatencyMs, attempts: 1 };
  }
}
