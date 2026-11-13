// Live video from OBS (docs/live-video.md): the settings, the synchronization timeline, the Cloudflare Stream helpers,
// commentary held for the delayed timeline, and source guards on the routes and components (authorization, no secrets
// to browsers, the OBS video always on the TV beside the map). No Cloudflare account, OBS or simulator needed.
// npm run test:live-video

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPublicKey, createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { DEFAULT_LIVE_VIDEO_SETTINGS, parseLiveVideoSettings } from '../src/lib/liveVideo/broadcastSource.ts';
import { noteObsLive, obsLive } from '../src/lib/liveVideo/rotationLink.ts';
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
import { CommentaryQueue } from '../src/lib/tvAudio.ts';

const root = new URL('../', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');

const T0 = 1_800_000_000_000;

describe('settings', () => {
  test('off by default: the feature flag', () => {
    assert.equal(DEFAULT_LIVE_VIDEO_SETTINGS.enabled, false);
    assert.equal(parseLiveVideoSettings(null).enabled, false);
  });
  test('out of range values are clamped and unknown ones keep their value', () => {
    const s = parseLiveVideoSettings({ obsVolume: 500, duckLevel: -1, sync: { mode: 'sideways', maxBufferMs: 1e9, manualOffsetMs: 1e9 } });
    assert.equal(s.obsVolume, 100);
    assert.equal(s.duckLevel, 0);
    assert.equal(s.sync.mode, DEFAULT_LIVE_VIDEO_SETTINGS.sync.mode);
    assert.equal(s.sync.maxBufferMs, 90_000);
    assert.equal(s.sync.manualOffsetMs, 90_000);
  });
  test('settings saved while the site still chose a camera are read without the camera', () => {
    const saved = { enabled: true, autoMode: false, rotation: { enabled: true, obsSeconds: 30, mapSeconds: 30 }, preferences: { finish: 'OBS_LIVE' }, obsVolume: 40 };
    const s = parseLiveVideoSettings(saved);
    assert.deepEqual(Object.keys(s).sort(), ['duckLevel', 'enabled', 'liveRacingEnabled', 'obsVolume', 'sync']);
    assert.equal(s.enabled, true);
    assert.equal(s.obsVolume, 40);
  });
});

describe('the Broadcast Director hears that OBS is on the TVs', () => {
  test('live while the TVs keep asking, gone when they stop or the stream does', () => {
    assert.equal(obsLive('none', T0), false);
    noteObsLive('s', true, T0);
    assert.equal(obsLive('s', T0 + 5000), true);
    assert.equal(obsLive('s', T0 + 11_000), false, 'nobody watching for 10 s');
    noteObsLive('s', true, T0 + 12_000);
    noteObsLive('s', false, T0 + 13_000);
    assert.equal(obsLive('s', T0 + 13_000), false);
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
  test('the TV always shows the OBS video beside the map, and clips take the map’s panel only', () => {
    const tv = read('src/components/TvBroadcast.tsx');
    assert.match(tv, /data-testid="tv-obs-panel"[\s\S]*<TvObsPanel[\s\S]*data-testid="tv-map-panel"[\s\S]*<BroadcastVideoSwitcher[\s\S]*<TvMap/, 'the video, then the map under the clips');
    const clips = tv.slice(tv.indexOf('<BroadcastVideoSwitcher'), tv.indexOf('</BroadcastVideoSwitcher>'));
    assert.ok(!/TvObsPanel|LiveOBSPlayer/.test(clips), 'a recorded clip never covers the OBS video');
    const panel = read('src/components/TvObsPanel.tsx');
    assert.match(panel, /<LiveOBSPlayer/);
    assert.ok(!/opacity|active=/.test(panel.replace(/\/\/.*$/gm, '')), 'nothing hides or pauses the player');
    assert.ok(!/TRACK_MAP|OBS_LIVE|cameraAt|switchAt/.test(read('src/lib/liveVideo/broadcastSourceRuntime.ts')), 'no camera is chosen on the server');
  });
  test('the TV’s inputs strip has the bars, wheel and gear, and no scrolling trace', () => {
    const inputs = read('src/components/TvInputs.tsx');
    assert.match(inputs, /<Pedal label=\{t\.liveRacing\.throttle\}[\s\S]*<WheelGraphic[\s\S]*<Pedal label=\{t\.liveRacing\.brake\}[\s\S]*<GearDisplay/);
    assert.ok(!/trace|<path/.test(inputs.replace(/\/\/.*$/gm, '')), 'no throttle and brake trace');
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
