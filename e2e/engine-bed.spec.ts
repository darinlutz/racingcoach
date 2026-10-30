// The engine sound under ElevenLabs speech (src/lib/engineBed.ts) in a real browser: real Web Audio, real audio elements
// and the real sound file, then the pages it's wired into. npm run test:e2e, with E2E_DATABASE_URL (playwright.config.ts).
// The upload test also needs BROADCAST_VIDEO_S3_* set to a disposable bucket (MinIO; no CORS rule needed, as files go
// through the site). Speech is stubbed in the browser, so nothing reaches ElevenLabs. Hearing it is still a person's job:
// docs/tv-broadcast.md has the checklist, Fire TV included.

import { readFileSync } from 'node:fs';
import nodeModule from 'node:module';
import pg from 'pg';
import { chromium, expect, test, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test';
import { POLICY_VERSIONS } from '../src/lib/policyVersions';

const BASE = `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const SOUND_FILE = 'public/assets/sounds/GT3EngineNoise.mp3';
// Node 22.13 and later; @types/node doesn't list it yet
const { stripTypeScriptTypes } = nodeModule as never as { stripTypeScriptTypes: (source: string, options: { mode: 'strip' }) => string };
const managerSource = stripTypeScriptTypes(readFileSync('src/lib/engineBed.ts', 'utf8'), { mode: 'strip' });

type Reading = { level: number; sources: number; state: string };

// Puts the manager in the page, with its output tapped by an analyser and a 1 s loud noise to loop, whose level is steady
async function harness(page: Page): Promise<void> {
  await page.goto('/cookies');
  await page.addScriptTag({ type: 'module', content: `${managerSource}\nwindow.EngineBedModule = { EngineBed, linkSpeech, seamlessLoop };` });
  await page.waitForFunction(() => 'EngineBedModule' in window);
  await page.evaluate(() => {
    const w = window as never as Record<string, unknown>;
    const wavUrl = (seconds: number, sample: (i: number) => number) => {
      const rate = 44_100;
      const frames = Math.round(seconds * rate);
      const view = new DataView(new ArrayBuffer(44 + frames * 2));
      const ascii = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
      ascii(0, 'RIFF');
      view.setUint32(4, 36 + frames * 2, true);
      ascii(8, 'WAVEfmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, rate, true);
      view.setUint32(28, rate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      ascii(36, 'data');
      view.setUint32(40, frames * 2, true);
      for (let i = 0; i < frames; i++) view.setInt16(44 + i * 2, Math.round(sample(i) * 32_767), true);
      return URL.createObjectURL(new Blob([view.buffer], { type: 'audio/wav' }));
    };
    let seed = 12_345;
    const noise = () => ((seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff) / 0x7fffffff - 0.5) * 0.8;
    w.loopUrl = wavUrl(1, noise);
    w.speechUrl = (seconds: number) => wavUrl(seconds, (i) => 0.2 * Math.sin(i * 0.05));
    w.sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    w.makeBed = (url: string, overrides: object = {}) => {
      const stats: { sources: number; context: (AudioContext & { tap: AnalyserNode }) | null } = { sources: 0, context: null };
      class Tapped extends AudioContext {
        tap: AnalyserNode;
        constructor() {
          super();
          this.tap = this.createAnalyser();
          this.tap.fftSize = 2048;
          this.tap.connect(super.destination);
          stats.context = this as never;
        }
        get destination() {
          return this.tap as never;
        }
        createBufferSource() {
          stats.sources++;
          return super.createBufferSource();
        }
      }
      const { EngineBed } = w.EngineBedModule as never as { EngineBed: new (options: object) => { configure(config: object): void } };
      const bed = new EngineBed({
        createContext: () => new Tapped(),
        fetchAudio: async (from: string) => {
          const response = await fetch(from);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.arrayBuffer();
        },
      });
      bed.configure({ enabled: true, volume: 1, fadeInMs: 20, fadeOutMs: 300, url, ...overrides });
      const read = () => {
        const tap = stats.context?.tap;
        const samples = new Float32Array(2048);
        tap?.getFloatTimeDomainData(samples);
        return {
          level: tap ? Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length) : 0,
          sources: stats.sources,
          state: stats.context?.state ?? 'none',
        };
      };
      return { bed, read };
    };
    // Plays a line through linkSpeech to its end, or until interruptAfterMs; resolves with the event order
    w.say = async (bed: never, seconds: number, continuing = false, interruptAfterMs = 0) => {
      const { linkSpeech } = w.EngineBedModule as never as { linkSpeech: (bed: never, audio: HTMLAudioElement, more: () => boolean) => () => void };
      const audio = new Audio((w.speechUrl as never as (s: number) => string)(seconds));
      const events: string[] = [];
      for (const event of ['playing', 'pause', 'ended']) audio.addEventListener(event, () => events.push(`${event}:${audio.ended}`));
      audio.addEventListener('playing', () => (w.lastPlaying = performance.now() as never));
      const unlink = linkSpeech(bed, audio, () => continuing);
      await audio.play();
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        if (interruptAfterMs) setTimeout(() => (audio.pause(), resolve()), interruptAfterMs);
      });
      unlink();
      return events;
    };
    // Readings every 20 ms while run goes on
    w.watch = async (read: () => Reading, run: () => Promise<unknown>) => {
      const readings: (Reading & { at: number })[] = [];
      const started = performance.now();
      const timer = setInterval(() => readings.push({ ...read(), at: performance.now() - started }), 20);
      const result = await run();
      const endedAt = performance.now() - started;
      return { readings, endedAt, result, playingAt: () => (w.lastPlaying as number) - started, stop: () => clearInterval(timer) };
    };
  });
}

type Helpers = {
  loopUrl: string;
  makeBed: (url: string, overrides?: object) => { bed: never; read: () => Reading };
  say: (bed: never, seconds: number, continuing?: boolean, interruptAfterMs?: number) => Promise<string[]>;
  sleep: (ms: number) => Promise<void>;
  // Keeps sampling after run ends, until stop
  watch: (read: () => Reading, run: () => Promise<unknown>) => Promise<{ readings: (Reading & { at: number })[]; endedAt: number; result: unknown; playingAt: () => number; stop: () => void }>;
};
declare global {
  interface Window {
    h: Helpers;
  }
}

const SILENT = 0.0005;

test.describe('real audio', () => {
  let browser: Browser;
  let page: Page;

  test.beforeAll(async () => {
    // A browser that insists on a click before sound, as real ones do
    browser = await chromium.launch({
      args: ['--autoplay-policy=document-user-activation-required'],
      ...(process.env.E2E_BROWSER_PATH ? { executablePath: process.env.E2E_BROWSER_PATH } : {}),
      ...(process.env.E2E_BROWSER_CHANNEL ? { channel: process.env.E2E_BROWSER_CHANNEL } : {}),
    });
  });
  test.afterAll(async () => {
    await browser?.close();
  });
  test.beforeEach(async () => {
    const context = await browser.newContext({ baseURL: BASE });
    page = await context.newPage();
    await harness(page);
    await page.evaluate(() => {
      window.h = window as never;
    });
  });
  test.afterEach(async () => {
    await page.context().close();
  });
  const click = () => page.mouse.click(5, 5);

  test('the real sound file decodes and loops with no jump at the seam', async () => {
    const seam = await page.evaluate(async (file) => {
      const context = new OfflineAudioContext(2, 44_100, 44_100);
      const decoded = await context.decodeAudioData(await (await fetch(file)).arrayBuffer());
      const { seamlessLoop } = (window as never as { EngineBedModule: { seamlessLoop: (c: Float32Array[], r: number) => Float32Array[] } }).EngineBedModule;
      const raw = Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c));
      const loop = seamlessLoop(raw, decoded.sampleRate);
      const biggestStep = (s: Float32Array) => {
        let biggest = 0;
        for (let i = 1; i < s.length; i++) biggest = Math.max(biggest, Math.abs(s[i] - s[i - 1]));
        return biggest;
      };
      return {
        seconds: loop[0].length / decoded.sampleRate,
        rawSeconds: decoded.duration,
        channels: loop.length,
        seamSteps: loop.map((c) => Math.abs(c[0] - c[c.length - 1])),
        biggestSteps: loop.map(biggestStep),
        rawSeamSteps: raw.map((c) => Math.abs(c[0] - c[c.length - 1])),
      };
    }, `/${SOUND_FILE.replace('public/', '')}`);
    console.log('Real file loop:', JSON.stringify(seam));
    expect(seam.channels).toBe(2);
    expect(seam.seconds).toBeGreaterThan(25);
    seam.seamSteps.forEach((step, c) => expect(step).toBeLessThanOrEqual(seam.biggestSteps[c]));
  });

  test('silent before speech, starts as it plays, and a natural end fades over 300 ms', async () => {
    await click();
    const out = await page.evaluate(async () => {
      const { h } = window;
      const { bed, read } = h.makeBed(h.loopUrl);
      (bed as never as { unlock(): void }).unlock();
      await h.sleep(300);
      const before = read();
      const run = await h.watch(read, () => h.say(bed, 1));
      await h.sleep(700);
      run.stop();
      return { before, events: run.result as string[], endedAt: run.endedAt, playingAt: run.playingAt(), readings: run.readings, last: read() };
    });
    expect(out.before.level).toBeLessThan(SILENT);
    expect(out.before.sources).toBe(0);
    // Browsers really do fire pause before ended, which is why the link looks at ended
    expect(out.events.slice(0, 3)).toEqual(['playing:false', 'pause:true', 'ended:true']);
    const onset = out.readings.find((r) => r.level > 0.01)!.at;
    console.log(`Engine audible ${Math.round(onset - out.playingAt)} ms after the speech's playing event`);
    expect(onset - out.playingAt).toBeLessThan(250);
    const during = out.readings.filter((r) => r.at > onset + 100 && r.at < out.endedAt - 100);
    expect(during.length).toBeGreaterThan(5);
    during.forEach((r) => expect(r.level).toBeGreaterThan(0.1));
    const after = out.readings.filter((r) => r.at > out.endedAt);
    // An analyser holds its last frame once the context suspends, which is the moment the bed has gone
    const quiet = after.find((r) => r.level < SILENT || r.state === 'suspended');
    expect(quiet, 'fell silent').toBeTruthy();
    const fade = quiet!.at - out.endedAt;
    console.log(`Natural end: gone ${Math.round(fade)} ms after ended; levels ${after.slice(0, 16).map((r) => r.level.toFixed(3)).join(' ')}`);
    expect(fade).toBeGreaterThan(200);
    expect(fade).toBeLessThan(500);
    // Falling through the fade, not cut off: still there early on, well down late on
    const at = (ms: number) => after.find((r) => r.at - out.endedAt >= ms)!.level;
    expect(at(100)).toBeGreaterThan(0.05);
    expect(at(250)).toBeLessThan(at(100));
    expect(out.last.sources).toBe(1);
    expect(out.last.state).toBe('suspended');
  });

  test('a line far longer than the sound keeps it going, at a steady level', async () => {
    await click();
    const out = await page.evaluate(async () => {
      const { h } = window;
      const { bed, read } = h.makeBed(h.loopUrl);
      (bed as never as { unlock(): void }).unlock();
      await h.sleep(300);
      const run = await h.watch(read, () => h.say(bed, 4));
      run.stop();
      return { readings: run.readings, endedAt: run.endedAt };
    });
    const onset = out.readings.find((r) => r.level > 0.01)!.at;
    const steady = out.readings.filter((r) => r.at > onset + 100 && r.at < out.endedAt - 100).map((r) => r.level);
    const mean = steady.reduce((a, b) => a + b, 0) / steady.length;
    console.log(`Looping over 4 s: mean ${mean.toFixed(3)}, min ${Math.min(...steady).toFixed(3)}, max ${Math.max(...steady).toFixed(3)}`);
    expect(steady.length).toBeGreaterThan(50);
    expect(Math.min(...steady)).toBeGreaterThan(mean * 0.6);
    expect(Math.max(...steady)).toBeLessThan(mean * 1.4);
  });

  test('the volume is what was set, and independent of the voice', async () => {
    await click();
    const levels = await page.evaluate(async () => {
      const { h } = window;
      const measure = async (volume: number) => {
        const { bed, read } = h.makeBed(h.loopUrl, { volume });
        (bed as never as { unlock(): void }).unlock();
        await h.sleep(300);
        const run = await h.watch(read, () => h.say(bed, 1));
        run.stop();
        const onset = run.readings.find((r) => r.level > 0.001)!.at;
        const steady = run.readings.filter((r) => r.at > onset + 100 && r.at < run.endedAt - 100).map((r) => r.level);
        return steady.reduce((a, b) => a + b, 0) / steady.length;
      };
      return { full: await measure(1), fifteen: await measure(0.15) };
    });
    console.log('Levels:', JSON.stringify(levels), 'ratio', levels.fifteen / levels.full);
    expect(levels.fifteen / levels.full).toBeGreaterThan(0.13);
    expect(levels.fifteen / levels.full).toBeLessThan(0.17);
  });

  test('an interruption stops it quickly', async () => {
    await click();
    const out = await page.evaluate(async () => {
      const { h } = window;
      const { bed, read } = h.makeBed(h.loopUrl);
      (bed as never as { unlock(): void }).unlock();
      await h.sleep(300);
      const run = await h.watch(read, () => h.say(bed, 5, false, 500));
      await h.sleep(400);
      run.stop();
      return { readings: run.readings, endedAt: run.endedAt };
    });
    // As for a natural end, the analyser holds its last frame once the context suspends
    const quiet = out.readings.find((r) => r.at > out.endedAt && (r.level < SILENT || r.state === 'suspended'));
    expect(quiet, 'fell silent').toBeTruthy();
    const fade = quiet!.at - out.endedAt;
    console.log(`Interrupted: gone ${Math.round(fade)} ms later`);
    expect(fade).toBeLessThan(220);
  });

  test('consecutive lines share one unbroken sound; overlapping ones share one too', async () => {
    await click();
    const out = await page.evaluate(async () => {
      const { h } = window;
      const { bed, read } = h.makeBed(h.loopUrl);
      (bed as never as { unlock(): void }).unlock();
      await h.sleep(300);
      const run = await h.watch(read, async () => {
        await h.say(bed, 0.6, true);
        await h.sleep(200);
        await h.say(bed, 0.6);
      });
      run.stop();
      const consecutive = { sources: read().sources, readings: run.readings, endedAt: run.endedAt };
      await h.sleep(500);
      const before = read().sources;
      await Promise.all([h.say(bed, 0.6), h.say(bed, 0.3)]);
      return { consecutive, overlapping: read().sources - before };
    });
    expect(out.consecutive.sources).toBe(1);
    const onset = out.consecutive.readings.find((r) => r.level > 0.01)!.at;
    const through = out.consecutive.readings.filter((r) => r.at > onset + 100 && r.at < out.consecutive.endedAt - 100);
    through.forEach((r) => expect(r.level).toBeGreaterThan(0.1));
    expect(out.overlapping).toBe(1);
  });

  test('before the first click there is no sound; after it, the engine comes in', async () => {
    // Playwright's page.evaluate counts as a user gesture, so a fresh page runs this by itself from an init script,
    // reporting through the console. Headless browsers don't enforce the autoplay policy whatever the flags, so the lock
    // itself is emulated, around real audio: suspended, and resume() going nowhere, until a real click
    const context = await browser.newContext({ baseURL: BASE });
    const fresh = await context.newPage();
    const script = `${managerSource.replace(/^export /gm, '')}
      window.addEventListener('load', () => {
        const frames = 44100;
        const raw = new Float32Array(frames).map(() => (Math.random() - 0.5) * 0.8);
        const header = new DataView(new ArrayBuffer(44));
        const ascii = (at, text) => [...text].forEach((c, i) => header.setUint8(at + i, c.charCodeAt(0)));
        ascii(0, 'RIFF'); header.setUint32(4, 36 + frames * 2, true); ascii(8, 'WAVEfmt '); header.setUint32(16, 16, true);
        header.setUint16(20, 1, true); header.setUint16(22, 1, true); header.setUint32(24, 44100, true);
        header.setUint32(28, 88200, true); header.setUint16(32, 2, true); header.setUint16(34, 16, true);
        ascii(36, 'data'); header.setUint32(40, frames * 2, true);
        const url = URL.createObjectURL(new Blob([header.buffer, Int16Array.from(raw, (s) => s * 32767).buffer], { type: 'audio/wav' }));
        let tapped = null;
        let unlocked = false;
        window.addEventListener('pointerdown', (event) => { unlocked = event.isTrusted; }, { capture: true });
        class Tapped extends AudioContext {
          constructor() { super(); super.suspend(); this.tap = this.createAnalyser(); this.tap.fftSize = 2048; this.tap.connect(super.destination); tapped = this; }
          get destination() { return this.tap; }
          resume() { return unlocked ? super.resume() : new Promise(() => undefined); }
        }
        const bed = new EngineBed({ createContext: () => new Tapped(), fetchAudio: async (from) => (await fetch(from)).arrayBuffer() });
        bed.configure({ enabled: true, volume: 1, fadeInMs: 20, fadeOutMs: 300, url });
        bed.armUnlock();
        bed.acquire();
        setInterval(() => {
          const samples = new Float32Array(2048);
          tapped?.tap.getFloatTimeDomainData(samples);
          console.log('bed ' + JSON.stringify({ state: tapped?.state ?? 'none', level: Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / 2048) }));
        }, 100);
      });`;
    await fresh.addInitScript(script);
    let latest = { state: 'none', level: 0 };
    let reports = 0;
    fresh.on('console', (message) => {
      if (!message.text().startsWith('bed ')) return;
      latest = JSON.parse(message.text().slice(4));
      reports++;
    });
    await fresh.goto('/cookies');
    await expect.poll(() => reports, { timeout: 15_000 }).toBeGreaterThan(10);
    expect(latest.state, 'the browser keeps it locked until a click').toBe('suspended');
    expect(latest.level).toBeLessThan(SILENT);
    await fresh.mouse.click(5, 5);
    await expect.poll(() => latest.level, { timeout: 5000 }).toBeGreaterThan(0.1);
    expect(latest.state).toBe('running');
    await context.close();
  });

  test('speech is untouched when the sound is missing or isn\'t audio, and shutdown frees everything', async () => {
    await click();
    const out = await page.evaluate(async () => {
      const { h } = window;
      const missing = h.makeBed('/assets/sounds/nothing-here.mp3');
      const notAudio = h.makeBed('/cookies');
      const events = [await h.say(missing.bed, 0.3), await h.say(notAudio.bed, 0.3)];
      const { bed, read } = h.makeBed(h.loopUrl);
      (bed as never as { unlock(): void }).unlock();
      await h.sleep(300);
      (bed as never as { acquire(): unknown }).acquire();
      await h.sleep(100);
      (bed as never as { shutdown(): void }).shutdown();
      await h.sleep(100);
      return { events, sources: [missing.read().sources, notAudio.read().sources], closed: read().state };
    });
    out.events.forEach((events) => expect(events).toContain('ended:true'));
    expect(out.sources).toEqual([0, 0]);
    expect(out.closed).toBe('closed');
  });
});

test.describe.serial('the pages', () => {
  // The dev server compiles each page the first time it's opened
  test.setTimeout(300_000);
  let admin: BrowserContext;
  let viewer: BrowserContext;
  let driver: BrowserContext;
  let uploadKey = '';
  let db: pg.Client;
  let live: ReturnType<typeof setInterval> | null = null;
  const speechMp3 = readFileSync(SOUND_FILE).subarray(0, 40_000).toString('base64');
  // A second of tone as a WAV, as the Live Racing page's and sample route's speech is
  const speechWav = (() => {
    const rate = 24_000;
    const data = Buffer.alloc(rate * 2);
    for (let i = 0; i < rate; i++) data.writeInt16LE(Math.round(Math.sin(i * 0.05) * 8000), i * 2);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
  })();

  async function signUp(browser: Browser, name: string, email: string): Promise<BrowserContext> {
    const context = await browser.newContext({ baseURL: BASE });
    const response = await context.request.post('/api/auth/signup', {
      data: { userName: name, emailAddress: email, password: 'correct-horse-9', preferredLanguage: 'en', acceptedPolicies: POLICY_VERSIONS },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return context;
  }

  // Counts what the page asks of Web Audio, and keeps its contexts and gains to look at
  const watchAudio = () =>
    (window as never as Record<string, unknown>).audioLog === undefined &&
    (() => {
      const log = { sources: 0, gains: [] as GainNode[], contexts: [] as AudioContext[] };
      (window as never as Record<string, unknown>).audioLog = log;
      const Original = window.AudioContext;
      window.AudioContext = class extends Original {
        constructor() {
          super();
          log.contexts.push(this);
        }
        createBufferSource() {
          log.sources++;
          return super.createBufferSource();
        }
        createGain() {
          const gain = super.createGain();
          log.gains.push(gain);
          return gain;
        }
      };
    })();
  type AudioLog = { sources: number; gains: GainNode[]; contexts: AudioContext[] };
  const sources = (page: Page) => page.evaluate(() => (window as never as { audioLog: AudioLog }).audioLog.sources);
  const lastGain = (page: Page) => page.evaluate(() => (window as never as { audioLog: AudioLog }).audioLog.gains.at(-1)?.gain.value ?? -1);
  const contextState = (page: Page) => page.evaluate(() => (window as never as { audioLog: AudioLog }).audioLog.contexts.at(-1)?.state ?? 'none');

  // A driver in a race, whose position keeps changing so there are always new race events to commentate
  function startDriving() {
    let sequence = 0;
    const send = () => {
      const position = 2 + (Math.floor(sequence / 8) % 2);
      const pct = (sequence % 180) / 180;
      const body = {
        track: 'Test Circuit',
        trackKey: 'test circuit',
        car: 'Porsche 911 GT3 R',
        sessionType: 'Race',
        sessionName: 'RACE',
        sessionState: 4,
        sessionFlags: 0,
        onTrack: true,
        onPitRoad: false,
        lap: 5,
        pct,
        speed: 60,
        gear: 4,
        position,
        incidents: 0,
        sessionTimeRemain: 1500,
        acceptsMessages: true,
      };
      sequence++;
      return fetch(`${BASE}/api/collector/live`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${uploadKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => undefined);
    };
    live = setInterval(send, 500);
    return send();
  }

  const commentaryAnswer = (audio: string, elevenLabs: boolean) => {
    let told = 0;
    return async (route: Route) => {
      const text = `Line ${++told} for the broadcast.`;
      await route.fulfill({
        json: {
          seq: 0,
          lines: [{ speaker: 'lead', text, audio, intensity: 2, priority: 1, ttlMs: 30_000, durationMs: 1000, volume: 1, elevenLabs }],
          replaceQueued: false,
        },
      });
    };
  };

  test.beforeAll(async ({ browser }) => {
    const stamp = Date.now();
    admin = await signUp(browser, 'Site Owner', `owner-${stamp}@example.test`);
    viewer = await signUp(browser, 'Plain Viewer', `viewer-${stamp}@example.test`);
    const driverEmail = `driver-${stamp}@example.test`;
    driver = await signUp(browser, 'Sam Driver', driverEmail);
    db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
    await db.connect();
    await db.query(`UPDATE racingcoach."Users" SET role = 'Admin' WHERE email_address = $1`, [`owner-${stamp}@example.test`]);
    // Everyone may watch a Coach
    await db.query(`UPDATE racingcoach."Users" SET role = 'Coach' WHERE email_address = $1`, [driverEmail]);
    uploadKey = (await (await driver.request.post('/api/collector/key')).json()).key;
    expect(uploadKey).toBeTruthy();
    await admin.addInitScript(watchAudio);
  });

  test.afterAll(async () => {
    if (live) clearInterval(live);
    await db?.end();
    await Promise.all([admin?.close(), viewer?.close(), driver?.close()]);
  });

  test('the Account page starts at 15%, saves changes and previews voice over engine', async () => {
    const page = await admin.newPage();
    let previewProvider: string | null = 'elevenlabs';
    await page.route('**/api/account/race-announcers/sample*', (route) =>
      route.fulfill({ body: speechWav, headers: { 'Content-Type': 'audio/wav', ...(previewProvider ? { 'X-Speech-Provider': previewProvider } : {}) } })
    );
    await page.goto('/account');
    const panel = page.getByTestId('engine-settings');
    await expect(panel).toContainText('15%');
    await expect(panel.getByRole('checkbox')).toBeChecked();
    await expect(panel).toContainText('300 ms');
    await expect(panel.getByRole('combobox')).toHaveValue('');

    // Preview: the engine under an ElevenLabs voice, from the press
    expect(await sources(page)).toBe(0);
    await panel.getByRole('button', { name: 'Preview voice and engine' }).click();
    await expect.poll(() => sources(page), { timeout: 15_000 }).toBe(1);
    await expect(panel.getByRole('button', { name: 'Preview voice and engine' })).toBeEnabled({ timeout: 10_000 });
    await expect.poll(() => contextState(page), { timeout: 5000 }).toBe('suspended');

    // Another provider's voice: no engine, and the page says why
    previewProvider = null;
    await page.route('**/api/account/race-announcers/sample*', (route) => route.fulfill({ body: speechWav, headers: { 'Content-Type': 'audio/wav' } }));
    await panel.getByRole('button', { name: 'Preview voice and engine' }).click();
    await expect(panel.getByRole('status')).toContainText('only plays under ElevenLabs');
    await expect(panel.getByRole('button', { name: 'Preview voice and engine' })).toBeEnabled({ timeout: 10_000 });
    expect(await sources(page)).toBe(1);

    // Saved, and still there after a reload
    const saved = page.waitForResponse((r) => r.url().includes('/api/account/race-announcers') && r.request().method() === 'PUT');
    await panel.getByRole('slider').first().fill('40');
    expect((await saved).ok()).toBeTruthy();
    await page.reload();
    await expect(page.getByTestId('engine-settings')).toContainText('40%');
    await page.close();
  });

  test('bad preferences are refused', async () => {
    for (const broadcast of [{ engineVolume: 'loud' }, { engineAsset: -1 }, { engineEnabled: 1 }]) {
      expect((await admin.request.put('/api/account/race-announcers', { data: { broadcast } })).status()).toBe(400);
    }
    const reset = await admin.request.put('/api/account/race-announcers', { data: { broadcast: { engineVolume: 15 } } });
    const answer = await reset.text();
    expect(reset.status(), answer.slice(0, 500)).toBe(200);
    expect(JSON.parse(answer).broadcast.engineVolume).toBe(15);
  });

  test('uploads: Admins only, real MP3s and WAVs only, served to signed-in users only', async ({ browser }) => {
    test.skip(!process.env.BROADCAST_VIDEO_S3_ENDPOINT, 'needs BROADCAST_VIDEO_S3_*');
    const page = await admin.newPage();
    await page.goto('/admin');
    const library = page.locator('#engine-audio-library');
    await library.scrollIntoViewIfNeeded();

    // A web page renamed .mp3 is turned away with a clear message
    await library.locator('input[type=file]').setInputFiles({ name: 'sneaky.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('<html><script>alert(1)</script></html>') });
    await library.getByRole('button', { name: 'Upload' }).click();
    await expect(library.getByRole('alert')).toContainText('isn’t an MP3 or WAV');

    await library.locator('input[type=file]').setInputFiles(SOUND_FILE);
    await library.locator('#engine-audio-name').fill('Test Engine');
    await library.getByRole('button', { name: 'Upload' }).click();
    await expect(library).toContainText('Test Engine', { timeout: 30_000 });

    const { assets } = await (await admin.request.get('/api/admin/broadcast/engine-audio')).json();
    const asset = assets.find((a: { name: string }) => a.name === 'Test Engine');
    expect(asset.contentType).toBe('audio/mpeg');

    // Not for anyone but an Admin
    expect((await viewer.request.get('/api/admin/broadcast/engine-audio')).status()).toBe(404);
    const refused = await viewer.request.post('/api/admin/broadcast/engine-audio', { multipart: { file: { name: 'x.mp3', mimeType: 'audio/mpeg', buffer: readFileSync(SOUND_FILE) } } });
    expect(refused.status()).toBe(404);
    expect((await viewer.request.delete(`/api/admin/broadcast/engine-audio/${asset.id}`)).status()).toBe(404);

    // The file itself: any account, nobody else; the same bytes
    const file = await viewer.request.get(`/api/engine-audio/${asset.id}`);
    expect(file.status()).toBe(200);
    expect(file.headers()['content-type']).toBe('audio/mpeg');
    expect(Buffer.compare(await file.body(), readFileSync(SOUND_FILE))).toBe(0);
    const anonymous = await browser.newContext({ baseURL: BASE });
    expect((await anonymous.request.get(`/api/engine-audio/${asset.id}`)).status()).toBe(404);
    await anonymous.close();

    // A listener can pick it, and the engine comes from it
    const account = await admin.newPage();
    await account.route('**/api/account/race-announcers/sample*', (route) =>
      route.fulfill({ body: speechWav, headers: { 'Content-Type': 'audio/wav', 'X-Speech-Provider': 'elevenlabs' } })
    );
    await account.goto('/account');
    const panel = account.getByTestId('engine-settings');
    const saved = account.waitForResponse((r) => r.url().includes('/api/account/race-announcers') && r.request().method() === 'PUT');
    await panel.getByRole('combobox').selectOption({ label: 'Test Engine' });
    expect((await saved).ok()).toBeTruthy();
    const fetched = account.waitForResponse((r) => r.url().endsWith(`/api/engine-audio/${asset.id}`) && r.ok());
    await panel.getByRole('button', { name: 'Preview voice and engine' }).click();
    await fetched;
    await expect.poll(() => sources(account), { timeout: 15_000 }).toBe(1);
    await account.close();

    // Deleted: it's gone, and whoever picked it falls back to the built-in sound
    page.on('dialog', (dialog) => dialog.accept());
    await library.getByRole('listitem').filter({ hasText: 'Test Engine' }).getByRole('button', { name: 'Remove' }).click();
    await expect(library).not.toContainText('Test Engine');
    expect((await viewer.request.get(`/api/engine-audio/${asset.id}`)).status()).toBe(404);
    const after = await admin.newPage();
    await after.goto('/account');
    await expect(after.getByTestId('engine-settings').getByRole('combobox')).toHaveValue('');
    await after.close();
    await page.close();
  });

  test('without storage set up, the Admin page says so', async () => {
    test.skip(!!process.env.BROADCAST_VIDEO_S3_ENDPOINT, 'storage is set up in this run');
    const page = await admin.newPage();
    await page.goto('/admin');
    await expect(page.locator('#engine-audio-library')).toContainText('only the built-in sound is available');
    await page.close();
  });

  test('Live Racing: ElevenLabs lines get the engine, other voices do not', async () => {
    await startDriving();
    const page = await admin.newPage();
    await page.route('**/api/live/announcer', commentaryAnswer(speechWav.toString('base64'), false));
    await page.goto('/live-racing');
    await expect(page.getByText('Sam Driver').first()).toBeVisible({ timeout: 30_000 });
    const asked = page.waitForRequest('**/api/live/announcer', { timeout: 60_000 });
    await page.mouse.click(5, 5);
    await asked;
    await page.waitForTimeout(2000);
    expect(await sources(page), 'a Chirp line plays alone').toBe(0);

    await page.unroute('**/api/live/announcer');
    await page.route('**/api/live/announcer', commentaryAnswer(speechWav.toString('base64'), true));
    await expect.poll(() => sources(page), { timeout: 60_000 }).toBeGreaterThan(0);
    // Leaving the page frees the context
    await page.goto('/cookies');
    await page.close();
  });

  test('TV: Start Broadcast unlocks it, lines get the engine, and mute silences it', async ({ browser }) => {
    if (!live) await startDriving();
    const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1920, height: 1080 } });
    await context.addInitScript(watchAudio);
    const tv = await context.newPage();
    await tv.route('**/api/tv/announcer', commentaryAnswer(speechMp3, true));
    await tv.goto('/tv');
    const code = (await tv.locator('text=/^[A-Z2-9]{4}-[A-Z2-9]{4}$/').first().innerText({ timeout: 60_000 })).trim();
    expect((await admin.request.post('/api/tv/link', { data: { code } })).ok()).toBeTruthy();
    await expect(tv.getByRole('button', { name: 'Start Broadcast' })).toBeVisible({ timeout: 30_000 });
    expect(await contextState(tv), 'nothing before the press').toBe('none');
    // The server's button shows before the dev server's slow bundle has given it a handler
    await tv.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Start Broadcast') && Object.keys(b).some((k) => k.startsWith('__reactProps'))), undefined, { timeout: 120_000 });
    const sound = tv.waitForResponse((r) => r.url().endsWith('/assets/sounds/GT3EngineNoise.mp3') && r.ok(), { timeout: 30_000 });
    // As the remote does it: Select on the focused button, a real key press
    await tv.getByRole('button', { name: 'Start Broadcast' }).focus();
    await tv.keyboard.press('Enter');
    await sound;
    await expect(tv.getByRole('button', { name: 'Test sound' })).toBeVisible();
    await expect.poll(() => contextState(tv)).toBe('running');

    await expect.poll(() => sources(tv), { timeout: 60_000 }).toBeGreaterThan(0);
    await expect.poll(() => lastGain(tv), { timeout: 5000 }).toBeGreaterThan(0);

    // Muted, the next line's engine stays silent with the voice
    await tv.getByRole('button', { name: 'Mute' }).focus();
    await tv.keyboard.press('Enter');
    await expect(tv.getByRole('button', { name: 'Unmute' })).toBeVisible();
    const before = await sources(tv);
    await expect.poll(() => sources(tv), { timeout: 60_000 }).toBeGreaterThan(before);
    for (let i = 0; i < 5; i++) {
      expect(await lastGain(tv)).toBe(0);
      await tv.waitForTimeout(100);
    }
    await tv.close();
    await context.close();
    if (live) clearInterval(live);
    live = null;
  });
});
