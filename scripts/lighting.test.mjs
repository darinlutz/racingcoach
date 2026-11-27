// The lighting system's website side (docs/lighting/README.md): the event contract, the hub's sequencing, resuming
// and isolation, the Live Racing indicator's rule and the agent status parser. No database or network.
//   npm run test:lighting
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  lightingChanges,
  lightingSessionId,
  lightingStateOf,
  parseStreamPosition,
  streamPosition,
  telemetryFresh,
} from '../src/lib/lighting/events.ts';
import {
  emitTestEvent,
  endLightingSession,
  lightingEventsAfter,
  lightingSnapshot,
  recordLightingUpdate,
  resetLightingHubForTests,
  subscribeLighting,
} from '../src/lib/lighting/hub.ts';
import { pitLimiterView } from '../src/lib/lighting/pitLimiterView.ts';
import { parseAgentStatus } from '../src/lib/lighting/agentStatus.ts';

const update = (over = {}) => ({
  track: 'Spa',
  trackKey: 'spa up',
  onTrack: true,
  sessionType: 'Race',
  sessionName: 'RACE',
  field: { subSessionId: 4242 },
  pitLimiterActive: false,
  ...over,
});

describe('the event contract', () => {
  test('a session is its subsession, session and track', () => {
    assert.equal(lightingSessionId(update()), '4242|Race|RACE|spa up');
    assert.equal(lightingSessionId(update({ field: null, trackKey: null })), 'offline|Race|RACE|Spa');
  });

  test('the first state starts a session and says the limiter; only changes after', () => {
    const a = lightingStateOf(update());
    assert.deepEqual(
      lightingChanges(null, a).map((d) => d.eventType),
      ['session.changed', 'pitLimiter.changed']
    );
    assert.deepEqual(lightingChanges(a, a), []);
    const on = lightingStateOf(update({ pitLimiterActive: true }));
    assert.deepEqual(lightingChanges(a, on), [{ eventType: 'pitLimiter.changed', data: { active: true } }]);
  });

  test('unknown is told too, so lights leave the blue; a collector without the field is unknown', () => {
    const on = lightingStateOf(update({ pitLimiterActive: true }));
    const unknown = lightingStateOf(update({ pitLimiterActive: undefined }));
    assert.equal(unknown.pitLimiterActive, null);
    assert.deepEqual(lightingChanges(on, unknown), [{ eventType: 'pitLimiter.changed', data: { active: null } }]);
    assert.equal(lightingStateOf(update()).simulator, 'iracing');
  });

  test('the collector closing ends the session', () => {
    assert.deepEqual(lightingChanges(lightingStateOf(update()), null), [{ eventType: 'session.ended', data: { reason: 'collectorClosed' } }]);
    assert.deepEqual(lightingChanges(null, null), []);
  });

  test('stream positions', () => {
    assert.deepEqual(parseStreamPosition('ab12cd34:17'), { epoch: 'ab12cd34', sequence: 17 });
    for (const bad of [null, '', 'x', 'a:b', 'a:-1', 'a b:1', `${'x'.repeat(65)}:1`]) assert.equal(parseStreamPosition(bad), null, String(bad));
    assert.equal(streamPosition({ epoch: 'e', sequence: 3 }), 'e:3');
  });

  test('telemetry is fresh for 5 s', () => {
    assert.equal(telemetryFresh(0), true);
    assert.equal(telemetryFresh(5000), true);
    assert.equal(telemetryFresh(5001), false);
    assert.equal(telemetryFresh(null), false);
  });
});

describe('the hub', () => {
  beforeEach(() => resetLightingHubForTests());

  test('numbers each driver’s events and pushes them to that driver’s subscribers only', () => {
    const mine = [];
    const theirs = [];
    const stopMine = subscribeLighting(1, (e) => mine.push(e));
    const stopTheirs = subscribeLighting(2, (e) => theirs.push(e));
    recordLightingUpdate(1, update(), 1000);
    recordLightingUpdate(1, update({ pitLimiterActive: true }), 1500);
    recordLightingUpdate(1, update({ pitLimiterActive: true }), 2000);
    stopMine();
    stopTheirs();
    assert.deepEqual(mine.map((e) => [e.sequence, e.eventType, e.data.active ?? null]), [
      [1, 'session.changed', null],
      [2, 'pitLimiter.changed', false],
      [3, 'pitLimiter.changed', true],
    ]);
    assert.equal(theirs.length, 0);
    assert.ok(mine.every((e) => e.source === 'live' && e.schemaVersion === 1 && e.sessionId === '4242|Race|RACE|spa up'));
    assert.equal(new Set(mine.map((e) => e.eventId)).size, 3);
  });

  test('a snapshot has the state and its age; stale after 5 s', () => {
    recordLightingUpdate(7, update({ pitLimiterActive: true }), 10_000);
    const fresh = lightingSnapshot(7, 12_000);
    assert.equal(fresh.live.pitLimiterActive, true);
    assert.equal(fresh.live.telemetryAgeMs, 2000);
    assert.equal(fresh.live.fresh, true);
    assert.equal(lightingSnapshot(7, 15_001).live.fresh, false);
    assert.equal(lightingSnapshot(8).live, null);
  });

  test('resumes after a position, or asks for a snapshot', () => {
    recordLightingUpdate(3, update(), 1);
    recordLightingUpdate(3, update({ pitLimiterActive: true }), 2);
    const { epoch } = lightingSnapshot(3);
    // session.changed 1 and pitLimiter.changed 2 (off), then pitLimiter.changed 3 (on)
    assert.deepEqual(lightingEventsAfter(3, epoch, 1).map((e) => e.sequence), [2, 3]);
    assert.deepEqual(lightingEventsAfter(3, epoch, 3), []);
    assert.equal(lightingEventsAfter(3, 'another', 1), null);
    assert.equal(lightingEventsAfter(3, epoch, 99), null);
  });

  test('the collector closing ends the session once', () => {
    const seen = [];
    subscribeLighting(4, (e) => seen.push(e.eventType));
    recordLightingUpdate(4, update({ pitLimiterActive: true }), 1);
    endLightingSession(4, 2);
    endLightingSession(4, 3);
    assert.deepEqual(seen, ['session.changed', 'pitLimiter.changed', 'session.ended']);
    assert.equal(lightingSnapshot(4).live, null);
  });

  test('test events are marked and never change the live state', () => {
    recordLightingUpdate(5, update({ pitLimiterActive: false }), 1);
    const seen = [];
    subscribeLighting(5, (e) => seen.push(e));
    emitTestEvent(5, { eventType: 'pitLimiter.changed', data: { active: true } }, 2);
    assert.equal(seen[0].source, 'test');
    assert.equal(seen[0].sessionId, 'test');
    const snap = lightingSnapshot(5, 3);
    assert.equal(snap.live.pitLimiterActive, false);
    assert.equal(snap.test.pitLimiterActive, true);
    emitTestEvent(5, { eventType: 'session.ended', data: { reason: 'test' } }, 4);
    assert.equal(lightingSnapshot(5).test, null);
    assert.equal(lightingSnapshot(5).live.pitLimiterActive, false);
  });
});

describe('the Live Racing indicator', () => {
  const driver = (over = {}) => ({ pitLimiterActive: true, onTrack: true, offline: false, ageMs: 400, ...over });
  test('lit only while fresh and on', () => {
    assert.equal(pitLimiterView(driver()), 'active');
    assert.equal(pitLimiterView(driver({ pitLimiterActive: false })), 'off');
    assert.equal(pitLimiterView(driver({ pitLimiterActive: null })), 'unavailable');
    assert.equal(pitLimiterView(driver({ pitLimiterActive: undefined })), 'unavailable');
  });
  test('never a stale blue', () => {
    assert.equal(pitLimiterView(driver({ ageMs: 5001 })), 'stale');
    assert.equal(pitLimiterView(driver({ offline: true })), 'stale');
    // In the garage the collector sends every 5 s
    assert.equal(pitLimiterView(driver({ onTrack: false, ageMs: 6000, pitLimiterActive: false })), 'off');
    assert.equal(pitLimiterView(driver({ onTrack: false, ageMs: 12_001 })), 'stale');
  });
});

describe('the agent status', () => {
  test('keeps known fields and sizes, and no addresses', () => {
    const status = parseAgentStatus(
      {
        version: '0.1.0',
        mode: 'AUTOMATIC',
        lastEventLatencyMs: 182.4,
        controllers: [{ id: 'quad', name: 'Dig-Quad', online: true, firmware: '0.15.1', ip: '192.168.1.50', latencyMs: -5 }],
        extra: 'x'.repeat(10_000),
      },
      99
    );
    assert.equal(status.lastEventLatencyMs, 182);
    assert.deepEqual(status.controllers, [{ id: 'quad', name: 'Dig-Quad', online: true, firmware: '0.15.1', lastAckMs: null, latencyMs: null }]);
    assert.equal(status.receivedAt, 99);
    assert.equal(JSON.stringify(status).includes('192.168'), false);
    assert.deepEqual(parseAgentStatus(null, 1).controllers, []);
  });
});
