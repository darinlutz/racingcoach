import type { EngineBedConfig } from './engineBedConfig';

// The engine sound under ElevenLabs speech: one looping sound per page, mixed by the browser with whatever is speaking,
// so the voices and the speech queues don't change. Speech stays on its own audio element; linkSpeech follows the
// element and takes a hold on the engine bed while it's really playing. The bed plays while anyone holds it, never
// twice however many speak at once, and fades out with the last hold, at once when speech was interrupted and after a
// moment when the next line is on its way, so consecutive lines share one unbroken engine. Nothing here can stop speech:
// without the sound, or Web Audio, the announcers just speak alone. No imports but a type, so Node's tests run it
// directly with a fake audio context (npm run test:engine-bed).

// How long the bed keeps going for a next line after one ends: the line's loading, and the 0.7 s hold for the In-Car AI
// Coach when the driver watches themselves
export const CONTINUE_GRACE_MS = 1500;
export const INTERRUPT_FADE_MS = 100;
// How fast a change of volume is heard
const VOLUME_RAMP_MS = 50;
// A little longer than a fade before its nodes are stopped, as timers and the audio clock don't quite agree
const STOP_MARGIN_MS = 30;
// After a sound fails to load, how long before it's tried again
export const LOAD_RETRY_MS = 60_000;
const LOOP_CROSSFADE_S = 0.4;
const SILENCE = 0.001;

export type EndOfSpeech = 'finished' | 'interrupted';
export type EngineHold = { release: (how: EndOfSpeech, continuing?: boolean) => void };

// The parts of Web Audio used here
type AudioParamLike = {
  value: number;
  cancelScheduledValues(at: number): unknown;
  setValueAtTime(value: number, at: number): unknown;
  linearRampToValueAtTime(value: number, at: number): unknown;
};
type NodeLike = { connect(destination: never): unknown; disconnect(): void };
type GainLike = NodeLike & { gain: AudioParamLike };
type SourceLike = NodeLike & { buffer: unknown; loop: boolean; start(): void; stop(): void };
type BufferLike = { numberOfChannels: number; length: number; sampleRate: number; getChannelData(channel: number): Float32Array };
export type EngineAudioContext = {
  state: string;
  currentTime: number;
  destination: unknown;
  createGain(): GainLike;
  createBufferSource(): SourceLike;
  createBuffer(channels: number, length: number, sampleRate: number): BufferLike;
  decodeAudioData(data: ArrayBuffer): Promise<BufferLike>;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
};

// Samples ready to loop without a click or gap: silence at either end cut off (an MP3's encoder adds some), then the end
// crossfaded into the start at equal power, so the last sample leads straight into the first. Null when it's all silence
export function seamlessLoop(channels: Float32Array[], sampleRate: number): Float32Array[] | null {
  const frames = channels[0]?.length ?? 0;
  const audible = (i: number) => channels.some((c) => Math.abs(c[i]) > SILENCE);
  let start = 0;
  while (start < frames && !audible(start)) start++;
  if (start === frames) return null;
  let end = frames;
  while (end > start && !audible(end - 1)) end--;
  const length = end - start;
  const fade = Math.min(Math.round(sampleRate * LOOP_CROSSFADE_S), Math.floor(length / 3));
  return channels.map((channel) => {
    const samples = channel.subarray(start, end);
    const out = samples.slice(0, length - fade);
    for (let i = 0; i < fade; i++) {
      const angle = ((i + 0.5) / fade) * (Math.PI / 2);
      out[i] = samples[length - fade + i] * Math.cos(angle) + samples[i] * Math.sin(angle);
    }
    return out;
  });
}

type Options = {
  // Null where the browser has no Web Audio
  createContext: () => EngineAudioContext | null;
  fetchAudio: (url: string) => Promise<ArrayBuffer>;
};

export class EngineBed {
  private options: Options;
  private config: EngineBedConfig | null = null;
  // The TV's own volume and mute, 0-1; the Live Racing page has neither
  private level = 1;
  private context: EngineAudioContext | null = null;
  private holds = new Set<object>();
  private bed: { source: SourceLike; gain: GainLike; url: string } | null = null;
  private fading = false;
  private loop: { url: string; buffer: BufferLike } | null = null;
  private loading: string | null = null;
  private failed: { url: string; at: number } | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private disarm: (() => void) | null = null;

  constructor(options: Options) {
    this.options = options;
  }

  // Follows the listener's preferences, also while the bed is playing
  configure(config: EngineBedConfig): void {
    this.config = config;
    if (this.context && config.enabled) this.load(config.url);
    if (this.bed || this.holds.size > 0) this.update();
  }

  setLevel(level: number): void {
    this.level = Math.min(Math.max(level, 0), 1);
    if (this.bed && !this.fading) this.ramp(this.target(), VOLUME_RAMP_MS);
  }

  // Call from a click or key press: browsers only let Web Audio make sound after one. Also the moment to load the sound
  unlock(): void {
    try {
      this.ensureContext()?.resume().catch(() => undefined);
      if (this.config?.enabled) this.load(this.config.url);
    } catch (error) {
      console.warn('Engine sound unavailable:', error);
    }
  }

  // Unlocks at the viewer's first click or key press anywhere on the page
  armUnlock(target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> = window): void {
    if (this.disarm) return;
    const events = ['pointerdown', 'keydown', 'touchend'];
    const first = () => {
      this.disarm?.();
      this.unlock();
    };
    events.forEach((event) => target.addEventListener(event, first));
    this.disarm = () => {
      events.forEach((event) => target.removeEventListener(event, first));
      this.disarm = null;
    };
  }

  // Speech has begun; the hold ends when it's released
  acquire(): EngineHold {
    const hold = {};
    this.holds.add(hold);
    this.clearGrace();
    this.update();
    return {
      release: (how, continuing = false) => {
        // Once only, and not after a shutdown
        if (!this.holds.delete(hold) || this.holds.size > 0) return;
        this.clearGrace();
        if (how === 'interrupted') this.fadeOut(Math.min(INTERRUPT_FADE_MS, this.fadeOutMs()));
        else if (continuing && this.bed) this.graceTimer = setTimeout(() => this.afterGrace(), CONTINUE_GRACE_MS);
        else this.fadeOut(this.fadeOutMs());
      },
    };
  }

  // The speech queue was emptied (the TV hidden, another driver): nothing is coming, so no waiting for a next line
  silence(): void {
    if (this.holds.size > 0 || !this.graceTimer) return;
    this.clearGrace();
    this.fadeOut(Math.min(INTERRUPT_FADE_MS, this.fadeOutMs()));
  }

  // The page is going away: stops the sound and frees its nodes, buffer and context; holds still out there do nothing
  shutdown(): void {
    this.disarm?.();
    this.holds.clear();
    this.clearGrace();
    this.stopBed();
    this.loop = null;
    this.loading = null;
    this.failed = null;
    this.config = null;
    this.level = 1;
    const context = this.context;
    this.context = null;
    context?.close().catch(() => undefined);
  }

  private fadeOutMs(): number {
    return this.config?.fadeOutMs ?? 0;
  }

  private target(): number {
    return (this.config?.volume ?? 0) * this.level;
  }

  private ensureContext(): EngineAudioContext | null {
    this.context ??= this.options.createContext();
    return this.context;
  }

  private clearGrace(): void {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
  }

  private clearStop(): void {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    this.fading = false;
  }

  private afterGrace(): void {
    this.graceTimer = null;
    this.fadeOut(this.fadeOutMs());
  }

  // Brings the bed in line with the preferences and the holds. Never throws: it can't get in the way of speech
  private update(): void {
    try {
      const config = this.config;
      if (!config?.enabled || this.holds.size === 0) {
        if (this.holds.size > 0 || !this.graceTimer) this.fadeOut(this.fadeOutMs());
        return;
      }
      if (this.bed && this.bed.url !== config.url) this.stopBed();
      if (!this.bed) {
        this.start(config);
      } else if (this.fading) {
        // Speech came back during the fade: the same sound comes back up, not a new one
        this.clearStop();
        this.ramp(this.target(), config.fadeInMs);
      } else {
        this.ramp(this.target(), VOLUME_RAMP_MS);
      }
    } catch (error) {
      console.warn('Engine sound unavailable:', error);
    }
  }

  private start(config: EngineBedConfig): void {
    const context = this.ensureContext();
    if (!context) return;
    if (this.loop?.url !== config.url) {
      this.load(config.url);
      return;
    }
    // Always, as the suspend after the last fade may still be on its way. Still locked, this stays silent and the fade
    // waits with the audio clock until armUnlock's press
    context.resume().catch(() => undefined);
    const gain = context.createGain();
    const source = context.createBufferSource();
    source.buffer = this.loop.buffer;
    source.loop = true;
    source.connect(gain as never);
    gain.connect(context.destination as never);
    gain.gain.value = 0;
    this.bed = { source, gain, url: config.url };
    this.ramp(this.target(), config.fadeInMs);
    source.start();
  }

  private ramp(value: number, ms: number): void {
    if (!this.bed || !this.context) return;
    const { gain } = this.bed.gain;
    const now = this.context.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    if (ms > 0) gain.linearRampToValueAtTime(value, now + ms / 1000);
    else gain.setValueAtTime(value, now);
  }

  private fadeOut(ms: number): void {
    if (!this.bed) return;
    this.clearStop();
    try {
      this.ramp(0, ms);
    } catch {
      // stopped below all the same
    }
    this.fading = true;
    this.stopTimer = setTimeout(() => {
      this.stopBed();
      if (this.holds.size === 0 && this.context?.state === 'running') this.context.suspend().catch(() => undefined);
    }, ms + STOP_MARGIN_MS);
  }

  private stopBed(): void {
    this.clearStop();
    const bed = this.bed;
    this.bed = null;
    if (!bed) return;
    try {
      bed.source.stop();
    } catch {
      // never got to start
    }
    bed.source.disconnect();
    bed.gain.disconnect();
  }

  // Fetches, decodes and prepares a sound once; speech that started meanwhile gets it as soon as it's there
  private load(url: string): void {
    const context = this.ensureContext();
    if (!context || this.loop?.url === url || this.loading === url) return;
    if (this.failed?.url === url && Date.now() - this.failed.at < LOAD_RETRY_MS) return;
    this.loading = url;
    const current = () => this.context === context && this.config?.url === url;
    this.options
      .fetchAudio(url)
      .then((data) => context.decodeAudioData(data))
      .then((decoded) => {
        if (!current()) return;
        const channels = Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c));
        const samples = seamlessLoop(channels, decoded.sampleRate);
        if (!samples) throw new Error('the sound is silent');
        const buffer = context.createBuffer(samples.length, samples[0].length, decoded.sampleRate);
        samples.forEach((channel, c) => buffer.getChannelData(c).set(channel));
        this.loop = { url, buffer };
        this.failed = null;
        if (this.holds.size > 0) this.update();
      })
      .catch((error) => {
        console.warn(`Engine sound ${url} failed to load; speech carries on without it:`, error);
        if (current()) this.failed = { url, at: Date.now() };
      })
      .finally(() => {
        if (this.loading === url) this.loading = null;
      });
  }
}

type SpeechElement = Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & { readonly ended: boolean };

const END_EVENTS = ['pause', 'ended', 'error', 'emptied'];

// Holds the bed while an audio element's speech is really playing, from its playing event (not play(), which starts
// before the sound does) to its end. continuing: whether another line of engine-backed speech is on its way. Returns the
// function that detaches it, once the line is done with, whichever way it ended.
export function linkSpeech(bed: EngineBed, audio: SpeechElement, continuing: () => boolean = () => false): () => void {
  let hold: EngineHold | null = null;
  // A natural end fires pause before ended, so ended is what tells it from an interruption
  const end = () => {
    hold?.release(audio.ended ? 'finished' : 'interrupted', continuing());
    hold = null;
  };
  const playing = () => {
    hold ??= bed.acquire();
  };
  audio.addEventListener('playing', playing);
  END_EVENTS.forEach((event) => audio.addEventListener(event, end));
  return () => {
    end();
    audio.removeEventListener('playing', playing);
    END_EVENTS.forEach((event) => audio.removeEventListener(event, end));
  };
}

// The page's one bed: speech from anywhere on the page shares it
export const engineBed = new EngineBed({
  createContext: () => {
    if (typeof window === 'undefined') return null;
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    return Context ? (new Context() as unknown as EngineAudioContext) : null;
  },
  fetchAudio: async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.arrayBuffer();
  },
});
