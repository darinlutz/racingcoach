// The Broadcast Director's rules (docs/broadcast-director.md): clip selection, the whole sequence through time, what the
// race and the Admin page's controls do to it, what viewers are told, and recovery. No database, storage or browser;
// e2e/broadcast-director.spec.ts runs the real thing. npm run test:video-director

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hasVideoExtension, isVideoCategory, VIDEO_CATEGORIES } from '../src/lib/broadcastVideoCategories.ts';
import {
  AUDIO_LEAD_MS,
  clipCueSeconds,
  clipLengthSeconds,
  clipSelected,
  clipValidated,
  commentaryHeld,
  DEFAULT_DIRECTOR_SETTINGS,
  directorTick,
  endSession,
  expectedVideoTime,
  INTRO_WAIT_MS,
  isNewerSnapshot,
  linesPrepared,
  mp3DurationMs,
  newDirector,
  nextClipDueAt,
  nextClockOffset,
  parseDirectorSettings,
  playbackCorrection,
  PRELOAD_MS,
  RECOVERY_MS,
  requestClip,
  restoreDirector,
  returnToLive,
  selectVideo,
  skipNext,
  sourceAt,
  videoFailed,
} from '../src/lib/videoDirector.ts';
import { raceConditions } from '../src/lib/videoDirectorConditions.ts';

const video = (id, category = 'ONBOARDS', extra = {}) => ({
  id,
  title: `Clip ${id}`,
  description: '',
  category,
  trackKey: null,
  track: null,
  car: null,
  durationSeconds: 30,
  clipStartSeconds: 0,
  clipEndSeconds: null,
  audioEnabled: false,
  priority: 0,
  selectionWeight: 1,
  cameraPerspective: '',
  sessionInfo: '',
  commentaryContext: '',
  ...extra,
});
const settings = { ...DEFAULT_DIRECTOR_SETTINGS, rotationEnabled: false };
const context = (extra = {}) => ({ settings, trackKey: 'monza full', cars: [], recentVideoIds: [], recentCategories: [], ...extra });
const CALM = { level: 1, blocked: false, critical: false };
const line = (when, speaker, durationMs, id = `${when}-${speaker}`) => ({ id, when, speaker, durationMs });

// Runs ticks until the phase is reached, returning the time then and every effect along the way
function runUntil(state, phase, from, { race = CALM, busy = 0, config = settings, limit = 400_000 } = {}) {
  const effects = [];
  let now = from;
  while (state.phase !== phase && now - from < limit) {
    now += 100;
    effects.push(...directorTick(state, { now, settings: config, race, announcersBusyUntil: busy }));
  }
  assert.equal(state.phase, phase, `reached ${phase}`);
  return { now, effects };
}

// A session with a clip reserved and its file checked, up to the point its lines are prepared
function selectedAndValid(state, v, now, config = settings) {
  directorTick(state, { now, settings: config, race: CALM, announcersBusyUntil: 0 });
  clipSelected(state, v, 'auto', config, now);
  clipValidated(state, true, now);
}

describe('categories', () => {
  test('the eight categories, as stable identifiers', () => {
    assert.deepEqual([...VIDEO_CATEGORIES], ['RACE_START', 'CRASHES', 'ONBOARDS', 'HELICOPTER', 'BLIMP', 'TVCAMERA1', 'TVCAMERA2', 'TVCAMERA3']);
    assert.ok(isVideoCategory('BLIMP'));
    assert.ok(!isVideoCategory('Blimp'));
  });

  test('every category has a clip the Director can pick', () => {
    for (const category of VIDEO_CATEGORIES) {
      assert.equal(selectVideo([video(1, category)], { category }, context())?.category, category);
    }
  });

  test('upload names are checked by extension', () => {
    assert.ok(hasVideoExtension('Start at Monza.MP4'));
    assert.ok(!hasVideoExtension('notes.txt'));
    assert.ok(!hasVideoExtension('mp4'));
  });
});

describe('selecting a clip', () => {
  test('an empty category gives nothing, so nothing is announced', () => {
    assert.equal(selectVideo([video(1, 'BLIMP')], { category: 'ONBOARDS' }, context()), null);
    const state = newDirector('s', 0);
    assert.deepEqual(clipSelected(state, null, 'auto', settings, 1000), []);
    assert.equal(state.phase, 'LIVE');
    assert.equal(state.clip, null);
  });

  test('the same clip isn’t repeated while there are alternatives', () => {
    const pool = [video(1), video(2)];
    for (let r = 0; r < 20; r++) {
      assert.equal(selectVideo(pool, {}, context({ recentVideoIds: [1] }), () => r / 20)?.id, 2);
    }
  });

  test('with one clip it may repeat; with all recently played, not the very latest', () => {
    assert.equal(selectVideo([video(1)], {}, context({ recentVideoIds: [1] }))?.id, 1);
    for (let r = 0; r < 20; r++) {
      assert.notEqual(selectVideo([video(1), video(2)], {}, context({ recentVideoIds: [1, 2] }), () => r / 20)?.id, 2);
    }
  });

  test('the same category isn’t repeated while there are alternatives', () => {
    const pool = [video(1, 'ONBOARDS'), video(2, 'BLIMP')];
    assert.equal(selectVideo(pool, {}, context({ recentCategories: ['ONBOARDS'] }))?.category, 'BLIMP');
    assert.equal(selectVideo([video(1, 'ONBOARDS')], {}, context({ recentCategories: ['ONBOARDS'] }))?.category, 'ONBOARDS');
  });

  test('weights decide how often a clip comes up', () => {
    const pool = [video(1, 'ONBOARDS', { selectionWeight: 1 }), video(2, 'ONBOARDS', { selectionWeight: 3 })];
    let two = 0;
    for (let i = 0; i < 1000; i++) if (selectVideo(pool, {}, context(), () => i / 1000).id === 2) two++;
    assert.ok(Math.abs(two - 750) <= 2, String(two));
  });

  test('turned off categories and zero weights are left out, unless asked for by name', () => {
    const off = parseDirectorSettings({ categoryEnabled: { BLIMP: false }, categoryWeights: { HELICOPTER: 0 } });
    const pool = [video(1, 'BLIMP'), video(2, 'HELICOPTER')];
    assert.equal(selectVideo(pool, {}, context({ settings: off })), null);
    assert.equal(selectVideo(pool, { category: 'BLIMP' }, context({ settings: off }))?.id, 1);
    assert.equal(selectVideo(pool, { videoId: 2 }, context({ settings: off }))?.id, 2);
  });

  test('a clip tied to a track only plays at that track, and is favoured there', () => {
    const here = video(1, 'BLIMP', { trackKey: 'monza full' });
    const there = video(2, 'BLIMP', { trackKey: 'spa up' });
    const any = video(3, 'BLIMP');
    assert.equal(selectVideo([there], {}, context()), null);
    assert.equal(selectVideo([there, any], {}, context(), () => 0)?.id, 3);
    let local = 0;
    for (let i = 0; i < 400; i++) if (selectVideo([here, any], {}, context(), () => i / 400).id === 1) local++;
    assert.ok(local > 250, String(local));
  });

  test('clip length: its own end, else the default, never past the file', () => {
    assert.equal(clipLengthSeconds(video(1), settings), 8);
    assert.equal(clipLengthSeconds(video(1, 'ONBOARDS', { clipStartSeconds: 5, clipEndSeconds: 11 }), settings), 6);
    assert.equal(clipLengthSeconds(video(1, 'ONBOARDS', { durationSeconds: 5 }), settings), 5);
    assert.equal(clipLengthSeconds(video(1, 'ONBOARDS', { durationSeconds: 5, clipStartSeconds: 5 }), settings), 0);
  });
});

describe('the sequence', () => {
  // The onboard clip of the acceptance scenario
  function throughIntro(extraLines = []) {
    const state = newDirector('race', 0);
    let now = 200_000;
    const effects = directorTick(state, { now, settings, race: CALM, announcersBusyUntil: 0 });
    assert.deepEqual(effects[0], { type: 'select', request: {}, trigger: 'auto' });
    const selected = clipSelected(state, video(7), 'auto', settings, now);
    assert.equal(state.phase, 'CLIP_SELECTED');
    assert.ok(selected.some((e) => e.type === 'validate' && e.videoId === 7));
    const validated = clipValidated(state, true, now);
    assert.equal(state.phase, 'CLIP_PRELOADING');
    assert.ok(validated.some((e) => e.type === 'prepare'));
    linesPrepared(state, [line('intro', 'lead', 3000), ...extraLines]);
    return { state, now };
  }

  test('introduction, then the clip, then back to the map, all timed from the audio', () => {
    const { state, now: start } = throughIntro([line('during', 'color', 3000), line('after', 'lead', 1500)]);
    // Viewers get time to buffer the clip first
    let { now } = runUntil(state, 'INTRO_PENDING', start);
    assert.ok(now - start >= PRELOAD_MS);
    assert.equal(commentaryHeld(state, now), true, 'normal commentary is held from here');

    ({ now } = runUntil(state, 'INTRO_PLAYING', now));
    const intro = state.lines.find((l) => l.when === 'intro');
    assert.equal(intro.at, now + AUDIO_LEAD_MS, 'announced before it starts');
    assert.equal(state.transitionAt, intro.at + 3000 + 250, 'the cut comes after the introduction ends');
    assert.equal(sourceAt(state, state.transitionAt - 1), 'LIVE_TRACK_MAP', 'still the map while the introduction plays');

    const during = state.lines.find((l) => l.when === 'during');
    assert.ok(during.at >= state.transitionAt, 'the Color Announcer waits for the clip');
    assert.ok(during.at + during.durationMs <= state.returnAt, 'and finishes before it ends');

    const expectedReturn = state.transitionAt + 8000;
    assert.equal(state.returnAt, expectedReturn, 'the clip plays for eight seconds');
    const after = state.lines.find((l) => l.when === 'after');
    assert.ok(after.at >= state.liveAt, 'the Lead comes back once the map has');

    ({ now } = runUntil(state, 'TRANSITION_TO_VIDEO', now));
    assert.equal(sourceAt(state, now), 'RECORDED_VIDEO');
    ({ now } = runUntil(state, 'VIDEO_PLAYING', now));
    ({ now } = runUntil(state, 'TRANSITION_TO_LIVE', now));
    assert.equal(sourceAt(state, now), 'LIVE_TRACK_MAP');

    const end = runUntil(state, 'LIVE', now);
    assert.ok(end.effects.some((e) => e.type === 'finished' && e.status === 'completed'));
    assert.equal(state.clip, null);
    assert.equal(state.lastClipEndedAt, end.now);
    assert.equal(commentaryHeld(state, end.now), true, 'held until the Lead has handed back');
    const released = end.now + 3000;
    directorTick(state, { now: released, settings, race: CALM, announcersBusyUntil: 0 });
    assert.equal(commentaryHeld(state, released), false, 'normal commentary resumes');
    assert.deepEqual(state.lines, []);
  });

  test('a line too long for the clip is left out, never run past it', () => {
    const { state, now: start } = throughIntro([line('during', 'color', 7900)]);
    runUntil(state, 'INTRO_PLAYING', start);
    assert.equal(state.lines.filter((l) => l.when === 'during').length, 0);
  });

  test('the cut waits for commentary already playing', () => {
    const { state, now: start } = throughIntro();
    const pending = runUntil(state, 'INTRO_PENDING', start);
    const busy = pending.now + 6000;
    const { now } = runUntil(state, 'INTRO_PLAYING', pending.now, { busy });
    assert.ok(now >= busy, 'the introduction starts after it');
  });

  test('commentary that never stops gives the clip up rather than getting stuck', () => {
    const { state, now: start } = throughIntro();
    const pending = runUntil(state, 'INTRO_PENDING', start);
    const { now, effects } = runUntil(state, 'RECOVERY', pending.now, { busy: pending.now + 10 * INTRO_WAIT_MS });
    assert.ok(effects.some((e) => e.type === 'finished' && e.status === 'failed' && e.reason === 'announcersBusy'));
    assert.ok(now - pending.now <= INTRO_WAIT_MS + 200);
    assert.equal(state.clip, null);
    assert.equal(runUntil(state, 'LIVE', now).now - now <= RECOVERY_MS + 100, true);
  });

  test('a missing file never reaches the announcers', () => {
    const state = newDirector('race', 0);
    directorTick(state, { now: 200_000, settings, race: CALM, announcersBusyUntil: 0 });
    clipSelected(state, video(7), 'auto', settings, 200_000);
    const effects = clipValidated(state, false, 200_000);
    assert.equal(state.phase, 'RECOVERY');
    assert.ok(effects.some((e) => e.type === 'finished' && e.reason === 'missingFile'));
    assert.ok(!effects.some((e) => e.type === 'prepare'));
  });

  test('a file check that never answers is given up on', () => {
    const state = newDirector('race', 0);
    directorTick(state, { now: 200_000, settings, race: CALM, announcersBusyUntil: 0 });
    clipSelected(state, video(7), 'auto', settings, 200_000);
    runUntil(state, 'RECOVERY', 200_000);
  });

  test('announcer failure: no introduction means no clip when one is required', () => {
    const state = newDirector('race', 0);
    selectedAndValid(state, video(7), 200_000);
    linesPrepared(state, null);
    const { effects } = runUntil(state, 'RECOVERY', 200_000);
    assert.ok(effects.some((e) => e.type === 'finished' && e.reason === 'introUnavailable'));
  });

  test('announcer failure: without the requirement the clip goes ahead silently', () => {
    const config = parseDirectorSettings({ requireIntroduction: false });
    const state = newDirector('race', 0);
    selectedAndValid(state, video(7), 200_000, config);
    linesPrepared(state, null);
    runUntil(state, 'INTRO_PLAYING', 200_000, { config });
    assert.deepEqual(state.lines, []);
    assert.ok(state.transitionAt > 200_000);
    runUntil(state, 'LIVE', 200_000, { config });
  });

  test('lines that take forever to prepare are given up on', () => {
    const state = newDirector('race', 0);
    selectedAndValid(state, video(7), 200_000);
    const { effects } = runUntil(state, 'RECOVERY', 200_000);
    assert.ok(effects.some((e) => e.reason === 'introTimeout'));
  });

  test('every viewer’s player failing while it buffers drops the clip unannounced', () => {
    const { state, now: start } = throughIntro();
    const effects = videoFailed(state, start);
    assert.ok(effects.some((e) => e.type === 'finished' && e.status === 'failed' && e.reason === 'playbackFailed'));
    assert.equal(state.phase, 'RECOVERY');
    assert.deepEqual(state.lines, []);
    assert.equal(commentaryHeld(state, start), false);
  });

  test('every viewer’s player failing ends the clip early', () => {
    const { state, now: start } = throughIntro();
    const { now } = runUntil(state, 'VIDEO_PLAYING', start);
    const effects = videoFailed(state, now);
    assert.ok(effects.some((e) => e.type === 'finished' && e.reason === 'playbackFailed'));
    assert.equal(state.phase, 'RECOVERY');
    assert.equal(sourceAt(state, now), 'LIVE_TRACK_MAP');
    runUntil(state, 'LIVE', now);
  });

  test('a failed clip waits a full interval before the next try, so it can’t loop', () => {
    const state = newDirector('race', 0);
    selectedAndValid(state, video(7), 200_000);
    linesPrepared(state, null);
    const { now } = runUntil(state, 'LIVE', 200_000);
    assert.equal(directorTick(state, { now: now + 1000, settings, race: CALM, announcersBusyUntil: 0 }).length, 0);
    assert.ok(nextClipDueAt(state, settings, 1) >= now + 100_000);
  });

  test('every step moves the sequence number on, and persists', () => {
    const { state, now: start } = throughIntro();
    let last = state.seq;
    let now = start;
    const seen = new Set([state.eventId]);
    while (state.phase !== 'LIVE') {
      now += 100;
      const effects = directorTick(state, { now, settings, race: CALM, announcersBusyUntil: 0 });
      if (state.seq !== last) {
        assert.ok(state.seq > last);
        assert.ok(effects.some((e) => e.type === 'persist'));
        assert.ok(!seen.has(state.eventId));
        seen.add(state.eventId);
        last = state.seq;
      }
    }
  });
});

describe('automatic scheduling', () => {
  const tick = (state, now, race = CALM, config = settings) => directorTick(state, { now, settings: config, race, announcersBusyUntil: 0 });

  test('nothing before the minimum interval, and quiet races get a clip at it', () => {
    const state = newDirector('race', 1000);
    assert.deepEqual(tick(state, 1000 + 119_000), []);
    assert.equal(tick(state, 1000 + 120_000)[0].type, 'select');
  });

  test('livelier races wait longer, up to the maximum', () => {
    const state = { lastClipEndedAt: 0, createdAt: 0 };
    assert.equal(nextClipDueAt(state, settings, 1), 120_000);
    assert.equal(nextClipDueAt(state, settings, 2), 180_000);
    assert.equal(nextClipDueAt(state, settings, 3), 240_000);
  });

  test('the maximum is no deadline: important action keeps the map on', () => {
    const state = newDirector('race', 0);
    assert.deepEqual(tick(state, 900_000, { level: 2, blocked: true, critical: false }), []);
    assert.deepEqual(tick(state, 900_000, { level: 4, blocked: false, critical: false }), []);
    assert.equal(tick(state, 900_000, { level: 3, blocked: false, critical: false })[0].type, 'select');
  });

  test('no overlap: no second clip while one is under way', () => {
    const state = newDirector('race', 0);
    assert.equal(tick(state, 200_000)[0].type, 'select');
    assert.deepEqual(tick(state, 200_100), [], 'still choosing');
    clipSelected(state, video(1), 'auto', settings, 200_100);
    assert.equal(requestClip(state, { category: 'BLIMP' }), false);
  });

  test('the switches stop it, and manual mode only plays what’s asked for', () => {
    const off = parseDirectorSettings({ videosEnabled: false });
    assert.deepEqual(tick(newDirector('race', 0), 900_000, CALM, off), []);
    const manual = parseDirectorSettings({ autoDirector: false });
    const state = newDirector('race', 0);
    assert.deepEqual(tick(state, 900_000, CALM, manual), []);
    assert.equal(requestClip(state, { category: 'BLIMP' }), true);
    assert.deepEqual(tick(state, 900_100, CALM, manual)[0], { type: 'select', request: { category: 'BLIMP' }, trigger: 'manual' });
  });

  test('settings are checked and kept in range', () => {
    const parsed = parseDirectorSettings({ minIntervalSeconds: 300, maxIntervalSeconds: 100, transitionMs: 99_999, defaultClipSeconds: 'x' });
    assert.equal(parsed.minIntervalSeconds, 300);
    assert.equal(parsed.maxIntervalSeconds, 300, 'the maximum is never under the minimum');
    assert.equal(parsed.transitionMs, 3000);
    assert.equal(parsed.defaultClipSeconds, settings.defaultClipSeconds);
  });
});

describe('the rotation', () => {
  const config = DEFAULT_DIRECTOR_SETTINGS;
  const RACING = { level: 1, blocked: false, critical: false, rotating: true };
  const tick = (state, now, race = RACING, busy = 0) => directorTick(state, { now, settings: config, race, announcersBusyUntil: busy });
  // Ticks to the moment the Director asks for a clip, answers it and its file check, and returns that time
  function pick(state, from, v = video(7, 'ONBOARDS', { durationSeconds: 300 })) {
    let now = from;
    while (!tick(state, (now += 250)).some((e) => e.type === 'select')) assert.ok(now - from < 120_000, 'a clip was asked for');
    clipSelected(state, v, 'auto', config, now);
    const effects = clipValidated(state, true, now);
    assert.ok(!effects.some((e) => e.type === 'prepare'), 'no lines are written');
    return now;
  }
  const until = (state, phase, from, race = RACING) => {
    let now = from;
    while (state.phase !== phase) {
      now += 250;
      tick(state, now, race);
      assert.ok(now - from < 120_000, `reached ${phase}`);
    }
    return now;
  };

  test('is on by default, 30 seconds each', () => {
    assert.equal(config.rotationEnabled, true);
    assert.equal(config.rotationMapSeconds, 30);
    assert.equal(config.rotationVideoSeconds, 30);
    const kept = parseDirectorSettings({ rotationMapSeconds: 1, rotationVideoSeconds: 999 });
    assert.equal(kept.rotationMapSeconds, 10);
    assert.equal(kept.rotationVideoSeconds, 60);
  });

  test('30 seconds of map, then 30 seconds of footage, over and over', () => {
    const state = newDirector('race', 0);
    let mapFrom = 0;
    for (let round = 0; round < 4; round++) {
      const picked = pick(state, mapFrom);
      assert.ok(state.clip, 'a clip is reserved ahead of its cut');
      assert.equal(sourceAt(state, picked), 'LIVE_TRACK_MAP');
      until(state, 'INTRO_PLAYING', picked);
      assert.ok(Math.abs(state.transitionAt - mapFrom - 30_000) <= 500, `map ${state.transitionAt - mapFrom} ms`);
      assert.equal(state.returnAt - state.transitionAt, 30_000);
      assert.deepEqual(state.lines, []);
      mapFrom = state.returnAt;
      until(state, 'LIVE', picked);
    }
  });

  test('never waits for the announcers, and never holds their commentary', () => {
    const state = newDirector('race', 0);
    let now = pick(state, 0);
    while (state.phase !== 'VIDEO_PLAYING') {
      now += 250;
      tick(state, now, RACING, now + 60_000);
      assert.equal(commentaryHeld(state, now), false);
      assert.ok(now < 120_000);
    }
  });

  test('lively moments don’t stop it, a P0 cuts back, and the map then gets its full turn', () => {
    const state = newDirector('race', 0);
    const busy = { level: 4, blocked: true, critical: false, rotating: true };
    let now = 0;
    while (!tick(state, (now += 250), busy).some((e) => e.type === 'select')) assert.ok(now < 60_000);
    clipSelected(state, video(7), 'auto', config, now);
    clipValidated(state, true, now);
    now = until(state, 'VIDEO_PLAYING', now, busy);
    tick(state, (now += 250), { ...busy, critical: true });
    assert.equal(state.phase, 'TRANSITION_TO_LIVE');
    now = until(state, 'LIVE', now);
    const next = pick(state, now);
    until(state, 'INTRO_PLAYING', next);
    assert.ok(state.transitionAt - now >= 29_000, 'a full turn of the map');
  });

  test('outside the rotation’s part of the race, the normal schedule and sequence apply', () => {
    const state = newDirector('race', 0);
    assert.deepEqual(tick(state, 60_000, CALM), [], 'not due yet');
    assert.equal(tick(state, 120_000, CALM)[0].type, 'select');
    clipSelected(state, video(7), 'auto', config, 120_000);
    assert.equal(state.clip.loop, undefined);
    assert.ok(clipValidated(state, true, 120_000).some((e) => e.type === 'prepare'));
  });

  test('turned off, a race gets the normal schedule', () => {
    const off = { ...config, rotationEnabled: false };
    const state = newDirector('race', 0);
    assert.deepEqual(directorTick(state, { now: 60_000, settings: off, race: RACING, announcersBusyUntil: 0 }), []);
  });

  test('a short file repeats for the whole turn; a long one carries on where it got to', () => {
    const short = newDirector('race', 0);
    pick(short, 0, video(1, 'ONBOARDS', { durationSeconds: 8 }));
    assert.equal(short.clip.durationMs, 30_000);
    const snapshot = { clip: short.clip, playbackStartAt: 1000, returnAt: 31_000 };
    assert.equal(expectedVideoTime(snapshot, 1000 + 7000), 7);
    assert.equal(expectedVideoTime(snapshot, 1000 + 9000), 1);
    assert.equal(expectedVideoTime(snapshot, 31_000), null);

    const long = newDirector('race', 0);
    const v = video(2, 'ONBOARDS', { durationSeconds: 70, clipStartSeconds: 5 });
    const offsets = [];
    let from = 0;
    for (let round = 0; round < 3; round++) {
      const picked = pick(long, from, v);
      offsets.push(long.clip.loop.offsetSeconds);
      assert.equal(clipCueSeconds(long.clip), 5 + long.clip.loop.offsetSeconds);
      from = until(long, 'LIVE', picked);
    }
    assert.deepEqual(offsets, [0, 30, 60], 'wraps round the 65 seconds after the clip’s start next time');
  });

  test('a saved state from before the rotation still restores', () => {
    const state = newDirector('race', 0);
    delete state.rotationCutAt;
    delete state.rotationPlayed;
    const { state: restored } = restoreDirector(state, 1000);
    assert.equal(commentaryHeld(restored, 1000), false);
    pick(restored, 1000);
    assert.equal(restored.clip.loop.offsetSeconds, 0);
  });
});

describe('race intensity', () => {
  const ctx = (phase = 'middle') => ({ isRace: true, phase, raceProgress: 0.5, userIdx: 1, userPosition: 5, storylines: [] });
  const event = (at, e, seq = 1) => ({ seq, at, event: e });
  const NOW = 1_000_000;

  test('a quiet race is level 1 and open for clips', () => {
    assert.deepEqual(raceConditions([], ctx(), NOW, null), { level: 1, blocked: false, critical: false, rotating: true });
  });

  test('the rotation runs from after the race’s opening until its final laps, not after a P0 moment', () => {
    for (const phase of ['middle', 'finalQuarter']) assert.equal(raceConditions([], ctx(phase), NOW, null).rotating, true, phase);
    for (const phase of ['practice', 'preRace', 'opening', 'finalLaps', 'finished']) assert.equal(raceConditions([], ctx(phase), NOW, null).rotating, false, phase);
    assert.equal(raceConditions([], { ...ctx(), isRace: false }, NOW, null).rotating, false, 'not a race');
    const red = event(NOW - 2000, { type: 'flag', flag: 'red', text: 'Red flag' });
    assert.equal(raceConditions([red], ctx(), NOW, null).rotating, false);
  });

  test('routine laps don’t count as action', () => {
    const lap = event(NOW - 1000, { type: 'lapComplete', lap: 4, lapTime: 90, bestLapTime: 89, newBest: false });
    assert.equal(raceConditions([lap], ctx(), NOW, null).blocked, false);
  });

  test('a lead change just now blocks clips, and stops mattering once it’s old', () => {
    const lead = (at) => event(at, { type: 'leaderChange', leader: 'A Driver', previous: 'B Driver' });
    assert.equal(raceConditions([lead(NOW - 2000)], ctx(), NOW, null).blocked, true);
    assert.ok(raceConditions([lead(NOW - 2000)], ctx(), NOW, null).level >= 4);
    assert.equal(raceConditions([lead(NOW - 40_000)], ctx(), NOW, null).blocked, false);
  });

  test('the race’s opening, final laps and finish are left to the map', () => {
    for (const phase of ['opening', 'finalLaps', 'finished']) assert.equal(raceConditions([], ctx(phase), NOW, null).blocked, true, phase);
    for (const phase of ['practice', 'preRace', 'middle', 'finalQuarter']) assert.equal(raceConditions([], ctx(phase), NOW, null).blocked, false, phase);
  });

  test('only a P0 moment since the sequence started is critical', () => {
    const red = event(NOW - 1000, { type: 'flag', flag: 'red', notes: [] });
    assert.equal(raceConditions([red], ctx(), NOW, null).critical, false, 'no sequence');
    assert.equal(raceConditions([red], ctx(), NOW, NOW - 5000).critical, true);
    assert.equal(raceConditions([red], ctx(), NOW, NOW - 500).critical, false, 'from before it');
    const pass = event(NOW - 1000, { type: 'positionGained', from: 5, to: 4, passed: null });
    assert.equal(raceConditions([pass], ctx(), NOW, NOW - 5000).critical, false, 'P1 waits');
  });

  const CRITICAL = { level: 4, blocked: true, critical: true };

  test('a P0 moment cancels a clip not yet on screen', () => {
    const state = newDirector('race', 0);
    selectedAndValid(state, video(7), 200_000);
    linesPrepared(state, [line('intro', 'lead', 3000)]);
    const pending = runUntil(state, 'INTRO_PENDING', 200_000);
    const effects = directorTick(state, { now: pending.now + 100, settings, race: CRITICAL, announcersBusyUntil: 0 });
    assert.equal(state.phase, 'RECOVERY');
    assert.ok(effects.some((e) => e.status === 'cancelled' && e.reason === 'liveAction'));
  });

  test('a P0 moment cuts straight back from a clip on screen', () => {
    const state = newDirector('race', 0);
    selectedAndValid(state, video(7), 200_000);
    linesPrepared(state, [line('intro', 'lead', 3000), line('during', 'color', 2000), line('after', 'lead', 1000)]);
    const { now } = runUntil(state, 'VIDEO_PLAYING', 200_000);
    directorTick(state, { now: now + 100, settings, race: CRITICAL, announcersBusyUntil: 0 });
    assert.equal(state.phase, 'TRANSITION_TO_LIVE');
    assert.equal(state.returnAt, now + 100);
    assert.ok(state.lines.every((l) => l.when === 'intro'), 'nothing is left to talk over the moment');
    assert.equal(commentaryHeld({ phase: 'LIVE', holdUntil: state.holdUntil }, now + 100), false);
    const end = runUntil(state, 'LIVE', now + 100);
    assert.ok(end.effects.some((e) => e.type === 'finished' && e.status === 'cutShort'));
  });
});

describe('the Admin page’s controls', () => {
  test('PLAY VIDEO NOW goes through the normal sequence, whatever the race or interval', () => {
    const state = newDirector('race', 0);
    assert.equal(requestClip(state, { videoId: 9 }), true);
    const [effect] = directorTick(state, { now: 1000, settings, race: { level: 4, blocked: true, critical: false }, announcersBusyUntil: 0 });
    assert.deepEqual(effect, { type: 'select', request: { videoId: 9 }, trigger: 'manual' });
  });

  test('RETURN TO LIVE before the cut cancels; during the clip, cuts out', () => {
    const pending = newDirector('race', 0);
    selectedAndValid(pending, video(7), 200_000);
    const effects = returnToLive(pending, 200_100);
    assert.ok(effects.some((e) => e.status === 'cancelled' && e.reason === 'returnToLive'));
    assert.equal(pending.clip, null);

    const playing = newDirector('race', 0);
    selectedAndValid(playing, video(7), 200_000);
    linesPrepared(playing, [line('intro', 'lead', 1000)]);
    const { now } = runUntil(playing, 'VIDEO_PLAYING', 200_000);
    returnToLive(playing, now);
    assert.equal(playing.phase, 'TRANSITION_TO_LIVE');
    assert.equal(sourceAt(playing, now), 'LIVE_TRACK_MAP');
  });

  test('SKIP NEXT VIDEO drops the pending clip and picks another straight after', () => {
    const state = newDirector('race', 0);
    selectedAndValid(state, video(7), 200_000);
    assert.ok(skipNext(state, 200_100).some((e) => e.reason === 'skipped'));
    assert.deepEqual(state.recentVideoIds, [7], 'so it isn’t picked again');
    const { now } = runUntil(state, 'LIVE', 200_100);
    assert.equal(directorTick(state, { now: now + 100, settings, race: { level: 4, blocked: true, critical: false }, announcersBusyUntil: 0 })[0].type, 'select');
  });

  test('there’s nothing to skip once the clip is on screen', () => {
    const state = newDirector('race', 0);
    assert.deepEqual(skipNext(state, 1000), []);
    selectedAndValid(state, video(7), 200_000);
    linesPrepared(state, [line('intro', 'lead', 1000)]);
    const { now } = runUntil(state, 'VIDEO_PLAYING', 200_000);
    assert.deepEqual(skipNext(state, now), []);
  });
});

describe('what viewers are told', () => {
  const snapshot = (extra = {}) => ({
    clip: { videoId: 1, category: 'ONBOARDS', title: 't', clipStartSeconds: 4, durationMs: 8000, audio: false, url: '/x' },
    playbackStartAt: 10_000,
    returnAt: 18_000,
    ...extra,
  });

  test('two viewers with different clocks and delays work out the same place in the clip', () => {
    const serverNow = 13_000;
    const tvClockAhead = 5000;
    const tvClockBehind = -3000;
    const offsetA = nextClockOffset(nextClockOffset(null, 12_900, 12_950 + tvClockAhead), 12_990, 13_000 + tvClockAhead);
    const offsetB = nextClockOffset(nextClockOffset(null, 12_700, 12_950 + tvClockBehind), 12_995, 13_000 + tvClockBehind);
    const a = expectedVideoTime(snapshot(), serverNow + tvClockAhead + offsetA);
    const b = expectedVideoTime(snapshot(), serverNow + tvClockBehind + offsetB);
    assert.ok(Math.abs(a - b) < 0.05, `${a} vs ${b}`);
    assert.ok(Math.abs(a - 7) < 0.05, 'three seconds into a clip starting at 4 s');
  });

  test('a clock offset settles on the least delayed message', () => {
    assert.equal(nextClockOffset(null, 1000, 1500), -500);
    assert.equal(nextClockOffset(-500, 2000, 2100), -100);
    assert.equal(nextClockOffset(-100, 3000, 3900), -100);
  });

  test('a viewer joining mid clip starts at the shared position; outside it, nothing plays', () => {
    assert.equal(expectedVideoTime(snapshot(), 9_999), null);
    assert.equal(expectedVideoTime(snapshot(), 10_000), 4);
    assert.equal(expectedVideoTime(snapshot(), 16_000), 10);
    assert.equal(expectedVideoTime(snapshot(), 18_000), null);
    assert.equal(expectedVideoTime(snapshot({ clip: null }), 12_000), null);
  });

  test('a player that drifts is nudged, then moved', () => {
    assert.deepEqual(playbackCorrection(5, 5.1), { seekTo: null, rate: 1 });
    assert.deepEqual(playbackCorrection(5, 5.4), { seekTo: null, rate: 1.05 });
    assert.deepEqual(playbackCorrection(5.4, 5), { seekTo: null, rate: 0.95 });
    assert.deepEqual(playbackCorrection(5, 7), { seekTo: 7, rate: 1 });
  });

  test('duplicate and out-of-order snapshots are ignored; a new session’s always counts', () => {
    const current = { sessionKey: 'a', seq: 5 };
    assert.equal(isNewerSnapshot(null, current), true);
    assert.equal(isNewerSnapshot(current, { sessionKey: 'a', seq: 5 }), false);
    assert.equal(isNewerSnapshot(current, { sessionKey: 'a', seq: 4 }), false);
    assert.equal(isNewerSnapshot(current, { sessionKey: 'a', seq: 6 }), true);
    assert.equal(isNewerSnapshot(current, { sessionKey: 'b', seq: 1 }), true);
  });
});

describe('recovery', () => {
  test('a restart mid clip carries on the same schedule, under a new number', () => {
    const state = newDirector('race', 0);
    selectedAndValid(state, video(7), 200_000);
    linesPrepared(state, [line('intro', 'lead', 1000), line('after', 'lead', 1000)]);
    const { now } = runUntil(state, 'VIDEO_PLAYING', 200_000);
    const saved = JSON.parse(JSON.stringify(state));
    const { state: restored, lost } = restoreDirector(saved, now + 1000);
    assert.equal(lost, false);
    assert.equal(restored.phase, 'VIDEO_PLAYING');
    assert.equal(restored.returnAt, state.returnAt);
    assert.equal(restored.clip.videoId, 7);
    assert.ok(restored.seq > state.seq);
    assert.deepEqual(restored.lines, [], 'its audio went with the old server');
    const end = runUntil(restored, 'LIVE', now + 1000);
    assert.ok(end.effects.some((e) => e.status === 'completed'));
  });

  test('a restart before the cut drops the clip and waits before trying another', () => {
    const state = newDirector('race', 0);
    selectedAndValid(state, video(7), 200_000);
    const { state: restored, lost } = restoreDirector(JSON.parse(JSON.stringify(state)), 200_500);
    assert.equal(lost, true);
    assert.equal(restored.phase, 'LIVE');
    assert.equal(restored.clip, null);
    assert.equal(commentaryHeld(restored, 200_500), false);
    assert.deepEqual(directorTick(restored, { now: 201_000, settings, race: CALM, announcersBusyUntil: 0 }), []);
  });

  test('a restart long after a clip should have ended just goes back to live', () => {
    const state = newDirector('race', 0);
    selectedAndValid(state, video(7), 200_000);
    linesPrepared(state, [line('intro', 'lead', 1000)]);
    runUntil(state, 'VIDEO_PLAYING', 200_000);
    const { state: restored } = restoreDirector(JSON.parse(JSON.stringify(state)), 900_000);
    assert.equal(restored.phase, 'LIVE');
    assert.equal(restored.clip, null);
  });

  test('a session ending closes the clip and releases commentary', () => {
    const state = newDirector('race', 0);
    selectedAndValid(state, video(7), 200_000);
    const effects = endSession(state, 200_100);
    assert.ok(effects.some((e) => e.reason === 'sessionEnded'));
    assert.equal(commentaryHeld(state, 200_100), false);
  });
});

describe('mp3 length', () => {
  // A 128 kbps 44.1 kHz MPEG-1 Layer III frame: 417 or 418 bytes, 26.12 ms
  const frame = () => {
    const bytes = new Uint8Array(417);
    bytes.set([0xff, 0xfb, 0x90, 0x00]);
    return bytes;
  };
  const join = (parts) => {
    const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };

  test('adds up the frames, past an ID3 tag', () => {
    const frames = Array.from({ length: 100 }, frame);
    assert.equal(mp3DurationMs(join(frames)), 2612);
    const id3 = new Uint8Array(30);
    id3.set([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 20]);
    assert.equal(mp3DurationMs(join([id3, ...frames])), 2612);
  });

  test('anything else has no length', () => {
    assert.equal(mp3DurationMs(new Uint8Array(1000)), null);
    assert.equal(mp3DurationMs(new TextEncoder().encode('{"error":"quota"}')), null);
  });
});

describe('guards', () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

  test('video bytes never go in the database or on the server’s disk for keeps', () => {
    const schema = read('src/lib/broadcastVideoDb.ts');
    assert.ok(!/BYTEA/i.test(schema));
    assert.ok(/storage_key/.test(schema));
  });

  test('every admin route answers 404 to anyone else', () => {
    for (const path of ['videos/route.ts', 'videos/[id]/route.ts', 'videos/[id]/complete/route.ts', 'director/route.ts']) {
      const source = read(`src/app/api/admin/broadcast/${path}`);
      const handlers = source.match(/export async function (GET|POST|PUT|PATCH|DELETE)/g);
      const checks = source.match(/isAdmin\(user\.role\)/g);
      assert.equal(checks.length, handlers.length, path);
    }
  });

  test('the live map stays mounted under a clip', () => {
    const source = read('src/components/TvBroadcast.tsx');
    assert.ok(/<BroadcastVideoSwitcher[\s\S]*<TvMap[\s\S]*<\/BroadcastVideoSwitcher>/.test(source));
  });

  test('the Director’s selection only happens on the server', () => {
    for (const path of ['src/components/BroadcastVideoSwitcher.tsx', 'src/components/useTvCommentary.ts', 'src/components/TvBroadcast.tsx']) {
      assert.ok(!/selectVideo|Math\.random/.test(read(path)), path);
    }
  });
});

describe('the tracker’s phase, which keeps clips off the start and finish', () => {
  test('joining a timed race after the leader’s last lap isn’t the final laps', async () => {
    const { BroadcastTracker } = await import('../src/lib/broadcastTracker.ts');
    const tracker = new BroadcastTracker();
    const car = (idx, position) => ({ idx, position, classPosition: position, pct: 0.5 - idx / 10, rate: 0.011, lap: 5, lapsDone: 4, name: `Driver ${idx}`, number: String(idx), car: 'Porsche 911 GT3 R', carClass: 'GT3', onPitRoad: false, offTrack: false, lastLapTime: null, bestLapTime: null });
    tracker.update({ at: 1000, sessionType: 'Race', sessionState: 4, timeRemain: 1500, lapsTotal: null, myCarIdx: 1, cars: [car(0, 1), car(1, 2)] });
    assert.equal(tracker.phase(), 'middle');
  });
});
