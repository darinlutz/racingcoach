// The Broadcast Director in real browsers: uploads to object storage, two paired TVs on one live session, and a recorded
// clip's whole sequence. npm run test:e2e, skipped unless these are set, as it needs more than the other browser tests:
//   E2E_DATABASE_URL            a disposable local Postgres (playwright.config.ts)
//   BROADCAST_VIDEO_S3_*        a disposable S3-compatible bucket with a CORS rule (MinIO, s3rver)
//   E2E_VIDEO_DIR               a folder of test clips: good.mp4 (H.264/AAC, 12 s), other.mov (MPEG-4, needs transcoding), notvideo.mp4
//   E2E_OPENAI_API_KEY=stub and NODE_OPTIONS=--import=<a module replacing fetch to api.openai.com on the server>, so speech
//                               answers an MP3 and the AI an error: nothing reaches a real service, and the fixed wording is used
//   E2E_BROWSER_CHANNEL=chrome or E2E_BROWSER_PATH=<Chrome for Testing>: a browser that plays H.264
//   ffmpeg and ffprobe on PATH
// docs/broadcast-director.md has a checklist for what this can't check: real voices and AI lines, Fire TV hardware.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { VIDEO_CATEGORIES } from '../src/lib/broadcastVideoCategories';
import { POLICY_VERSIONS } from '../src/lib/policyVersions';

const VIDEO_DIR = process.env.E2E_VIDEO_DIR ?? '';
test.skip(!VIDEO_DIR, 'needs E2E_VIDEO_DIR and object storage');
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

const BASE = `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const SESSION = 91_000_001;
const TRACK = { track: 'Test Circuit', trackKey: 'test circuit' };

let admin: BrowserContext;
let viewer: BrowserContext;
let driver: BrowserContext;
let tvA: Page;
let tvB: Page;
let uploadKey = '';
let liveTimer: ReturnType<typeof setInterval> | null = null;
let sessionKey = '';
let db: pg.Client;

async function signUp(browser: Browser, name: string, email: string): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: BASE });
  const response = await context.request.post('/api/auth/signup', {
    data: { userName: name, emailAddress: email, password: 'correct-horse-9', preferredLanguage: 'en', acceptedPolicies: POLICY_VERSIONS },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return context;
}

// What the collector sends twice a second: a driver going round, with a quiet race around them
function liveUpdate(sequence: number) {
  return {
    ...TRACK,
    car: 'Porsche 911 GT3 R',
    sessionType: 'Race',
    sessionName: 'RACE',
    sessionState: 4,
    sessionFlags: 0,
    onTrack: true,
    onPitRoad: false,
    lap: 5,
    pct: (sequence % 180) / 180,
    speed: 60,
    gear: 4,
    position: 2,
    incidents: 0,
    sessionTimeRemain: 1500,
    acceptsMessages: true,
    field: {
      subSessionId: SESSION,
      myCarIdx: 1,
      cars: [
        { idx: 0, pct: ((sequence + 10) % 180) / 180, rate: 0.011, lap: 5, lapsDone: 4, position: 1, classPosition: 1 },
        { idx: 1, pct: (sequence % 180) / 180, rate: 0.011, lap: 5, lapsDone: 4, position: 2, classPosition: 2 },
      ],
      drivers: [
        { idx: 0, name: 'Alex Leader', number: '1', car: 'Ferrari 296 GT3' },
        { idx: 1, name: 'Sam Driver', number: '2', car: 'Porsche 911 GT3 R' },
      ],
    },
  };
}

async function pairTv(browser: Browser, account: BrowserContext): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await page.goto('/tv');
  const code = (await page.locator('text=/^[A-Z2-9]{4}-[A-Z2-9]{4}$/').first().innerText({ timeout: 60_000 })).trim();
  const linked = await account.request.post('/api/tv/link', { data: { code } });
  expect(linked.ok(), await linked.text()).toBeTruthy();
  await expect(page.getByRole('button', { name: 'Start Broadcast' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Start Broadcast' }).click();
  await expect(page.getByRole('button', { name: 'Test sound' })).toBeVisible();
  return page;
}

async function uploadVideo(request: APIRequestContext, file: string, details: Record<string, unknown>): Promise<number> {
  const bytes = readFileSync(join(VIDEO_DIR, file));
  const created = await request.post('/api/admin/broadcast/videos', { data: { title: file, fileName: file, sizeBytes: bytes.length, contentType: 'video/mp4', ...details } });
  expect(created.status(), await created.text()).toBe(201);
  const { video, uploadUrl, contentType } = await created.json();
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes });
  expect(put.ok, `storage answered ${put.status}`).toBeTruthy();
  const done = await request.post(`/api/admin/broadcast/videos/${video.id}/complete`);
  expect(done.ok(), await done.text()).toBeTruthy();
  return video.id;
}

async function statusOf(request: APIRequestContext, id: number): Promise<string> {
  const { videos } = await (await request.get('/api/admin/broadcast/videos')).json();
  return videos.find((v: { id: number }) => v.id === id)?.status;
}

async function dashboard() {
  return (await admin.request.get('/api/admin/broadcast/director')).json();
}

const command = (data: object) => admin.request.post('/api/admin/broadcast/director', { data: { sessionKey, ...data } });
const settle = (data: object) => admin.request.put('/api/admin/broadcast/director', { data });

// Waits for the Director to be back on the map with nothing under way
async function waitForLive() {
  await expect.poll(async () => (await dashboard()).sessions[0]?.phase, { timeout: 60_000 }).toBe('LIVE');
}

const videoTime = (page: Page) => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime);

test.beforeAll(async ({ browser }) => {
  // The first account is the site owner's, by address, so it's the Admin
  admin = await signUp(browser, 'Site Owner', 'darinlutz@yahoo.com');
  viewer = await signUp(browser, 'Plain Viewer', `viewer-${Date.now()}@example.test`);
  const driverEmail = `driver-${Date.now()}@example.test`;
  driver = await signUp(browser, 'Sam Driver', driverEmail);
  db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  // Everyone may watch a Coach
  await db.query(`UPDATE racingcoach."Users" SET role = 'Coach' WHERE email_address = $1`, [driverEmail]);
  const me = await (await driver.request.post('/api/collector/key')).json();
  uploadKey = me.key;
  expect(uploadKey).toBeTruthy();
});

test.afterAll(async () => {
  if (liveTimer) clearInterval(liveTimer);
  await db?.end();
  await Promise.all([admin?.close(), viewer?.close(), driver?.close(), tvA?.context().close(), tvB?.context().close()]);
});

test('Phase 1: uploads reach storage, are checked, and appear by category', async () => {
  const ids: Record<string, number> = {};
  for (const category of VIDEO_CATEGORIES) ids[category] = await uploadVideo(admin.request, 'good.mp4', { title: `${category} clip`, category });
  for (const category of VIDEO_CATEGORIES) await expect.poll(() => statusOf(admin.request, ids[category]), { timeout: 60_000 }).toBe('ready');

  const { videos } = await (await admin.request.get('/api/admin/broadcast/videos')).json();
  const first = videos.find((v: { id: number }) => v.id === ids.ONBOARDS);
  expect(first.videoCodec).toBe('h264');
  expect(first.audioCodec).toBe('aac');
  expect(Math.round(first.durationSeconds)).toBe(12);

  const page = await admin.newPage();
  await page.goto('/admin');
  for (const category of VIDEO_CATEGORIES) await expect(page.getByTestId(`category-${category}`).getByRole('heading')).toContainText('(1)');
  await page.getByTestId('category-BLIMP').getByRole('button', { name: 'Preview' }).click();
  const preview = page.getByTestId('category-BLIMP').locator('video');
  await expect.poll(() => preview.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 20_000 }).toBeGreaterThan(0);
  await page.close();
});

test('Phase 1: what isn’t a video fails clearly, and what needs it is transcoded', async () => {
  const bad = await uploadVideo(admin.request, 'notvideo.mp4', { category: 'CRASHES' });
  await expect.poll(() => statusOf(admin.request, bad), { timeout: 60_000 }).toBe('failed');
  const refused = await admin.request.post('/api/admin/broadcast/videos', { data: { title: 'x', category: 'CRASHES', fileName: 'notes.txt', sizeBytes: 10 } });
  expect(refused.status()).toBe(415);
  const huge = await admin.request.post('/api/admin/broadcast/videos', { data: { title: 'x', category: 'CRASHES', fileName: 'big.mp4', sizeBytes: 5e9 } });
  expect(huge.status()).toBe(413);

  const other = await uploadVideo(admin.request, 'other.mov', { category: 'BLIMP', enabled: false });
  await expect.poll(() => statusOf(admin.request, other), { timeout: 120_000 }).toBe('ready');
  const { videos } = await (await admin.request.get('/api/admin/broadcast/videos')).json();
  expect(videos.find((v: { id: number }) => v.id === other).videoCodec).toBe('h264');
});

test('the library and Director answer 404 to anyone but an Admin', async () => {
  for (const url of ['/api/admin/broadcast/videos', '/api/admin/broadcast/director']) expect((await viewer.request.get(url)).status()).toBe(404);
  expect((await viewer.request.post('/api/admin/broadcast/director', { data: { action: 'returnToLive', sessionKey: 'x' } })).status()).toBe(404);
  expect((await viewer.request.get('/api/broadcast-videos/1/media')).status()).toBe(404);
});

test('Acceptance: an Onboard clip, introduced, on every TV together, and back to the map', async ({ browser }) => {
  // Manual for now, so nothing else starts; the Director still runs the normal sequence
  await settle({ autoDirector: false, minIntervalSeconds: 10, maxIntervalSeconds: 20 });
  let sequence = 0;
  const send = () =>
    fetch(`${BASE}/api/collector/live`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${uploadKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(liveUpdate(sequence++)),
    }).catch(() => undefined);
  await send();
  liveTimer = setInterval(send, 500);

  tvA = await pairTv(browser, admin);
  tvB = await pairTv(browser, viewer);
  await expect.poll(async () => (await dashboard()).sessions[0]?.viewers, { timeout: 30_000 }).toBe(2);
  const before = await dashboard();
  sessionKey = before.sessions[0].key;
  expect(before.sessions[0].source).toBe('LIVE_TRACK_MAP');

  const mapBefore = await tvA.locator('svg').count();
  const played = await command({ action: 'play', category: 'ONBOARDS' });
  expect(played.ok(), await played.text()).toBeTruthy();

  // The introduction plays first, on the map
  await expect(tvA.getByText(/onboard/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(tvA.getByTestId('recorded-footage')).toHaveCount(0);

  // Then both TVs cut to the same clip at the same place
  const label = tvA.getByTestId('recorded-footage');
  await expect(label).toBeVisible({ timeout: 30_000 });
  await expect(label).toContainText('Recorded footage');
  await expect(label).toContainText('Onboard');
  await expect(tvB.getByTestId('recorded-footage')).toBeVisible({ timeout: 5000 });
  await expect(tvA.getByText('LIVE', { exact: true })).toHaveCount(0);

  const during = await dashboard();
  expect(during.sessions[0].source).toBe('RECORDED_VIDEO');
  expect(during.sessions[0].clip.category).toBe('ONBOARDS');
  expect(during.sessions[0].commentaryHeld).toBe(true);

  await tvA.waitForTimeout(1500);
  const [a, b] = await Promise.all([videoTime(tvA), videoTime(tvB)]);
  expect(Math.abs(a - b), `TV A at ${a}, TV B at ${b}`).toBeLessThan(0.75);
  expect(a).toBeGreaterThan(0.5);

  // The map stayed mounted under the clip
  expect(await tvA.locator('svg').count()).toBe(mapBefore);

  // About eight seconds later it's over, everywhere
  await expect(label).toHaveCount(0, { timeout: 15_000 });
  await expect(tvB.getByTestId('recorded-footage')).toHaveCount(0, { timeout: 5000 });
  await expect(tvA.locator('video')).toHaveCount(0, { timeout: 5000 });
  await expect(tvA.getByText('LIVE', { exact: true })).toBeVisible();
  await waitForLive();

  const { history } = await dashboard();
  expect(history[0].status).toBe('completed');
  expect(history[0].category).toBe('ONBOARDS');
  expect(history[0].introductionText).toBeTruthy();
  const seconds = (Date.parse(history[0].endedAt) - Date.parse(history[0].startedAt)) / 1000;
  expect(seconds).toBeGreaterThan(7);
  expect(seconds).toBeLessThan(10);
});

test('a TV that reloads in the middle of a clip rejoins it where the others are', async () => {
  await waitForLive();
  await settle({ defaultClipSeconds: 12 });
  await command({ action: 'play', category: 'TVCAMERA1' });
  await expect(tvA.getByTestId('recorded-footage')).toBeVisible({ timeout: 30_000 });
  await tvB.reload();
  await expect(tvB.getByTestId('recorded-footage')).toBeVisible({ timeout: 8000 });
  await tvB.waitForTimeout(500);
  const [a, b] = await Promise.all([videoTime(tvA), videoTime(tvB)]);
  expect(Math.abs(a - b), `TV A at ${a}, TV B at ${b}`).toBeLessThan(1);
  expect(b).toBeGreaterThan(1);
  await expect(tvA.getByTestId('recorded-footage')).toHaveCount(0, { timeout: 15_000 });
  await tvB.getByRole('button', { name: 'Start Broadcast' }).click();
  await settle({ defaultClipSeconds: 8 });
});

test('all eight categories work the same way', async () => {
  for (const category of VIDEO_CATEGORIES.filter((c) => c !== 'ONBOARDS')) {
    await waitForLive();
    await settle({ defaultClipSeconds: 2, commentaryDuringVideo: false, postVideoCommentary: false });
    const played = await command({ action: 'play', category });
    expect(played.ok(), `${category}: ${await played.text()}`).toBeTruthy();
    await expect(tvA.getByTestId('recorded-footage')).toBeVisible({ timeout: 30_000 });
    expect((await dashboard()).sessions[0].clip.category).toBe(category);
    await expect(tvA.getByTestId('recorded-footage')).toHaveCount(0, { timeout: 15_000 });
  }
  await waitForLive();
  await settle({ defaultClipSeconds: 8 });
});

test('RETURN TO LIVE cuts out; SKIP drops the clip before it’s on screen', async () => {
  await waitForLive();
  await command({ action: 'play', category: 'HELICOPTER' });
  await expect(tvA.getByTestId('recorded-footage')).toBeVisible({ timeout: 30_000 });
  expect((await command({ action: 'returnToLive' })).ok()).toBeTruthy();
  await expect(tvA.getByTestId('recorded-footage')).toHaveCount(0, { timeout: 5000 });
  await waitForLive();
  expect((await dashboard()).history[0].status).toBe('cutShort');

  await command({ action: 'play', category: 'BLIMP' });
  await expect.poll(async () => (await dashboard()).sessions[0].phase, { timeout: 15_000 }).toMatch(/CLIP_PRELOADING|INTRO_/);
  expect((await command({ action: 'skip' })).ok()).toBeTruthy();
  await expect.poll(async () => (await dashboard()).history.some((h: { failureReason: string }) => h.failureReason === 'skipped'), { timeout: 5000 }).toBe(true);
  // The Director picks another by itself, even in manual mode, as it was told to skip only that one
  await expect.poll(async () => (await dashboard()).history[0].failureReason, { timeout: 15_000 }).toBeNull();
  const { history } = await dashboard();
  expect(history[0].category).not.toBe('BLIMP');
  await expect(tvA.getByTestId('recorded-footage')).toBeVisible({ timeout: 30_000 });
  await expect(tvA.getByTestId('recorded-footage')).toHaveCount(0, { timeout: 20_000 });
});

test('automatic mode inserts a clip by itself', async () => {
  await waitForLive();
  await settle({ autoDirector: true, minIntervalSeconds: 10, maxIntervalSeconds: 20 });
  const startedAfter = Date.now();
  await expect(tvA.getByTestId('recorded-footage')).toBeVisible({ timeout: 90_000 });
  const { history } = await dashboard();
  expect(history[0].trigger).toBe('auto');
  expect(Date.parse(history[0].selectedAt)).toBeGreaterThan(startedAfter);
  await settle({ autoDirector: false });
  await expect(tvA.getByTestId('recorded-footage')).toHaveCount(0, { timeout: 20_000 });
});

test('a file that’s gone never gets announced', async () => {
  await waitForLive();
  const { rows } = await db.query(`SELECT id, storage_key FROM racingcoach."BroadcastVideos" WHERE category = 'TVCAMERA3' AND status = 'ready' LIMIT 1`);
  await db.query(`UPDATE racingcoach."BroadcastVideos" SET storage_key = 'broadcast-videos/gone.mp4' WHERE id = $1`, [rows[0].id]);
  await command({ action: 'play', videoId: rows[0].id });
  await expect.poll(async () => (await dashboard()).history[0].failureReason, { timeout: 15_000 }).toBe('missingFile');
  expect((await dashboard()).history[0].introductionText).toBeNull();
  await expect(tvA.getByTestId('recorded-footage')).toHaveCount(0);
  await db.query(`UPDATE racingcoach."BroadcastVideos" SET storage_key = $2 WHERE id = $1`, [rows[0].id, rows[0].storage_key]);
});

test('a clip no TV can play ends for everyone, and the broadcast carries on', async () => {
  await waitForLive();
  const { rows: [bad] } = await db.query(`SELECT storage_key FROM racingcoach."BroadcastVideos" WHERE file_name = 'notvideo.mp4'`);
  const { rows: [clip] } = await db.query(`SELECT id, storage_key FROM racingcoach."BroadcastVideos" WHERE category = 'TVCAMERA2' AND status = 'ready' LIMIT 1`);
  await db.query(`UPDATE racingcoach."BroadcastVideos" SET storage_key = 'broadcast-videos/parked' WHERE file_name = 'notvideo.mp4'`);
  await db.query(`UPDATE racingcoach."BroadcastVideos" SET storage_key = $2 WHERE id = $1`, [clip.id, bad.storage_key]);
  await command({ action: 'play', videoId: clip.id });
  await expect.poll(async () => (await dashboard()).history[0].failureReason, { timeout: 45_000 }).toBe('playbackFailed');
  await expect(tvA.getByTestId('recorded-footage')).toHaveCount(0);
  await expect(tvA.getByText('LIVE', { exact: true })).toBeVisible();
  await db.query(`UPDATE racingcoach."BroadcastVideos" SET storage_key = $2 WHERE id = $1`, [clip.id, clip.storage_key]);
  await waitForLive();
});
