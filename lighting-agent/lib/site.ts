import { hostname } from 'node:os';
import type { LightingEvent } from '../../src/lib/lighting/events.ts';
import type { LightingSnapshot } from '../../src/lib/lighting/hub.ts';
import { readDeviceToken, saveDeviceToken, type Logger } from './platform.ts';
import { SseParser } from './sse.ts';

// The agent's connection to RacingCoach.app (docs/lighting/README.md, Event stream). The Mac always connects out:
// nothing on the internet connects to it.
//
// Pairing (pairDevice): the site gives a code, the owner approves it on the Admin page, and the device token goes in
// the Keychain. Running (SiteConnection): the device token buys a 15-minute access token, which opens the event
// stream; the stream's events, snapshots and heartbeats go to the runtime. A dropped stream reconnects with
// exponential backoff and jitter, resuming from the last event (Last-Event-ID); silence for WATCHDOG_MS counts as
// dropped. A revoked device stops trying until it's paired again. None of this stops the lights' local control.

const WATCHDOG_MS = 8_000;
const HEARTBEAT_EVERY_MS = 5_000;
const BACKOFF_MAX_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;

export type StreamHeartbeat = { epoch: string; sequence: number; serverTimeUtc: string; telemetryAgeMs: number | null; fresh: boolean };

export type SiteStatus = 'unpaired' | 'connecting' | 'connected' | 'reconnecting' | 'revoked' | 'stopped';

export type SiteHandlers = {
  onSnapshot(snapshot: LightingSnapshot): void;
  onEvent(event: LightingEvent): void;
  onHeartbeat(heartbeat: StreamHeartbeat, receivedAt: number): void;
  onStatus(status: SiteStatus): void;
  // The agent's report for the Admin page (POST /api/lighting/devices/heartbeat)
  agentStatus(): Record<string, unknown>;
};

export const backoffMs = (attempt: number, random = Math.random) =>
  Math.min(BACKOFF_MAX_MS, 1000 * 2 ** Math.min(attempt, 6)) * (0.75 + random() * 0.5);

async function post(siteUrl: string, path: string, body: unknown, accessToken?: string): Promise<Response> {
  return fetch(new URL(path, siteUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

// racingcoach-lighting pair: prints the code to approve, waits for it, keeps the device token
export async function pairDevice(siteUrl: string, name: string | undefined, print: (line: string) => void): Promise<boolean> {
  const response = await post(siteUrl, '/api/lighting/devices/register', { name: name ?? `Lighting agent on ${hostname()}` });
  if (!response.ok) throw new Error(`Pairing request refused (${response.status}): ${await response.text()}`);
  const { code, pairingSecret, expiresAt } = (await response.json()) as { code: string; pairingSecret: string; expiresAt: number };
  print('');
  print(`  Pairing code:  ${code}`);
  print('');
  print(`  Open ${new URL('/admin/lighting', siteUrl)} (signed in as an Admin), choose Controllers > Pair agent,`);
  print('  and type this code. Waiting for it to be approved...');
  while (Date.now() < expiresAt) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const claim = await post(siteUrl, '/api/lighting/devices/claim', { pairingSecret }).catch(() => null);
    if (!claim?.ok) continue;
    const answer = (await claim.json()) as { status: string; deviceToken?: string };
    if (answer.status === 'paired' && answer.deviceToken) {
      await saveDeviceToken(answer.deviceToken);
      print('  Paired. The device token is in your login Keychain.');
      return true;
    }
    if (answer.status === 'expired') break;
  }
  print('  The code expired. Run pair again.');
  return false;
}

export class SiteConnection {
  private readonly siteUrl: string;
  private readonly log: Logger;
  private readonly handlers: SiteHandlers;
  private stopped = false;
  private abort: AbortController | null = null;
  private accessToken: string | null = null;
  private accessExpiresAt = 0;
  private lastEventId: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  status: SiteStatus = 'connecting';

  constructor(siteUrl: string, log: Logger, handlers: SiteHandlers) {
    this.siteUrl = siteUrl;
    this.log = log;
    this.handlers = handlers;
  }

  private setStatus(status: SiteStatus) {
    if (status === this.status) return;
    this.status = status;
    this.log('info', `RacingCoach.app: ${status}`);
    this.handlers.onStatus(status);
  }

  start(): void {
    void this.loop();
    this.heartbeatTimer = setInterval(() => void this.sendHeartbeat(), HEARTBEAT_EVERY_MS);
  }

  stop(): void {
    this.stopped = true;
    this.abort?.abort();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.setStatus('stopped');
  }

  // A fresh access token when the one held has less than two minutes left; null when the device isn't paired or was revoked
  private async token(): Promise<string | null> {
    if (this.accessToken && this.accessExpiresAt - Date.now() > 120_000) return this.accessToken;
    const deviceToken = await readDeviceToken();
    if (!deviceToken) {
      this.setStatus('unpaired');
      return null;
    }
    const response = await post(this.siteUrl, '/api/lighting/devices/token', { deviceToken });
    if (response.status === 401 || response.status === 404) {
      this.accessToken = null;
      this.setStatus('revoked');
      return null;
    }
    if (!response.ok) throw new Error(`Token request failed (${response.status})`);
    const answer = (await response.json()) as { accessToken: string; expiresAt: number };
    this.accessToken = answer.accessToken;
    this.accessExpiresAt = answer.expiresAt;
    return this.accessToken;
  }

  private async loop(): Promise<void> {
    let attempt = 0;
    while (!this.stopped) {
      try {
        const token = await this.token();
        if (!token) {
          // Not paired, or revoked: look again now and then (pairing runs in another process)
          await new Promise((resolve) => setTimeout(resolve, this.status === 'revoked' ? 300_000 : 30_000));
          continue;
        }
        this.setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
        const delivered = await this.stream(token);
        if (delivered) attempt = 0;
      } catch (error) {
        this.log('warn', 'Event stream dropped', { error: error instanceof Error ? error.message : String(error) });
      }
      if (this.stopped) break;
      this.setStatus('reconnecting');
      await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt++)));
    }
  }

  // One connection to the event stream; true when it delivered anything (so the backoff starts over)
  private async stream(token: string): Promise<boolean> {
    this.abort = new AbortController();
    const abort = this.abort;
    let delivered = false;
    let lastMessageAt = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastMessageAt > WATCHDOG_MS) abort.abort(new Error('No events or heartbeats for 8 s'));
    }, 1000);
    try {
      const response = await fetch(new URL('/api/lighting/events', this.siteUrl), {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
          ...(this.lastEventId ? { 'Last-Event-ID': this.lastEventId } : {}),
        },
        signal: abort.signal,
      });
      if (response.status === 401) {
        this.accessToken = null;
        return false;
      }
      if (!response.ok || !response.body) throw new Error(`Event stream refused (${response.status})`);
      this.setStatus('connected');
      const parser = new SseParser((message) => {
        lastMessageAt = Date.now();
        delivered = true;
        if (message.id) this.lastEventId = message.id;
        try {
          if (message.event === 'snapshot') this.handlers.onSnapshot(JSON.parse(message.data));
          else if (message.event === 'lighting') this.handlers.onEvent(JSON.parse(message.data));
          else if (message.event === 'heartbeat') this.handlers.onHeartbeat(JSON.parse(message.data), lastMessageAt);
          else if (message.event === 'reauth') {
            this.accessToken = null;
            abort.abort(new Error('Access token ended'));
          }
        } catch (error) {
          this.log('warn', 'Bad event from the stream', { error: error instanceof Error ? error.message : String(error) });
        }
      });
      const decoder = new TextDecoder();
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        lastMessageAt = Date.now();
        parser.push(decoder.decode(chunk, { stream: true }));
      }
    } finally {
      clearInterval(watchdog);
    }
    return delivered;
  }

  private async sendHeartbeat(): Promise<void> {
    if (this.stopped || !this.accessToken || this.status === 'revoked') return;
    try {
      const response = await post(this.siteUrl, '/api/lighting/devices/heartbeat', this.handlers.agentStatus(), this.accessToken);
      if (response.status === 401) this.accessToken = null;
    } catch {
      // the stream's own reconnects say when the site is unreachable
    }
  }
}
