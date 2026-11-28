// The Mac lighting agent (lighting-agent/, docs/lighting/README.md) without the hardware: the state machine's
// precedence, protected zones, stale telemetry and manual changes during an override; the event stream parser; the
// WLED provider against a stand-in controller (body, serializing, retries, offline); the runtime end to end with mock
// controllers (the acceptance workflow's light changes, duplicates and out-of-order events); and the local API's
// guards. RC_LIGHTING_HOME points at a temporary folder, so nothing touches a real installation.
//   npm run test:lighting-agent
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'rc-lighting-'));
process.env.RC_LIGHTING_HOME = home;

const { defaultConfig, configProblems, isLocalHost, BLUE, RED, WHITE } = await import('../src/lib/lighting/model.ts');
const { decide } = await import('../lighting-agent/lib/stateMachine.ts');
const { SseParser } = await import('../lighting-agent/lib/sse.ts');
const { WledProvider, wledStateBody, parseWledInfo } = await import('../lighting-agent/lib/wled.ts');
const { MockProvider } = await import('../lighting-agent/lib/providers.ts');
const { LightingRuntime } = await import('../lighting-agent/lib/runtime.ts');
const { startLocalApi, hexColor } = await import('../lighting-agent/lib/localApi.ts');
const { backoffMs } = await import('../lighting-agent/lib/site.ts');
const { keyIconPng, KEY_ICON_SIZE } = await import('../lighting-agent/lib/keyIcon.ts');
const { streamDeckLayout, streamDeckAppName, streamDeckAppleScript, FLAG_TESTS, STREAM_DECK_ROWS, STREAM_DECK_COLS } = await import('../src/lib/lighting/streamDeckLayout.ts');
const { inflateSync } = await import('node:zlib');

after(() => rmSync(home, { recursive: true, force: true }));
const quiet = () => {};

// A config with every zone enabled, so precedence shows in each
function allZones() {
  const config = defaultConfig();
  config.zones.forEach((z, i) => {
    z.enabled = true;
    z.segmentId = i;
  });
  return config;
}
const inputs = (over = {}) => ({ mode: 'AUTOMATIC', allOff: false, sceneId: 'race', manual: {}, events: [], liveFresh: true, now: 1000, ...over });
const byZone = (decisions) => Object.fromEntries(decisions.map((d) => [d.zoneId, d]));
const pit = (source = 'live') => ({ event: 'pitLimiter', source, since: 0 });

describe('configuration', () => {
  test('the defaults are valid, and problems are found', () => {
    assert.deepEqual(configProblems(defaultConfig()), []);
    const bad = defaultConfig();
    bad.controllers[0].host = '8.8.8.8';
    bad.zones[1].enabled = true;
    bad.zones[1].segmentId = 0;
    bad.rules[0].priority = 0;
    bad.startScene = 'nope';
    const problems = configProblems(bad).join('\n');
    assert.match(problems, /home network/);
    assert.match(problems, /used by another enabled zone/);
    assert.match(problems, /priority/);
    assert.match(problems, /startScene/);
  });
  test('controllers are home network addresses only', () => {
    for (const ok of ['192.168.1.40', '10.0.0.9', '172.20.1.1', 'wled-quad.local', '169.254.10.2']) assert.equal(isLocalHost(ok), true, ok);
    for (const bad of ['8.8.8.8', '172.32.0.1', 'example.com', '192.168.1', '300.1.1.1', 'localhost']) assert.equal(isLocalHost(bad), false, bad);
  });
});

describe('the state machine', () => {
  test('the pit limiter turns the automatic zones blue; protected zones are left alone', () => {
    const d = byZone(decide(allZones(), inputs({ events: [pit()] })));
    assert.deepEqual(d.cockpit.look.color, BLUE);
    assert.equal(d.cockpit.reason, 'rule:pit-limiter');
    assert.equal(d.pedals.look, null);
    assert.equal(d.pedals.reason, 'protected');
    assert.equal(d.engineer.look, null);
  });

  test('without the event, the baseline scene; never a hard-coded white', () => {
    const red = decide(allZones(), inputs({ sceneId: 'red' }));
    assert.deepEqual(byZone(red).cockpit.look.color, RED);
    assert.equal(byZone(red).cockpit.reason, 'baseline');
  });

  test('stale live telemetry ends the override; test events still apply', () => {
    assert.equal(byZone(decide(allZones(), inputs({ events: [pit()], liveFresh: false }))).cockpit.reason, 'baseline');
    assert.equal(byZone(decide(allZones(), inputs({ events: [pit('test')], liveFresh: false }))).cockpit.reason, 'rule:pit-limiter');
  });

  test('modes: MANUAL ignores events, TEST only test events, DISABLED leaves everything', () => {
    assert.equal(byZone(decide(allZones(), inputs({ mode: 'MANUAL', events: [pit()] }))).cockpit.reason, 'baseline');
    assert.equal(byZone(decide(allZones(), inputs({ mode: 'TEST', events: [pit()] }))).cockpit.reason, 'baseline');
    assert.equal(byZone(decide(allZones(), inputs({ mode: 'TEST', events: [pit('local')] }))).cockpit.reason, 'rule:pit-limiter');
    assert.ok(decide(allZones(), inputs({ mode: 'DISABLED', events: [pit()] })).every((d) => d.look === null));
  });

  test('all off beats events and spares protected zones', () => {
    const config = allZones();
    const d = byZone(decide(config, inputs({ allOff: true, events: [pit()], manual: { pedals: { on: true, color: WHITE } } })));
    assert.equal(d.cockpit.look.on, false);
    assert.equal(d.cockpit.reason, 'allOff');
    assert.equal(d.pedals.look.on, true);
  });

  test('higher priority wins, and priority is configurable', () => {
    const config = allZones();
    config.rules.find((r) => r.id === 'yellow-flag').enabled = true;
    const both = [pit(), { event: 'yellowFlag', source: 'live', since: 0 }];
    assert.equal(byZone(decide(config, inputs({ events: both }))).cockpit.reason, 'rule:yellow-flag');
    config.rules.find((r) => r.id === 'pit-limiter').priority = 50;
    assert.equal(byZone(decide(config, inputs({ events: both }))).cockpit.reason, 'rule:pit-limiter');
  });

  test('brightness is capped by the zone and scaled by the master brightness; a rule naming a protected zone reaches it', () => {
    const config = allZones();
    config.zones.find((z) => z.id === 'cockpit').maxBrightness = 50;
    config.settings.masterBrightness = 0.5;
    assert.equal(byZone(decide(config, inputs({ sceneId: 'garage' }))).cockpit.look.brightness, 25);
    config.rules[0].zones = ['pedals'];
    assert.equal(byZone(decide(config, inputs({ events: [pit()] }))).pedals.reason, 'rule:pit-limiter');
  });

  test('disabled zones are never sent anything', () => {
    assert.equal(byZone(decide(defaultConfig(), inputs())).monitor.reason, 'zoneDisabled');
  });
});

describe('the event stream parser', () => {
  test('events in any pieces, comments, ids and multi-line data', () => {
    const seen = [];
    const parser = new SseParser((m) => seen.push(m));
    const text = 'retry: 2000\n\n: comment\nid: e1:5\nevent: lighting\ndata: {"a":\ndata: 1}\n\nevent: heartbeat\r\ndata: {}\r\n\r\n';
    for (const ch of text) parser.push(ch);
    assert.deepEqual(seen, [
      { event: 'lighting', data: '{"a":\n1}', id: 'e1:5' },
      { event: 'heartbeat', data: '{}', id: 'e1:5' },
    ]);
    assert.equal(parser.retryMs, 2000);
    assert.equal(parser.lastEventId, 'e1:5');
  });
  test('reconnect backoff grows to 30 s with jitter', () => {
    assert.equal(backoffMs(0, () => 0.5), 1000);
    assert.equal(backoffMs(3, () => 0.5), 8000);
    assert.equal(backoffMs(20, () => 0.5), 30_000);
    assert.ok(backoffMs(2, () => 0) >= 3000 && backoffMs(2, () => 1) <= 5000);
  });
});

describe('WLED', () => {
  test('the body touches only the named segments, RGBW, without the controller’s brightness', () => {
    const body = wledStateBody([{ segmentId: 0, look: { on: true, color: BLUE, brightness: 128, effect: 0, transitionMs: 150 } }]);
    assert.deepEqual(body, { on: true, transition: 2, seg: [{ id: 0, on: true, bri: 128, col: [[0, 0, 255, 0]], fx: 0 }] });
    assert.equal('bri' in body, false);
    const off = wledStateBody([{ segmentId: 2, look: { on: false, color: BLUE, brightness: 0, effect: 0, transitionMs: 0 } }]);
    assert.equal('on' in off, false, 'never turns the controller off');
  });

  test('info: version, pixel count (IC groups), RGBW and segments', () => {
    const info = parseWledInfo({ ver: '0.15.1', name: 'Dig-Quad', leds: { count: 42, lc: 3, seglc: [3, 1], maxseg: 32 } }, { seg: [{ id: 0, start: 0, stop: 42, on: true }] });
    assert.deepEqual(info, { name: 'Dig-Quad', firmware: '0.15.1', pixelCount: 42, rgbw: true, outputs: 2, maxSegments: 32, segments: [{ id: 0, start: 0, stop: 42, on: true }] });
  });

  describe('against a stand-in controller', () => {
    let server;
    let port;
    const received = [];
    let failures = 0;
    let delayMs = 0;
    before(async () => {
      server = createServer(async (req, res) => {
        let body = '';
        for await (const c of req) body += c;
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        if (failures > 0) {
          failures--;
          res.writeHead(500).end();
          return;
        }
        if (req.url === '/json/info') return res.end(JSON.stringify({ ver: '0.15.1', leds: { count: 42 } }));
        if (req.url === '/json/state' && req.method === 'GET') return res.end(JSON.stringify({ seg: [] }));
        received.push(JSON.parse(body));
        res.end(JSON.stringify({ success: true }));
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      port = server.address().port;
    });
    after(() => server.close());
    const provider = () => new WledProvider({ id: 'main', name: 'Quad', host: '127.0.0.1', port }, quiet);
    const look = (color) => ({ on: true, color, brightness: 100, effect: 0, transitionMs: 0 });

    test('acknowledged, with its latency', async () => {
      received.length = 0;
      const p = provider();
      const result = await p.apply([{ segmentId: 0, look: look(BLUE) }]);
      assert.equal(result.ok, true);
      assert.equal(p.online, true);
      assert.equal(received.length, 1);
      assert.equal((await p.info()).firmware, '0.15.1');
    });

    test('one request at a time; commands meanwhile merge, the newest per segment', async () => {
      received.length = 0;
      delayMs = 60;
      const p = provider();
      const first = p.apply([{ segmentId: 0, look: look(WHITE) }]);
      const second = p.apply([{ segmentId: 0, look: look(RED) }]);
      const third = p.apply([{ segmentId: 0, look: look(BLUE) }, { segmentId: 1, look: look(WHITE) }]);
      await Promise.all([first, second, third]);
      delayMs = 0;
      assert.equal(received.length, 2);
      assert.deepEqual(received[1].seg.map((s) => [s.id, s.col[0]]), [[0, BLUE], [1, WHITE]]);
    });

    test('retries, then goes offline', async () => {
      received.length = 0;
      failures = 2;
      const p = provider();
      const ok = await p.apply([{ segmentId: 0, look: look(BLUE) }]);
      assert.equal(ok.ok, true);
      assert.equal(ok.attempts, 3);
      failures = 3;
      const failed = await p.apply([{ segmentId: 0, look: look(BLUE) }]);
      assert.equal(failed.ok, false);
      assert.equal(p.online, false);
      failures = 0;
    });
  });
});

// The acceptance workflow's light changes, with a mock controller
describe('the runtime, end to end', () => {
  const makeRuntime = () => {
    const config = defaultConfig();
    config.settings.minChangeIntervalMs = 0;
    const runtime = new LightingRuntime(config, quiet, { save: false, state: {} });
    const mock = new MockProvider(config.controllers[0]);
    runtime.providers.set('main', mock);
    return { runtime, mock, cockpit: () => mock.segments.get(0) };
  };
  let seq = 0;
  const event = (eventType, data, over = {}) => ({
    schemaVersion: 1,
    eventId: `e-${++seq}`,
    eventType,
    source: 'live',
    simulator: 'iracing',
    sessionId: 's',
    epoch: 'ep1',
    sequence: seq,
    timestampUtc: new Date().toISOString(),
    data,
    ...over,
  });
  const settle = () => new Promise((r) => setTimeout(r, 30));

  test('white, pit limiter blue, back to white; red by hand, blue, back to red', async () => {
    const { runtime, cockpit } = makeRuntime();
    runtime.onSnapshot({ schemaVersion: 1, epoch: 'ep1', sequence: seq, serverTimeUtc: new Date().toISOString(), live: { simulator: 'iracing', sessionId: 's', pitLimiterActive: false, onTrack: true, telemetryAgeMs: 100, fresh: true }, test: null });
    runtime.activateScene('white');
    await settle();
    assert.deepEqual(cockpit().color, WHITE);
    runtime.onEvent(event('pitLimiter.changed', { active: true }));
    await settle();
    assert.deepEqual(cockpit().color, BLUE);
    runtime.onEvent(event('pitLimiter.changed', { active: false }));
    await settle();
    assert.deepEqual(cockpit().color, WHITE);
    runtime.changeZone('cockpit', { color: RED });
    await settle();
    assert.deepEqual(cockpit().color, RED);
    runtime.onEvent(event('pitLimiter.changed', { active: true }));
    await settle();
    assert.deepEqual(cockpit().color, BLUE);
    // A manual change during the override updates the baseline, not the override
    runtime.changeZone('cockpit', { brightness: 40 });
    await settle();
    assert.deepEqual(cockpit().color, BLUE);
    runtime.onEvent(event('pitLimiter.changed', { active: false }));
    await settle();
    assert.deepEqual(cockpit().color, RED);
    assert.equal(cockpit().brightness, 40);
  });

  test('duplicates and late events are dropped; a session ending restores the baseline', async () => {
    const { runtime, cockpit } = makeRuntime();
    runtime.onSnapshot({ schemaVersion: 1, epoch: 'ep1', sequence: seq, serverTimeUtc: new Date().toISOString(), live: { simulator: 'iracing', sessionId: 's', pitLimiterActive: false, onTrack: true, telemetryAgeMs: 0, fresh: true }, test: null });
    const on = event('pitLimiter.changed', { active: true });
    const late = { ...event('pitLimiter.changed', { active: false }), sequence: on.sequence - 1 };
    assert.equal(runtime.onEvent(on), true);
    assert.equal(runtime.onEvent(on), false, 'duplicate');
    assert.equal(runtime.onEvent(late), false, 'out of order');
    assert.equal(runtime.onEvent({ ...event('pitLimiter.changed', { active: false }), epoch: 'other' }), false, 'another server');
    await settle();
    assert.deepEqual(cockpit().color, BLUE);
    runtime.onEvent(event('session.ended', { reason: 'collectorClosed' }));
    await settle();
    assert.notDeepEqual(cockpit().color, BLUE);
  });

  test('the collector going quiet restores the baseline after the stale timeout', async () => {
    const { runtime, cockpit } = makeRuntime();
    runtime.config.settings.staleTelemetryMs = 1000;
    runtime.onSnapshot({ schemaVersion: 1, epoch: 'ep1', sequence: seq, serverTimeUtc: new Date().toISOString(), live: { simulator: 'iracing', sessionId: 's', pitLimiterActive: true, onTrack: true, telemetryAgeMs: 0, fresh: true }, test: null });
    await settle();
    assert.deepEqual(cockpit().color, BLUE);
    // The heartbeat says the collector's last update is now 2 s old
    runtime.onHeartbeat({ epoch: 'ep1', sequence: seq, serverTimeUtc: new Date().toISOString(), telemetryAgeMs: 2000, fresh: false }, Date.now());
    await runtime.apply();
    assert.notDeepEqual(cockpit().color, BLUE);
  });

  test('a controller failure leaves the zone unacknowledged, and it’s sent again', async () => {
    const { runtime, mock, cockpit } = makeRuntime();
    mock.failNext = 1;
    runtime.activateScene('blue');
    await settle();
    assert.equal(runtime.status().zones[0].acknowledged, null);
    await runtime.apply();
    assert.deepEqual(cockpit().color, BLUE);
  });

  test('the local test command needs no site and never touches live events', async () => {
    const { runtime, cockpit } = makeRuntime();
    runtime.testEvent('pitLimiter', true);
    await settle();
    assert.deepEqual(cockpit().color, BLUE);
    assert.ok(runtime.status().eventsInForce.every((e) => e.source === 'local'));
    runtime.restoreBaseline();
    await settle();
    assert.notDeepEqual(cockpit().color, BLUE);
  });

  test('a test toggles, and a flag shows only through an enabled rule', async () => {
    const { runtime, cockpit } = makeRuntime();
    assert.equal(runtime.testEvent('pitLimiter', 'toggle'), true);
    await settle();
    assert.deepEqual(cockpit().color, BLUE);
    assert.equal(runtime.testEvent('pitLimiter', 'toggle'), false);
    await settle();
    assert.notDeepEqual(cockpit().color, BLUE);
    // The yellow flag rule is off by default: the test is in force but changes nothing
    assert.equal(runtime.ruleFollows('yellowFlag'), false);
    runtime.testEvent('yellowFlag', true);
    await settle();
    assert.notDeepEqual(cockpit().color, [255, 180, 0, 0]);
    runtime.config.rules.find((r) => r.event === 'yellowFlag').enabled = true;
    runtime.testEvent('yellowFlag', true);
    await runtime.apply();
    assert.deepEqual(cockpit().color, [255, 180, 0, 0]);
  });

  test('a color key colors every enabled, unprotected zone and leaves protected ones', async () => {
    const config = allZones();
    config.settings.minChangeIntervalMs = 0;
    const runtime = new LightingRuntime(config, quiet, { save: false, state: {} });
    const mock = new MockProvider(config.controllers[0]);
    runtime.providers.set('main', mock);
    runtime.setAllOff(true);
    runtime.setColor([0, 255, 0, 0]);
    await settle();
    assert.equal(runtime.allOff, false);
    for (const zone of config.zones) {
      if (zone.protected) assert.equal(runtime.manual[zone.id], undefined, zone.id);
      else assert.deepEqual(mock.segments.get(zone.segmentId).color, [0, 255, 0, 0], zone.id);
    }
  });
});

describe('the Stream Deck profile', () => {
  const zones = defaultConfig().zones;
  const keys = streamDeckLayout(zones);
  const scenes = new Set(defaultConfig().scenes.map((s) => s.id));

  test('32 keys, one per position, every command one the agent takes', () => {
    assert.equal(keys.length, STREAM_DECK_ROWS * STREAM_DECK_COLS);
    assert.equal(new Set(keys.map((k) => `${k.row},${k.col}`)).size, 32);
    assert.equal(new Set(keys.map(streamDeckAppName)).size, 32, 'app names are unique');
    for (const k of keys) {
      const [command, a, b] = k.args.filter((x) => x !== '--notify');
      assert.match(k.icon, /^[0-9A-F]{6}$/i, k.title);
      if (command === 'scene') assert.ok(scenes.has(a), a);
      else if (command === 'zone') assert.ok(zones.some((z) => z.id === a) && b === 'toggle', a);
      else if (command === 'color') assert.ok(hexColor(a), a);
      else if (command === 'mode') assert.ok(['automatic', 'manual', 'test', 'disabled'].includes(a));
      else if (command === 'brightness') assert.ok(['increase', 'decrease'].includes(a));
      else if (command === 'test') assert.ok(a === 'pit-limiter' || (a === 'flag' && b in FLAG_TESTS), k.title);
      else if (command === 'restore') assert.ok(['baseline', 'defaults'].includes(a));
      else assert.ok(['all-on', 'all-off', 'status', 'ui'].includes(command), command);
    }
  });

  test('the plan’s keys are all there', () => {
    const commands = keys.map((k) => k.args.filter((x) => x !== '--notify').join(' '));
    for (const want of ['mode automatic', 'mode manual', 'all-on', 'all-off', 'brightness increase', 'brightness decrease', 'scene race', 'scene garage', 'scene broadcast', 'scene night', 'test pit-limiter toggle', 'test flag yellow toggle', 'restore defaults', 'status', 'zone cockpit toggle', 'color 00FF00']) {
      assert.ok(commands.includes(want), want);
    }
  });

  test('fewer zones leave the zone row filled; more are cut at six', () => {
    assert.equal(streamDeckLayout([{ id: 'a', name: 'A' }]).length, 32);
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `z${i}`, name: `Z${i}` }));
    assert.equal(streamDeckLayout(many).filter((k) => k.args[0] === 'zone').length, 6);
  });

  test('the button app’s script can’t be made to run anything else', () => {
    const script = streamDeckAppleScript('/Users/me/rc/bin/racingcoach-lighting', ['zone', `x'; rm -rf ~; echo "`, 'toggle']);
    // Shell quoting first ('\'' ends, escapes and reopens a quote), then AppleScript's (\ and " escaped)
    const line = String.raw`  do shell script "RC_LIGHTING_BUTTON=1 '/Users/me/rc/bin/racingcoach-lighting' 'zone' 'x'\\''; rm -rf ~; echo \"' 'toggle'"`;
    assert.equal(script, `try\n${line}\nend try\n`);
  });

  test('key icons are 144x144 PNGs in the key’s color', () => {
    const png = keyIconPng('0050FF');
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(png.readUInt32BE(16), KEY_ICON_SIZE);
    assert.equal(png.readUInt32BE(20), KEY_ICON_SIZE);
    const idatAt = png.indexOf('IDAT');
    const raw = inflateSync(png.subarray(idatAt + 4, idatAt + 4 + png.readUInt32BE(idatAt - 4)));
    const middle = (72 * (1 + 144 * 3)) + 1 + 72 * 3;
    assert.deepEqual([...raw.subarray(middle, middle + 3)], [0x00, 0x50, 0xff]);
    assert.throws(() => keyIconPng('blue'));
  });
});

describe('the local API', () => {
  let server;
  const port = 18750 + Math.floor(Math.random() * 1000);
  const token = 'test-token-0123456789abcdefghijklmnopqrstuvwxyz';
  before(() => {
    const config = defaultConfig();
    const runtime = new LightingRuntime(config, quiet, { save: false, state: {} });
    runtime.providers.set('main', new MockProvider(config.controllers[0]));
    server = startLocalApi(runtime, token, 'test', port);
    return new Promise((r) => server.once('listening', r));
  });
  after(() => server.close());
  const call = (path, init = {}) => fetch(`http://127.0.0.1:${port}${path}`, init);

  test('health is open; everything else needs the token', async () => {
    assert.equal((await call('/health')).status, 200);
    assert.equal((await call('/status')).status, 401);
    assert.equal((await call('/status', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    const ok = await call('/status', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).mode, 'AUTOMATIC');
  });

  test('another site in a browser is refused', async () => {
    const res = await call('/scenes/off/activate', { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: 'https://evil.example' } });
    assert.equal(res.status, 403);
  });

  test('commands work and are checked', async () => {
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    assert.equal((await call('/scenes/garage/activate', { method: 'POST', headers: auth })).status, 200);
    assert.equal((await call('/scenes/nope/activate', { method: 'POST', headers: auth })).status, 404);
    assert.equal((await call('/zones/cockpit/state', { method: 'POST', headers: auth, body: JSON.stringify({ color: '0000FF' }) })).status, 200);
    assert.equal((await call('/zones/cockpit/state', { method: 'POST', headers: auth, body: JSON.stringify({ color: 'blue' }) })).status, 400);
    assert.equal((await call('/mode', { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'manual' }) })).status, 200);
    assert.equal((await call('/mode', { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'party' }) })).status, 400);
    const flag = await call('/test/event', { method: 'POST', headers: auth, body: JSON.stringify({ event: 'yellowFlag', toggle: true }) });
    assert.deepEqual(await flag.json(), { ok: true, event: 'yellowFlag', active: true, ruleEnabled: false });
    assert.equal((await call('/test/event', { method: 'POST', headers: auth, body: JSON.stringify({ event: 'party' }) })).status, 400);
    const pit = await call('/test/pit-limiter', { method: 'POST', headers: auth, body: JSON.stringify({ toggle: true }) });
    assert.deepEqual(await pit.json(), { ok: true, active: true, ruleEnabled: true });
    assert.equal((await call('/color', { method: 'POST', headers: auth, body: JSON.stringify({ color: 'FFB400' }) })).status, 200);
    assert.equal((await call('/color', { method: 'POST', headers: auth, body: JSON.stringify({ color: 'amber' }) })).status, 400);
  });

  test('colors', () => {
    assert.deepEqual(hexColor('0000FF'), [0, 0, 255, 0]);
    assert.deepEqual(hexColor('#ffffff80'), [255, 255, 255, 128]);
    assert.equal(hexColor('blue'), null);
  });
});
