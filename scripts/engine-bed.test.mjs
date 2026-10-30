// The engine sound under ElevenLabs speech (src/lib/engineBed.ts), with a fake Web Audio that records what's asked of it:
// that it starts with the speech and not before, loops, fades as promised, is one sound however many speak, survives
// a failed load, and leaves nothing behind. Tested against real audio in e2e/engine-bed.spec.ts. npm run test:engine-bed

import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONTINUE_GRACE_MS, EngineBed, INTERRUPT_FADE_MS, linkSpeech, LOAD_RETRY_MS, seamlessLoop } from '../src/lib/engineBed.ts';
import { BUILT_IN_ENGINE_AUDIO_URL, engineAudioUrl, engineBedConfig, sniffEngineAudio } from '../src/lib/engineBedConfig.ts';
import { broadcastSettingsPatch, DEFAULT_BROADCAST_SETTINGS, MAX_ENGINE_FADE_MS, parseBroadcastSettings } from '../src/lib/broadcastSettings.ts';
import { CommentaryQueue } from '../src/lib/tvAudio.ts';

const CONFIG = { enabled: true, volume: 0.15, fadeInMs: 150, fadeOutMs: 300, url: '/engine.mp3' };

// Noise-like samples that never fall silent, as an engine recording
const noisy = (frames, seed = 1) => Float32Array.from({ length: frames }, (_, i) => 0.3 * Math.sin(i * 0.05 * seed) + 0.2 * Math.sin(i * 0.31 + seed));

class FakeParam {
  value = 0;
  events = [];
  cancelScheduledValues(at) {
    this.events.push(['cancel', at]);
  }
  setValueAtTime(value, at) {
    this.events.push(['set', value, at]);
  }
  linearRampToValueAtTime(value, at) {
    this.events.push(['ramp', value, at]);
    // What a real param holds once the ramp is over, good enough for these tests
    this.value = value;
  }
  // The last ramp: [value, seconds from when it was set]
  lastRamp() {
    const at = this.events.findLastIndex((e) => e[0] === 'ramp');
    return at < 0 ? null : [this.events[at][1], this.events[at][2]];
  }
}

class FakeContext {
  state = 'suspended';
  currentTime = 10;
  destination = { name: 'destination' };
  sources = [];
  gains = [];
  decoded = 0;
  closed = false;
  createGain() {
    const gain = { gain: new FakeParam(), connected: [], disconnected: false, connect: (d) => gain.connected.push(d), disconnect: () => (gain.disconnected = true) };
    this.gains.push(gain);
    return gain;
  }
  createBufferSource() {
    const source = {
      buffer: null,
      loop: false,
      started: 0,
      stopped: 0,
      disconnected: false,
      connect: () => undefined,
      disconnect: () => (source.disconnected = true),
      start: () => source.started++,
      stop: () => source.stopped++,
    };
    this.sources.push(source);
    return source;
  }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, getChannelData: (c) => data[c] };
  }
  async decodeAudioData() {
    this.decoded++;
    const data = [noisy(44_100), noisy(44_100, 2)];
    return { numberOfChannels: 2, length: 44_100, sampleRate: 44_100, getChannelData: (c) => data[c] };
  }
  async resume() {
    this.state = 'running';
  }
  async suspend() {
    this.state = 'suspended';
  }
  async close() {
    this.closed = true;
    this.state = 'closed';
  }
  get playing() {
    return this.sources.filter((s) => s.started > 0 && s.stopped === 0);
  }
}

// An audio element as far as linkSpeech goes, firing events in the order browsers do
class FakeAudio extends EventTarget {
  ended = false;
  start() {
    this.dispatchEvent(new Event('playing'));
  }
  // The spec's order at the end of playback: pause first, then ended
  finish() {
    this.ended = true;
    this.dispatchEvent(new Event('pause'));
    this.dispatchEvent(new Event('ended'));
  }
  interrupt() {
    this.dispatchEvent(new Event('pause'));
  }
  get listening() {
    return true;
  }
}

function setup(config = CONFIG) {
  const context = new FakeContext();
  const fetches = [];
  const failing = new Set();
  const bed = new EngineBed({
    createContext: () => context,
    fetchAudio: async (url) => {
      fetches.push(url);
      if (failing.has(url)) throw new Error('404');
      return new ArrayBuffer(8);
    },
  });
  bed.configure(config);
  return { bed, context, fetches, failing };
}

// Lets the fetch and decode promises finish
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
};

async function ready(config) {
  const made = setup(config);
  made.bed.unlock();
  await settle();
  return made;
}

describe('the engine bed', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout'] });
    mock.method(console, 'warn', () => undefined);
  });
  afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
  });

  test('plays nothing and loads nothing until the page has something to play it for', async () => {
    const { context, fetches } = setup();
    await settle();
    assert.equal(fetches.length, 0);
    assert.equal(context.sources.length, 0);
  });

  test('starts when the speech is really playing, not when it was asked to', async () => {
    const { bed, context } = await ready();
    const audio = new FakeAudio();
    linkSpeech(bed, audio);
    assert.equal(context.sources.length, 0, 'linked, not yet playing');
    audio.start();
    assert.equal(context.playing.length, 1);
  });

  test('loops, fading in to the volume set, independent of the voice', async () => {
    const { bed, context } = await ready();
    const hold = bed.acquire();
    const [source] = context.sources;
    const [gain] = context.gains;
    assert.equal(source.loop, true);
    assert.deepEqual(gain.gain.lastRamp(), [0.15, 10.15]);
    assert.ok(source.buffer.length > 0);
    hold.release('finished');
  });

  test('keeps looping however long the speech goes on: nothing restarts or stops it', async () => {
    const { bed, context } = await ready();
    const hold = bed.acquire();
    mock.timers.tick(10 * 60_000);
    assert.equal(context.sources.length, 1);
    assert.equal(context.playing.length, 1);
    hold.release('finished');
  });

  test('fades out over 300 ms when speech finishes, then stops, disconnects and suspends', async () => {
    const { bed, context } = await ready();
    const audio = new FakeAudio();
    linkSpeech(bed, audio);
    audio.start();
    context.currentTime = 12;
    audio.finish();
    const [source] = context.sources;
    const [gain] = context.gains;
    assert.deepEqual(gain.gain.lastRamp(), [0, 12.3]);
    assert.equal(source.stopped, 0, 'still fading');
    mock.timers.tick(330);
    assert.equal(source.stopped, 1);
    assert.equal(source.disconnected, true);
    assert.equal(gain.disconnected, true);
    await settle();
    assert.equal(context.state, 'suspended');
  });

  test('a natural end is not taken for an interruption, though pause fires first', async () => {
    const { bed, context } = await ready();
    const audio = new FakeAudio();
    linkSpeech(bed, audio);
    audio.start();
    audio.finish();
    assert.deepEqual(context.gains[0].gain.lastRamp(), [0, 10.3]);
  });

  test('stops with a short fade when speech is interrupted', async () => {
    const { bed, context } = await ready();
    const audio = new FakeAudio();
    linkSpeech(bed, audio);
    audio.start();
    audio.interrupt();
    assert.deepEqual(context.gains[0].gain.lastRamp(), [0, 10 + INTERRUPT_FADE_MS / 1000]);
    mock.timers.tick(INTERRUPT_FADE_MS + 30);
    assert.equal(context.sources[0].stopped, 1);
  });

  test('detaching a line that never finished counts as an interruption, and removes its listeners', async () => {
    const { bed, context } = await ready();
    const audio = new FakeAudio();
    const unlink = linkSpeech(bed, audio);
    audio.start();
    unlink();
    assert.deepEqual(context.gains[0].gain.lastRamp(), [0, 10 + INTERRUPT_FADE_MS / 1000]);
    mock.timers.tick(200);
    audio.start();
    assert.equal(context.sources.length, 1, 'playing again does nothing once detached');
  });

  test('carries on between consecutive lines, without restarting', async () => {
    const { bed, context } = await ready();
    const first = new FakeAudio();
    linkSpeech(bed, first, () => true);
    first.start();
    first.finish();
    mock.timers.tick(CONTINUE_GRACE_MS - 1);
    const second = new FakeAudio();
    linkSpeech(bed, second);
    second.start();
    assert.equal(context.sources.length, 1, 'one sound through both lines');
    assert.equal(context.sources[0].stopped, 0);
    assert.notEqual(context.gains[0].gain.lastRamp()?.[0], 0, 'never faded');
    second.finish();
    mock.timers.tick(330);
    assert.equal(context.sources[0].stopped, 1);
  });

  test('fades out when the line it waited for never comes', async () => {
    const { bed, context } = await ready();
    const audio = new FakeAudio();
    linkSpeech(bed, audio, () => true);
    audio.start();
    audio.finish();
    mock.timers.tick(CONTINUE_GRACE_MS);
    assert.equal(context.gains[0].gain.lastRamp()[0], 0);
    mock.timers.tick(330);
    assert.equal(context.playing.length, 0);
  });

  test('stops waiting at once when the queue is emptied', async () => {
    const { bed, context } = await ready();
    const audio = new FakeAudio();
    linkSpeech(bed, audio, () => true);
    audio.start();
    audio.finish();
    bed.silence();
    mock.timers.tick(INTERRUPT_FADE_MS + 30);
    assert.equal(context.playing.length, 0);
  });

  test('speech during the fade brings the same sound back rather than starting another', async () => {
    const { bed, context } = await ready();
    bed.acquire().release('finished');
    mock.timers.tick(100);
    const hold = bed.acquire();
    assert.equal(context.sources.length, 1);
    assert.equal(context.gains[0].gain.lastRamp()[0], 0.15);
    mock.timers.tick(5000);
    assert.equal(context.sources[0].stopped, 0, 'the old stop was cancelled');
    hold.release('finished');
  });

  test('overlapping speech shares one sound until the last of it ends', async () => {
    const { bed, context } = await ready();
    const announcer = bed.acquire();
    const radio = bed.acquire();
    assert.equal(context.sources.length, 1, 'no duplicate');
    announcer.release('finished');
    mock.timers.tick(5000);
    assert.equal(context.playing.length, 1, 'radio still speaking');
    radio.release('finished');
    mock.timers.tick(330);
    assert.equal(context.playing.length, 0);
  });

  test('releasing twice counts once', async () => {
    const { bed, context } = await ready();
    const one = bed.acquire();
    const two = bed.acquire();
    one.release('finished');
    one.release('finished');
    mock.timers.tick(5000);
    assert.equal(context.playing.length, 1);
    two.release('finished');
  });

  test('the same element firing playing again, after buffering, takes one hold', async () => {
    const { bed, context } = await ready();
    const audio = new FakeAudio();
    linkSpeech(bed, audio);
    audio.start();
    audio.start();
    audio.finish();
    mock.timers.tick(330);
    assert.equal(context.playing.length, 0, 'not left holding');
  });

  test('a sound still loading comes in when ready, if speech is still going', async () => {
    const { bed, context } = setup();
    const hold = bed.acquire();
    assert.equal(context.sources.length, 0);
    await settle();
    assert.equal(context.playing.length, 1);
    hold.release('finished');
  });

  test('a sound that loads after the speech ended stays silent', async () => {
    const { bed, context } = setup();
    bed.acquire().release('finished');
    await settle();
    assert.equal(context.sources.length, 0);
  });

  test('the sound is loaded once', async () => {
    const { bed, context, fetches } = await ready();
    for (let i = 0; i < 3; i++) {
      bed.acquire().release('interrupted');
      mock.timers.tick(200);
    }
    assert.equal(fetches.length, 1);
    assert.equal(context.decoded, 1);
  });

  test('speech carries on when the sound fails to load, which is tried again later', async () => {
    const { bed, context, fetches, failing } = setup();
    failing.add(CONFIG.url);
    const audio = new FakeAudio();
    linkSpeech(bed, audio);
    audio.start();
    await settle();
    assert.equal(context.sources.length, 0);
    assert.equal(fetches.length, 1);
    audio.finish();
    bed.acquire().release('finished');
    await settle();
    assert.equal(fetches.length, 1, 'not hammering a missing file');
    const realNow = Date.now;
    Date.now = () => realNow() + LOAD_RETRY_MS + 1;
    try {
      failing.delete(CONFIG.url);
      const hold = bed.acquire();
      await settle();
      assert.equal(fetches.length, 2);
      assert.equal(context.playing.length, 1);
      hold.release('finished');
    } finally {
      Date.now = realNow;
    }
  });

  test('without Web Audio, nothing happens and nothing throws', () => {
    const bed = new EngineBed({ createContext: () => null, fetchAudio: async () => new ArrayBuffer(0) });
    bed.configure(CONFIG);
    bed.unlock();
    const audio = new FakeAudio();
    linkSpeech(bed, audio);
    audio.start();
    audio.finish();
    bed.shutdown();
  });

  test('a broken audio graph never reaches the speech', async () => {
    const { bed, context } = await ready();
    context.createGain = () => {
      throw new Error('out of resources');
    };
    const audio = new FakeAudio();
    linkSpeech(bed, audio);
    assert.doesNotThrow(() => audio.start());
    assert.doesNotThrow(() => audio.finish());
  });

  test('turned off, it plays nothing, and turning it off mid-line fades it', async () => {
    const off = await ready({ ...CONFIG, enabled: false });
    off.bed.acquire();
    await settle();
    assert.equal(off.context.sources.length, 0);
    assert.equal(off.fetches.length, 0);

    const { bed, context } = await ready();
    bed.acquire();
    bed.configure({ ...CONFIG, enabled: false });
    mock.timers.tick(330);
    assert.equal(context.playing.length, 0);
  });

  test('volume, and the TV\'s own level, follow while playing', async () => {
    const { bed, context } = await ready();
    const hold = bed.acquire();
    bed.configure({ ...CONFIG, volume: 0.5 });
    assert.equal(context.gains[0].gain.lastRamp()[0], 0.5);
    bed.setLevel(0.5);
    assert.equal(context.gains[0].gain.lastRamp()[0], 0.25);
    bed.setLevel(0);
    assert.equal(context.gains[0].gain.lastRamp()[0], 0);
    assert.equal(context.playing.length, 1, 'muted, not stopped');
    hold.release('finished');
  });

  test('picking another sound while playing swaps it, once it has loaded', async () => {
    const { bed, context, fetches } = await ready();
    const hold = bed.acquire();
    bed.configure({ ...CONFIG, url: '/other.wav' });
    await settle();
    assert.deepEqual(fetches, ['/engine.mp3', '/other.wav']);
    assert.equal(context.sources[0].stopped, 1);
    assert.equal(context.playing.length, 1);
    hold.release('finished');
  });

  test('the first click or key press anywhere unlocks it, once, and removes its listeners', async () => {
    const { bed, context, fetches } = setup();
    const page = new EventTarget();
    bed.armUnlock(page);
    assert.equal(context.state, 'suspended');
    page.dispatchEvent(new Event('keydown'));
    await settle();
    assert.equal(context.state, 'running');
    assert.equal(fetches.length, 1, 'and that is when it loads');
    context.state = 'suspended';
    page.dispatchEvent(new Event('pointerdown'));
    assert.equal(context.state, 'suspended', 'listeners gone');
  });

  test('speech that started before the first click just stays silent until it', async () => {
    const { bed, context } = setup();
    context.resume = async () => undefined; // the browser hasn't allowed it yet
    const hold = bed.acquire();
    await settle();
    assert.equal(context.state, 'suspended');
    assert.equal(context.playing.length, 1, 'waiting on the audio clock');
    hold.release('finished');
  });

  test('shutdown frees everything, and holds left over do nothing', async () => {
    const { bed, context } = await ready();
    const page = new EventTarget();
    bed.armUnlock(page);
    const hold = bed.acquire();
    bed.shutdown();
    assert.equal(context.sources[0].stopped, 1);
    assert.equal(context.sources[0].disconnected, true);
    assert.equal(context.gains[0].disconnected, true);
    assert.equal(context.closed, true);
    assert.doesNotThrow(() => hold.release('finished'));
    mock.timers.tick(5000);
    page.dispatchEvent(new Event('pointerdown'));
    assert.equal(context.state, 'closed', 'unlock listener gone');
  });

  test('a sound that finishes loading after shutdown is dropped', async () => {
    const { bed, context } = setup();
    bed.acquire();
    bed.shutdown();
    await settle();
    assert.equal(context.sources.length, 0);
  });

  test('a silent file is treated as a failed load', async () => {
    const { bed, context } = setup();
    context.decodeAudioData = async () => ({ numberOfChannels: 1, length: 100, sampleRate: 44_100, getChannelData: () => new Float32Array(100) });
    const hold = bed.acquire();
    await settle();
    assert.equal(context.sources.length, 0);
    hold.release('finished');
  });
});

describe('the loop point', () => {
  const stepsOf = (samples) => samples.slice(1).map((s, i) => Math.abs(s - samples[i]));

  test('has no jump where the end meets the start', () => {
    // Deliberately not a whole number of cycles, so playing it end to start would click
    const raw = Float32Array.from({ length: 44_100 }, (_, i) => 0.5 * Math.sin(i * 0.0713));
    assert.ok(Math.abs(raw[raw.length - 1] - raw[0]) > 0.1, 'the raw loop would click');
    const [loop] = seamlessLoop([raw], 44_100);
    const biggest = Math.max(...stepsOf(Array.from(loop)));
    assert.ok(Math.abs(loop[loop.length - 1] - loop[0]) <= biggest * 1.5);
  });

  test('cuts the silence an MP3 encoder leaves at each end', () => {
    const raw = new Float32Array(88_200);
    raw.set(noisy(80_000), 2000);
    const [loop] = seamlessLoop([raw], 44_100);
    assert.equal(loop.length, 80_000 - Math.round(44_100 * 0.4));
    assert.ok(Math.abs(loop[0]) > 0 || Math.abs(loop[1]) > 0);
  });

  test('keeps the channels the same length, and very short sounds work', () => {
    const [a, b] = seamlessLoop([noisy(9000), noisy(9000, 3)], 44_100);
    assert.equal(a.length, b.length);
    assert.equal(a.length, 6000);
    assert.equal(seamlessLoop([Float32Array.of(0.5)], 44_100)[0].length, 1);
  });

  test('all silence, or nothing at all, gives nothing', () => {
    assert.equal(seamlessLoop([new Float32Array(1000)], 44_100), null);
    assert.equal(seamlessLoop([], 44_100), null);
  });
});

describe('what a page is told', () => {
  test('the defaults are on, at 15%, fading out over 300 ms, the built-in sound', () => {
    assert.deepEqual(engineBedConfig(DEFAULT_BROADCAST_SETTINGS), { enabled: true, volume: 0.15, fadeInMs: 150, fadeOutMs: 300, url: BUILT_IN_ENGINE_AUDIO_URL });
  });

  test('the master volume scales the engine, the announcers\' own volumes do not', () => {
    const settings = { ...DEFAULT_BROADCAST_SETTINGS, masterVolume: 50, leadVolume: 0, colorVolume: 0, engineVolume: 40 };
    assert.equal(engineBedConfig(settings).volume, 0.2);
  });

  test('an uploaded sound has its own address; a deleted one falls back', () => {
    const settings = { ...DEFAULT_BROADCAST_SETTINGS, engineAsset: 7 };
    assert.equal(engineBedConfig(settings).url, '/api/engine-audio/7');
    assert.equal(engineBedConfig(settings, null).url, BUILT_IN_ENGINE_AUDIO_URL);
    assert.equal(engineAudioUrl(null), BUILT_IN_ENGINE_AUDIO_URL);
  });

  test('the preferences are checked', () => {
    assert.deepEqual(broadcastSettingsPatch({ engineVolume: 150 }), { engineVolume: 100 });
    assert.deepEqual(broadcastSettingsPatch({ engineFadeOutMs: 99_999 }), { engineFadeOutMs: MAX_ENGINE_FADE_MS });
    assert.deepEqual(broadcastSettingsPatch({ engineFadeInMs: -5 }), { engineFadeInMs: 0 });
    assert.deepEqual(broadcastSettingsPatch({ engineAsset: null }), { engineAsset: null });
    assert.deepEqual(broadcastSettingsPatch({ engineAsset: 3 }), { engineAsset: 3 });
    for (const bad of [{ engineAsset: 'x' }, { engineAsset: -1 }, { engineAsset: 1.5 }, { engineEnabled: 'yes' }, { engineVolume: 'loud' }, { engineFadeOutMs: 'slow' }]) {
      assert.equal(broadcastSettingsPatch(bad), null, JSON.stringify(bad));
    }
  });

  test('accounts saved before these preferences get the defaults, and keep what they had', () => {
    const parsed = parseBroadcastSettings({ mode: 'quiet', leadVolume: 40 });
    assert.equal(parsed.mode, 'quiet');
    assert.equal(parsed.leadVolume, 40);
    assert.equal(parsed.engineEnabled, true);
    assert.equal(parsed.engineVolume, 15);
    assert.equal(parsed.engineAsset, null);
  });

  test('uploads are recognized by their bytes, not their name', () => {
    assert.equal(sniffEngineAudio(new Uint8Array(readFileSync('public/assets/sounds/GT3EngineNoise.mp3'))), 'audio/mpeg');
    assert.equal(sniffEngineAudio(new TextEncoder().encode('RIFF\0\0\0\0WAVEfmt ')), 'audio/wav');
    assert.equal(sniffEngineAudio(Uint8Array.of(0xff, 0xfb, 0x90, 0x00)), 'audio/mpeg');
    for (const bad of ['<html><script>', 'RIFF\0\0\0\0AVI ', '', 'ID']) {
      assert.equal(sniffEngineAudio(new TextEncoder().encode(bad)), null, bad);
    }
    assert.equal(sniffEngineAudio(Uint8Array.of(0xff, 0xe0, 0, 0)), null, 'reserved layer');
  });
});

describe('the queue says what comes next', () => {
  test('peek shows the next line without taking it', () => {
    const queue = new CommentaryQueue();
    assert.equal(queue.peek(), null);
    queue.push([{ speaker: 'lead', text: 'One', audio: 'a', elevenLabs: true }], 0);
    assert.equal(queue.peek().elevenLabs, true);
    assert.equal(queue.size, 1);
    assert.equal(queue.next(0).text, 'One');
    assert.equal(queue.peek(), null);
  });
});
