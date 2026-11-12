// Live video from OBS (docs/live-video.md): the Broadcast Source Manager's rules, the synchronization timeline, the
// Cloudflare Stream helpers, commentary held for the delayed timeline, the camera moments, and source guards on the
// routes and components (authorization, no secrets to browsers, the player kept mounted). No Cloudflare account,
// OBS or simulator needed. npm run test:live-video

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPublicKey, createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import {
  cameraAt,
  DEFAULT_LIVE_VIDEO_SETTINGS,
  desiredSource,
  effectiveSource,
  followAutoSetting,
  isNewerSource,
  newSourceState,
  parseLiveVideoSettings,
  restoreSourceState,
  rotationCamera,
  rotationObsShare,
  selectAutomatic,
  selectManual,
  sourceSnapshot,
  sourceTick,
} from '../src/lib/liveVideo/broadcastSource.ts';
import { clipGapSeconds } from '../src/lib/liveVideo/rotationLink.ts';
import {
  commentaryNotBefore,
  commentaryWait,
  effectiveDelay,
  interpolatePct,
  rateBetween,
  holdDelay,
  medianOf,
  newDelayHold,
  DELAY_GLIDE_RATE,
  syncErrorMs,
  TimelineBuffer,
} from '../src/lib/liveVideo/broadcastTimeline.ts';
import {
  base64Url,
  combineStatus,
  deliveryCostUsd,
  isLiveInputId,
  playbackUrls,
  signingInput,
  statusFromLifecycle,
  statusFromLiveInput,
  tokenClaims,
} from '../src/lib/liveVideo/streamRules.ts';
import { currentMoment, momentKind } from '../src/lib/liveVideo/sourceMoments.ts';
import { CommentaryQueue } from '../src/lib/tvAudio.ts';

const root = new URL('../', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');

// The moment rules on their own (the rotation has its own tests)
const on = (changes = {}) => parseLiveVideoSettings({ ...DEFAULT_LIVE_VIDEO_SETTINGS, enabled: true, rotation: { ...DEFAULT_LIVE_VIDEO_SETTINGS.rotation, enabled: false }, ...changes });
const T0 = 1_800_000_000_000;
const tickAt = (state, now, extra = {}) => sourceTick(state, { now, settings: on(), streamLive: true, moment: null, subjectCars: null, ...extra });

describe('settings', () => {
  test('off by default: the feature flag', () => {
    assert.equal(DEFAULT_LIVE_VIDEO_SETTINGS.enabled, false);
    assert.equal(parseLiveVideoSettings(null).enabled, false);
  });
  test('out of range values are clamped and unknown ones keep their value', () => {
    const s = parseLiveVideoSettings({ minShotSeconds: -5, cooldownSeconds: 999, transition: 'wipe', preferences: { finish: 'TRACK_MAP', bogus: 'OBS_LIVE' }, sync: { maxBufferMs: 1e9, manualOffsetMs: 1e9 } });
    assert.equal(s.minShotSeconds, 2);
    assert.ok(s.cooldownSeconds <= s.minShotSeconds, 'the cooldown never exceeds the minimum shot');
    assert.equal(s.transition, DEFAULT_LIVE_VIDEO_SETTINGS.transition);
    assert.equal(s.preferences.finish, 'TRACK_MAP');
    assert.equal(s.preferences.raceStart, 'OBS_LIVE');
    assert.equal(s.sync.maxBufferMs, 90_000);
    assert.equal(s.sync.manualOffsetMs, 90_000);
  });
});

describe('camera rotation', () => {
  const rot = (changes = {}) => parseLiveVideoSettings({ ...DEFAULT_LIVE_VIDEO_SETTINGS, enabled: true, cameraSubject: 'streamDriver', switchLeadMs: 0, ...changes });
  test('on by default, 30 s of OBS then 30 s of the map', () => {
    const s = parseLiveVideoSettings(null);
    assert.equal(s.rotation.enabled, true);
    assert.equal(s.rotation.obsSeconds, 30);
    assert.equal(s.rotation.mapSeconds, 30);
    assert.equal(rotationObsShare(s.rotation, 0), 0.5);
    const clamped = parseLiveVideoSettings({ rotation: { obsSeconds: 1, mapSeconds: 1e6 } });
    assert.equal(clamped.rotation.obsSeconds, 10);
    assert.equal(clamped.rotation.mapSeconds, 300);
  });
  test('OBS, then the map, from the anchor; OBS while a clip still covers it', () => {
    const r = { obsSeconds: 60, mapSeconds: 20 };
    assert.equal(rotationCamera(r, T0, T0 - 1000), 'OBS_LIVE');
    assert.equal(rotationCamera(r, T0, T0), 'OBS_LIVE');
    assert.equal(rotationCamera(r, T0, T0 + 59_999), 'OBS_LIVE');
    assert.equal(rotationCamera(r, T0, T0 + 60_000), 'TRACK_MAP');
    assert.equal(rotationCamera(r, T0, T0 + 79_999), 'TRACK_MAP');
    assert.equal(rotationCamera(r, T0, T0 + 80_000), 'OBS_LIVE', 'no clip came: round again');
  });
  test('the camera follows the cycle, switching on its boundaries', () => {
    const settings = rot({ rotation: { enabled: true, obsSeconds: 60, mapSeconds: 20 } });
    const state = newSourceState('s', T0);
    const tick = (now, extra = {}) => sourceTick(state, { now, settings, streamLive: true, moment: null, subjectCars: [5], rotationAnchor: T0, ...extra });
    tick(T0);
    assert.equal(state.source, 'OBS_LIVE');
    assert.equal(state.reason, 'rotationObs');
    tick(T0 + 59_000);
    assert.equal(state.source, 'OBS_LIVE');
    tick(T0 + 60_000);
    assert.equal(state.source, 'TRACK_MAP');
    assert.equal(state.reason, 'rotationMap');
    // a clip is scheduled to hand back later: OBS goes under it, ready for its fade back
    tick(T0 + 90_000, { rotationAnchor: T0 + 110_000 });
    assert.equal(state.source, 'OBS_LIVE');
  });
  test('the switch is worked out for when it lands', () => {
    const settings = rot({ rotation: { enabled: true, obsSeconds: 60, mapSeconds: 20 }, switchLeadMs: 1200 });
    const state = newSourceState('s', T0);
    sourceTick(state, { now: T0, settings, streamLive: true, moment: null, subjectCars: null, rotationAnchor: T0 });
    assert.equal(state.source, 'OBS_LIVE');
    sourceTick(state, { now: T0 + 58_900, settings, streamLive: true, moment: null, subjectCars: null, rotationAnchor: T0 });
    assert.equal(state.source, 'TRACK_MAP');
    assert.equal(state.switchAt, T0 + 60_100);
  });
  test('only a big moment interrupts it: toward OBS for the camera’s car, toward the map only when critical', () => {
    const settings = rot({ rotation: { enabled: true, obsSeconds: 60, mapSeconds: 20 } });
    const inMapTurn = newSourceState('s', T0);
    const ownPass = { kind: 'overtake', at: T0 + 65_000, priority: 1, cars: [5] };
    assert.equal(desiredSource(inMapTurn, { now: T0 + 65_000, settings, streamLive: true, moment: ownPass, subjectCars: [5], rotationAnchor: T0 }).source, 'OBS_LIVE');
    const othersBattle = { kind: 'closeBattle', at: T0 + 10_000, priority: 1, cars: [8, 9] };
    assert.equal(desiredSource(inMapTurn, { now: T0 + 10_000, settings, streamLive: true, moment: othersBattle, subjectCars: [5], rotationAnchor: T0 }).source, 'OBS_LIVE', 'a P1 elsewhere doesn’t take OBS away');
    const crash = { kind: 'incident', at: T0 + 10_000, priority: 0, cars: [8] };
    assert.equal(desiredSource(inMapTurn, { now: T0 + 10_000, settings, streamLive: true, moment: crash, subjectCars: [5], rotationAnchor: T0 }).source, 'TRACK_MAP');
    const routine = { kind: 'pitStop', at: T0 + 10_000, priority: 3, cars: [5] };
    assert.equal(desiredSource(inMapTurn, { now: T0 + 10_000, settings, streamLive: true, moment: routine, subjectCars: [5], rotationAnchor: T0 }).reason, 'rotationObs');
  });
  test('OBS offline: the map, whatever the rotation says', () => {
    const settings = rot();
    const state = newSourceState('s', T0);
    sourceTick(state, { now: T0, settings, streamLive: false, moment: null, subjectCars: null, rotationAnchor: T0 });
    assert.equal(state.source, 'TRACK_MAP');
    assert.equal(state.reason, 'obsOffline');
  });
  test('turning Automatic off holds the camera, and back on hands it back to the rotation', () => {
    const settings = rot({ rotation: { enabled: true, obsSeconds: 30, mapSeconds: 30 } });
    const state = newSourceState('s', T0);
    state.autoSetting = true;
    const tick = (now) => sourceTick(state, { now, settings, streamLive: true, moment: null, subjectCars: null, rotationAnchor: T0 });
    tick(T0 + 31_000);
    assert.equal(state.source, 'TRACK_MAP');
    assert.equal(followAutoSetting(state, false, T0 + 32_000), true);
    assert.equal(state.mode, 'manual');
    tick(T0 + 61_000);
    assert.equal(state.source, 'TRACK_MAP', 'held');
    assert.equal(followAutoSetting(state, true, T0 + 62_000), true);
    assert.equal(state.mode, 'auto');
    tick(T0 + 62_500);
    assert.equal(state.source, 'OBS_LIVE', 'the rotation again');
  });
  test("a session's own buttons win until the setting changes again", () => {
    const state = newSourceState('s', T0);
    state.autoSetting = false;
    selectAutomatic(state, T0);
    assert.equal(followAutoSetting(state, false, T0 + 1000), false);
    assert.equal(state.mode, 'auto');
    state.autoSetting = true;
    selectManual(state, 'OBS_LIVE', T0 + 2000);
    followAutoSetting(state, false, T0 + 3000);
    followAutoSetting(state, true, T0 + 4000);
    assert.equal(state.mode, 'manual', "an Admin's own choice isn't undone by the setting");
    assert.equal(state.manualSource, 'OBS_LIVE');
  });
  test('a state saved before the setting was remembered, held manual, goes back to automatic', () => {
    const saved = newSourceState('s', T0);
    selectManual(saved, 'TRACK_MAP', T0);
    delete saved.autoSetting;
    assert.equal(followAutoSetting(saved, true, T0 + 1000), true);
    assert.equal(saved.mode, 'auto');
  });
  test("clips come after whole OBS + map cycles, at least the Director's own gap apart", () => {
    const camera = { obsSeconds: 30, mapSeconds: 30 };
    assert.equal(clipGapSeconds(30, camera), 60);
    assert.equal(clipGapSeconds(60, camera), 60);
    assert.equal(clipGapSeconds(61, camera), 120);
    assert.equal(clipGapSeconds(180, camera), 180);
  });
});

describe('camera source', () => {
  test('starts on the map, as OBS has not been seen live', () => {
    const state = newSourceState('s', T0);
    tickAt(state, T0, { streamLive: false, moment: { kind: 'raceStart', at: T0, priority: 0, cars: [] } });
    assert.equal(state.source, 'TRACK_MAP');
    assert.equal(state.reason, 'obsOffline');
    assert.equal(state.fallback, true);
  });

  test('a race start goes to OBS, a pit stop stays on the map', () => {
    const state = newSourceState('s', T0);
    tickAt(state, T0, { moment: { kind: 'raceStart', at: T0, priority: 0, cars: [] } });
    assert.equal(state.source, 'OBS_LIVE');
    assert.equal(state.reason, 'raceStart');
    const pit = desiredSource(state, { now: T0 + 60_000, settings: on(), streamLive: true, moment: { kind: 'pitStop', at: T0 + 59_000, priority: 2, cars: [3] }, subjectCars: [3] });
    assert.equal(pit.source, 'TRACK_MAP');
  });

  test('the OBS camera is never assumed to show the cars in a battle', () => {
    const state = newSourceState('s', T0);
    const battle = { kind: 'closeBattle', at: T0, priority: 1, cars: [4, 5] };
    assert.deepEqual(desiredSource(state, { now: T0, settings: on(), streamLive: true, moment: battle, subjectCars: null }).source, 'TRACK_MAP');
    assert.equal(desiredSource(state, { now: T0, settings: on(), streamLive: true, moment: battle, subjectCars: null }).reason, 'cameraSubjectUnknown');
    assert.equal(desiredSource(state, { now: T0, settings: on(), streamLive: true, moment: battle, subjectCars: [9] }).reason, 'cameraNotOnAction');
    assert.equal(desiredSource(state, { now: T0, settings: on(), streamLive: true, moment: battle, subjectCars: [5] }).source, 'OBS_LIVE');
  });

  test('a shot is held for the minimum shot; a critical moment only waits for the cooldown', () => {
    const settings = on({ minShotSeconds: 10, cooldownSeconds: 4 });
    const state = newSourceState('s', T0);
    sourceTick(state, { now: T0, settings, streamLive: true, moment: { kind: 'finalLap', at: T0, priority: 1, cars: [] }, subjectCars: null });
    assert.equal(state.source, 'OBS_LIVE');
    // nothing happening: the map is wanted, but not before 10 s
    sourceTick(state, { now: T0 + 5000, settings, streamLive: true, moment: null, subjectCars: null });
    assert.equal(state.source, 'OBS_LIVE');
    sourceTick(state, { now: T0 + 10_000, settings, streamLive: true, moment: null, subjectCars: null });
    assert.equal(state.source, 'TRACK_MAP');
    // a P0 at 2 s after: still within the cooldown
    sourceTick(state, { now: T0 + 12_000, settings, streamLive: true, moment: { kind: 'finish', at: T0 + 12_000, priority: 0, cars: [] }, subjectCars: null });
    assert.equal(state.source, 'TRACK_MAP');
    sourceTick(state, { now: T0 + 14_000, settings, streamLive: true, moment: { kind: 'finish', at: T0 + 12_000, priority: 0, cars: [] }, subjectCars: null });
    assert.equal(state.source, 'OBS_LIVE', 'past the cooldown, a P0 needn’t wait for the minimum shot');
  });

  test('a manual choice takes precedence over the automatic director, until handed back', () => {
    const state = newSourceState('s', T0);
    tickAt(state, T0, { moment: { kind: 'raceStart', at: T0, priority: 0, cars: [] } });
    selectManual(state, 'TRACK_MAP', T0 + 500);
    tickAt(state, T0 + 600, { moment: { kind: 'raceStart', at: T0, priority: 0, cars: [] } });
    assert.equal(state.source, 'TRACK_MAP');
    assert.equal(state.reason, 'manual');
    selectAutomatic(state, T0 + 20_000);
    tickAt(state, T0 + 20_100, { moment: { kind: 'finish', at: T0 + 20_000, priority: 0, cars: [] } });
    assert.equal(state.source, 'OBS_LIVE');
  });

  test('manual OBS falls back to the map when the stream goes offline, after the grace', () => {
    const settings = on({ offlineGraceSeconds: 4 });
    const state = newSourceState('s', T0);
    selectManual(state, 'OBS_LIVE', T0);
    sourceTick(state, { now: T0, settings, streamLive: true, moment: null, subjectCars: null });
    assert.equal(state.source, 'OBS_LIVE');
    sourceTick(state, { now: T0 + 1000, settings, streamLive: false, moment: null, subjectCars: null });
    assert.equal(state.source, 'OBS_LIVE', 'a reconnecting encoder is given a moment');
    sourceTick(state, { now: T0 + 5000, settings, streamLive: false, moment: null, subjectCars: null });
    assert.equal(state.source, 'TRACK_MAP');
    assert.equal(state.fallback, true);
    sourceTick(state, { now: T0 + 6000, settings, streamLive: true, moment: null, subjectCars: null });
    assert.equal(state.source, 'OBS_LIVE', 'back on OBS when it returns, still manual');
  });

  test('turned off, the map at once', () => {
    const state = newSourceState('s', T0);
    tickAt(state, T0, { moment: { kind: 'raceStart', at: T0, priority: 0, cars: [] } });
    sourceTick(state, { now: T0 + 100, settings: { ...on(), enabled: false }, streamLive: true, moment: null, subjectCars: null });
    assert.equal(state.source, 'TRACK_MAP');
  });

  test('every viewer switches at the same server time, and a late snapshot never undoes a newer one', () => {
    const state = newSourceState('s', T0);
    tickAt(state, T0, { moment: { kind: 'raceStart', at: T0, priority: 0, cars: [] } });
    const snap = sourceSnapshot(state, on());
    assert.equal(snap.switchAt, T0 + on().switchLeadMs);
    assert.equal(cameraAt(snap, T0 + 100), 'TRACK_MAP');
    assert.equal(cameraAt(snap, snap.switchAt), 'OBS_LIVE');
    const older = { ...snap, seq: snap.seq - 1 };
    assert.equal(isNewerSource(snap, older), false);
    assert.equal(isNewerSource(snap, { ...snap, sessionKey: 'other', seq: 1 }), true);
    assert.equal(effectiveSource('OBS_LIVE', true), 'VIDEO_CLIP');
    assert.equal(effectiveSource('OBS_LIVE', false), 'OBS_LIVE');
  });

  test('after a restart the numbering jumps ahead, so viewers take the restored state', () => {
    const state = newSourceState('s', T0);
    selectManual(state, 'OBS_LIVE', T0);
    const restored = restoreSourceState(JSON.parse(JSON.stringify(state)), T0 + 60_000);
    assert.ok(restored.seq > state.seq + 50);
    assert.equal(restored.mode, 'manual');
    assert.equal(restored.manualSource, 'OBS_LIVE');
    assert.ok(isNewerSource(sourceSnapshot(state, on()), sourceSnapshot(restored, on())));
  });
});

describe('moments', () => {
  const ctx = { isRace: true, phase: 'middle', raceProgress: 0.5, userIdx: 1, userPosition: 3, storylines: [] };
  test('events map to the moments the camera follows', () => {
    assert.equal(momentKind({ seq: 1, at: 0, event: { type: 'raceStart', starters: 20, userGrid: 3 } }), 'raceStart');
    assert.equal(momentKind({ seq: 1, at: 0, event: { type: 'flag', flag: 'checkered', notes: [] } }), 'finish');
    assert.equal(momentKind({ seq: 1, at: 0, event: { type: 'lapComplete', lap: 3, lapTime: 90, bestLapTime: 89, newBest: false } }), null);
    assert.equal(momentKind({ seq: 1, at: 0, event: { type: 'battle', phase: 'ended' } }), null);
  });
  test('the most important recent moment wins', () => {
    const events = [
      { seq: 1, at: T0 - 1000, event: { type: 'pitEntry' } },
      { seq: 2, at: T0 - 500, event: { type: 'flag', flag: 'checkered', notes: [] } },
      { seq: 3, at: T0 - 60_000, event: { type: 'raceStart', starters: 20, userGrid: 3 } },
    ];
    const m = currentMoment(events, ctx, T0, 20_000);
    assert.equal(m.kind, 'finish');
    assert.equal(m.priority, 0);
    assert.equal(currentMoment([], ctx, T0, 20_000), null);
  });
});

describe('timeline buffer', () => {
  test('duplicates, out of order and too old pictures', () => {
    const b = new TimelineBuffer(10_000);
    assert.equal(b.push(1000, 1, 'a'), 'added');
    assert.equal(b.push(3000, 3, 'c'), 'added');
    assert.equal(b.push(2000, 2, 'b'), 'outOfOrder');
    assert.equal(b.push(3000, 3, 'c'), 'duplicate');
    assert.equal(b.push(30_000, 4, 'd'), 'added');
    assert.equal(b.push(5000, 5, 'e'), 'tooOld');
    assert.equal(b.stats.duplicates, 1);
    assert.equal(b.stats.outOfOrder, 1);
    assert.equal(b.stats.tooOld, 1);
  });
  test('bounded, however long it runs', () => {
    const b = new TimelineBuffer(5000, 50);
    for (let i = 0; i < 10_000; i++) b.push(i * 100, i, i);
    assert.ok(b.size <= 52, `kept ${b.size}`);
    assert.ok(b.spanMs <= 5100);
  });
  test('the pictures either side of a time, and late arrivals counted', () => {
    const b = new TimelineBuffer(60_000);
    b.push(1000, 1, 'a');
    b.push(2000, 2, 'b');
    const f = b.frameAt(1500);
    assert.equal(f.before.value, 'a');
    assert.equal(f.after.value, 'b');
    assert.equal(f.alpha, 0.5);
    assert.equal(b.frameAt(500).behind, true);
    assert.equal(b.frameAt(5000).after, null);
    b.push(1200, 9, 'late');
    assert.equal(b.stats.late, 1, 'behind the playhead already shown');
  });
  test('lap positions across the line, resets not flown to', () => {
    assert.ok(Math.abs(interpolatePct(0.98, 0.02, 0.5) - 0) < 1e-9 || Math.abs(interpolatePct(0.98, 0.02, 0.5) - 1) < 1e-9);
    assert.ok(Math.abs(interpolatePct(0.2, 0.3, 0.5) - 0.25) < 1e-9);
    assert.equal(interpolatePct(0.1, 0.6, 0.4), 0.1);
    assert.equal(interpolatePct(0.1, 0.6, 0.6), 0.6);
    assert.ok(Math.abs(rateBetween(0.99, 0, 0.01, 1000) - 0.02) < 1e-9);
    assert.equal(rateBetween(0.1, 0, 0.6, 1000), null);
    assert.equal(rateBetween(null, 0, 0.2, 1000), null);
  });
});

describe('delay', () => {
  const base = { syncEnabled: true, mode: 'auto', manualOffsetMs: 0, maxBufferMs: 45_000, measuredLatencyMs: null, estimatedLatencyMs: null };
  test('off is live, with nothing buffered', () => {
    assert.deepEqual(effectiveDelay({ ...base, syncEnabled: false, measuredLatencyMs: 20_000 }), { delayMs: 0, basis: 'off', clamped: false, degraded: false });
  });
  test('measured beats estimated beats the calibration alone, and each says which it is', () => {
    assert.equal(effectiveDelay({ ...base, measuredLatencyMs: 12_000, estimatedLatencyMs: 20_000, manualOffsetMs: -500 }).delayMs, 11_500);
    assert.equal(effectiveDelay({ ...base, measuredLatencyMs: 12_000 }).basis, 'measured');
    assert.equal(effectiveDelay({ ...base, estimatedLatencyMs: 20_000 }).basis, 'estimated');
    assert.equal(effectiveDelay({ ...base, manualOffsetMs: 8000 }).basis, 'manual');
    const nothing = effectiveDelay(base);
    assert.equal(nothing.basis, 'none');
    assert.equal(nothing.degraded, true, 'no timing at all is degraded, never claimed as synchronized');
  });
  test('manual mode is the offset alone, and the buffer caps it', () => {
    assert.equal(effectiveDelay({ ...base, mode: 'manual', manualOffsetMs: 15_000, measuredLatencyMs: 2000 }).delayMs, 15_000);
    const capped = effectiveDelay({ ...base, estimatedLatencyMs: 80_000 });
    assert.equal(capped.delayMs, 45_000);
    assert.equal(capped.clamped, true);
    assert.equal(capped.degraded, true);
  });
  // Steps of 250 ms from t, wanting target each time, with the given offset
  const run = (hold, target, offset, from, ms) => {
    let h = hold;
    for (let t = from + 250; t <= from + ms; t += 250) h = holdDelay(h, target, offset, t, 250);
    return h;
  };
  test('the first delay is taken at once, then held through the estimate’s ups and downs', () => {
    let h = holdDelay(newDelayHold(), 30_000, 4000, T0, 250);
    assert.equal(h.applied, 30_000);
    // a segment's sawtooth: ±1.5 s, over and over, never moves it
    for (let i = 0; i < 200; i++) h = holdDelay(h, 30_000 + (i % 2 ? 1500 : -1500), 4000, T0 + 250 * (i + 1), 250);
    assert.equal(h.applied, 30_000);
  });
  test('a lasting difference waits, then glides slowly enough that the timeline barely changes speed', () => {
    let h = holdDelay(newDelayHold(), 30_000, 0, T0, 250);
    h = run(h, 36_000, 0, T0, 4000);
    assert.equal(h.applied, 30_000, 'not before it has lasted');
    h = run(h, 36_000, 0, T0 + 4000, 2000);
    assert.equal(h.gliding, true);
    const before = h.applied;
    h = run(h, 36_000, 0, T0 + 6000, 10_000);
    assert.ok(h.applied - before <= DELAY_GLIDE_RATE * 10_000 + 1, 'at most 5% of real time');
    h = run(h, 36_000, 0, T0 + 16_000, 200_000);
    assert.equal(h.applied, 36_000);
    assert.equal(h.gliding, false);
  });
  test('the calibrated offset is the viewer’s own adjustment: applied at once, by exactly that much', () => {
    let h = holdDelay(newDelayHold(), 30_000, 4000, T0, 250);
    h = holdDelay(h, 31_000, 5000, T0 + 250, 250);
    assert.equal(h.applied, 31_000);
    h = holdDelay(h, 29_500, 3500, T0 + 500, 250);
    assert.equal(h.applied, 29_500);
  });
  test('a new stream (a very different delay) and turning it off are at once', () => {
    let h = holdDelay(newDelayHold(), 30_000, 0, T0, 250);
    assert.equal(holdDelay(h, 50_000, 0, T0 + 250, 250).applied, 50_000);
    h = holdDelay(h, 0, null, T0 + 250, 250);
    assert.equal(h.applied, 0);
  });
  test('the latency is the median of the readings', () => {
    assert.equal(medianOf([]), null);
    assert.equal(medianOf([30, 10, 20]), 20);
    assert.equal(medianOf([10, 20, 30, 1000]), 25);
  });
  test('the error left is only reported when measured', () => {
    assert.equal(syncErrorMs(null, 10_000, 0), null);
    assert.equal(syncErrorMs(12_000, 11_000, 0), 1000);
  });
});

describe('commentary on the delayed timeline', () => {
  test('due at the event’s time plus the delay, counted once', () => {
    // event at server 100 000, server is 2 s ahead of this browser, 15 s delay
    assert.equal(commentaryNotBefore(100_000, 2000, 15_000), 113_000);
    assert.equal(commentaryNotBefore(100_000, 2000, 0), null);
    assert.deepEqual(commentaryWait(113_000, 110_000, 5000), { waitMs: 3000, stale: false });
    assert.equal(commentaryWait(113_000, 120_000, 5000).stale, true);
  });
  test('the queue holds a line until it’s due, its wait and expiry counted from then', () => {
    const q = new CommentaryQueue();
    q.push([{ speaker: 'lead', text: 'Into turn one', audio: '', expiresAt: 1500, notBefore: 30_000 }], 1000);
    assert.equal(q.next(20_000), null, 'not due');
    assert.equal(q.waitMs(20_000), 10_000);
    assert.equal(q.size, 1);
    const line = q.next(30_100);
    assert.equal(line.text, 'Into turn one', 'neither the 20 s wait nor its expiry ran out while it was held');
  });
  test('lines without a presentation time play as before', () => {
    const q = new CommentaryQueue();
    q.push([{ speaker: 'lead', text: 'Go', audio: '' }], 1000);
    assert.equal(q.next(1001).text, 'Go');
  });
});

describe('Cloudflare Stream helpers', () => {
  test('status in either shape the API gives', () => {
    assert.equal(statusFromLiveInput({ status: 'connected' }), 'LIVE');
    assert.equal(statusFromLiveInput({ status: { current: { state: 'reconnecting' } } }), 'CONNECTING');
    assert.equal(statusFromLiveInput({ status: null }), 'OFFLINE');
    assert.equal(statusFromLiveInput({ status: 'failed_to_connect' }), 'ERROR');
    assert.equal(statusFromLiveInput({ status: 'connected', enabled: false }), 'OFFLINE');
    assert.equal(statusFromLiveInput({ status: 'something_new' }), 'UNKNOWN');
  });
  test('the lifecycle, and the two together', () => {
    assert.deepEqual(statusFromLifecycle({ isInput: true, live: true, videoUID: 'a'.repeat(32) }), { status: 'LIVE', videoUid: 'a'.repeat(32) });
    assert.equal(statusFromLifecycle({ isInput: true, live: false, videoUID: null }).status, 'OFFLINE');
    assert.equal(combineStatus('LIVE', 'OFFLINE'), 'CONNECTING', 'an encoder connected with nothing playable yet');
    assert.equal(combineStatus(null, 'LIVE'), 'LIVE');
    assert.equal(combineStatus('UNKNOWN', null), 'UNKNOWN');
  });
  test('playback URLs, and IDs checked', () => {
    const uid = 'f'.repeat(32);
    assert.ok(isLiveInputId(uid));
    assert.ok(!isLiveInputId('../etc'));
    assert.deepEqual(playbackUrls('abc123', uid), {
      hls: `https://customer-abc123.cloudflarestream.com/${uid}/manifest/video.m3u8`,
      iframe: `https://customer-abc123.cloudflarestream.com/${uid}/iframe`,
    });
  });
  test('a signed token is an RS256 JWT Cloudflare can verify with the key’s public half', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const claims = tokenClaims('b'.repeat(32), 'kid1', 1000, 7200);
    assert.equal(claims.payload.exp, 8200);
    assert.ok(claims.payload.exp - 1000 <= 24 * 3600, 'Cloudflare allows 24 hours at most');
    const input = signingInput(claims);
    const signature = createSign('RSA-SHA256').update(input).sign(privateKey);
    const token = `${input}.${base64Url(new Uint8Array(signature))}`;
    const [h, p, s] = token.split('.');
    assert.equal(JSON.parse(Buffer.from(h, 'base64url')).alg, 'RS256');
    assert.equal(JSON.parse(Buffer.from(p, 'base64url')).sub, 'b'.repeat(32));
    assert.ok(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(createPublicKey(privateKey), Buffer.from(s, 'base64url')));
  });
  test('cost: every viewer minute is a delivered minute', () => {
    assert.equal(deliveryCostUsd(100, 60), 6);
    assert.equal(deliveryCostUsd(500, 120), 60);
  });
});

describe('source guards', () => {
  test('the Admin routes answer 404 to anyone but an Admin', () => {
    for (const file of ['src/app/api/admin/live-video/route.ts', 'src/app/api/admin/live-video/streams/route.ts', 'src/app/api/admin/live-video/streams/[id]/route.ts']) {
      const source = read(file);
      const handlers = source.match(/export async function (GET|PUT|POST|PATCH|DELETE)/g) ?? [];
      const guards = source.match(/if \(!user \|\| !isAdmin\(user\.role\)\) return NextResponse\.json\(\{ error: t\.adminOnly \}, \{ status: 404 \}\)/g) ?? [];
      assert.ok(handlers.length > 0, file);
      assert.equal(guards.length, handlers.length, `${file}: every handler checks the Admin role first`);
    }
  });
  test('viewer routes need a signed-in user or a paired TV, and are rate limited', () => {
    const streams = read('src/app/api/live/video/route.ts');
    assert.match(streams, /if \(!user\) return NextResponse\.json\(\{ error: t\.logInLiveRacing \}, \{ status: 401 \}\)/);
    assert.match(streams, /limitReached\(key, ABUSE_LIMITS\.liveVideoStreamsPerUser\)/);
    const report = read('src/app/api/tv/live-video/report/route.ts');
    assert.match(report, /getTvSession\(\)/);
    assert.match(report, /limitReached\(key, ABUSE_LIMITS\.liveVideoReportsPerTv\)/);
  });
  test('request bodies are read with a cap', () => {
    for (const file of ['src/app/api/admin/live-video/route.ts', 'src/app/api/admin/live-video/streams/route.ts', 'src/app/api/admin/live-video/streams/[id]/route.ts', 'src/app/api/tv/live-video/report/route.ts']) {
      assert.ok(!/request\.(json|text|formData|arrayBuffer)\(\)/.test(read(file)), file);
    }
  });
  test('no stream key or API token reaches a browser', () => {
    const cloudflare = read('src/lib/liveVideo/cloudflareStream.ts');
    assert.ok(!/streamKey/.test(cloudflare.replace(/\/\/.*$/gm, '')), 'the stream key is never read from Cloudflare’s answers');
    for (const file of ['src/lib/liveVideo/broadcastSourceRuntime.ts', 'src/app/api/live/video/route.ts', 'src/app/api/admin/live-video/route.ts', 'src/app/api/admin/live-video/streams/route.ts']) {
      const source = read(file);
      assert.ok(!/apiToken|signingKeyPem|CLOUDFLARE_STREAM_API_TOKEN/.test(source.replace(/\/\/.*$/gm, '')), `${file} handles no secret`);
    }
    for (const file of fs.readdirSync(new URL('src/components/', root))) {
      assert.ok(!/CLOUDFLARE_STREAM_/.test(read(`src/components/${file}`).replace(/\/\/.*$/gm, '').replace(/'[^']*CLOUDFLARE_STREAM[^']*'/g, '')), file);
    }
  });
  test('the TV keeps the map and the OBS player mounted, switching by opacity', () => {
    const stage = read('src/components/TvBroadcastStage.tsx');
    assert.match(stage, /\{children\}/);
    assert.match(stage, /opacity: obsOnScreen \? 1 : 0/);
    assert.ok(!/obsOnScreen && <LiveOBSPlayer/.test(stage), 'the player isn’t mounted only while on screen');
    const tv = read('src/components/TvBroadcast.tsx');
    assert.match(tv, /<BroadcastVideoSwitcher[\s\S]*<TvBroadcastStage[\s\S]*<TvMap/, 'clips over the camera, the camera over the map');
  });
  test('live video goes through the emergency stop and the feature flag', () => {
    const runtime = read('src/lib/liveVideo/broadcastSourceRuntime.ts');
    assert.match(runtime, /meteredServicesOn\(\)/);
    assert.match(runtime, /if \(!settings\.enabled \|\| !streamConfig\(\)\.customerCode\) return false/);
    assert.match(runtime, /watchableDrivers\(viewer\)/, 'a stream only for drivers the viewer may watch on Live Racing');
  });
  test('the CSP allows Cloudflare Stream for media and fetches', () => {
    const headers = read('security-headers.mjs');
    assert.match(headers, /connect-src 'self' blob: \$\{R2\} \$\{STREAM\}/);
    assert.match(headers, /media-src 'self' blob: data: \$\{R2\} \$\{STREAM\}/);
  });
});
