// The 3D car models in a real browser: npm run test:e2e (playwright.config.ts has the database and the local folder the
// files go in; docs/car-models.md)
//
// An Admin uploads the test car GLB (scripts/testCarGlb.mjs) for the BMW M4 GT3 EVO, sets it up and takes it through
// review to active; then a driver gets it, and only it, from the file route with a cache-forever header, sees it in the
// Setups page's Suspension tab's Interactive 3D view (rotated, a camera preset, a corner picked), and another car
// gets the generic car. The rules and the database are tested in scripts/car-models*.test.mjs.

import { expect, test, type Browser, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';
import { POLICY_VERSIONS } from '../src/lib/policyVersions';
import { testCarGlb } from '../scripts/testCarGlb.mjs';

const fixture = fs.readFileSync(new URL('../scripts/fixtures/setups/bmwm4gt3-fixed-carsetup.yaml', import.meta.url), 'utf8');

let db: pg.Client;
test.beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
});
test.afterAll(async () => {
  await db?.end();
});

async function signUp(browser: Browser, role: 'Admin' | 'User') {
  const email = `models-${randomUUID()}@example.test`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto('/cookies');
  await page.getByRole('button', { name: 'Reject All' }).first().click();
  const response = await page.request.post('/api/auth/signup', {
    data: { userName: `${role} Driver`, emailAddress: email, password: 'correct-horse-9', preferredLanguage: 'en', acceptedPolicies: POLICY_VERSIONS },
  });
  expect(response.status()).toBe(201);
  const { rows: [row] } = await db.query('UPDATE racingcoach."Users" SET email_verified_at = now(), role = $2 WHERE email_address = $1 RETURNING id', [email, role]);
  return { context, page, id: Number(row.id) };
}

async function bmw(): Promise<number> {
  const { rows } = await db.query(`SELECT id FROM racingcoach."Cars" WHERE lower(car_name) LIKE 'bmw m4 gt3%' ORDER BY id LIMIT 1`);
  if (rows[0]) return Number(rows[0].id);
  const { rows: [made] } = await db.query(`INSERT INTO racingcoach."Cars" (car_name) VALUES ('BMW M4 GT3 EVO') RETURNING id`);
  return Number(made.id);
}

async function uploadAndActivate(page: Page, carId: number) {
  // The same file each run would be a duplicate: a distinct generator string makes it a new one
  const bytes = Buffer.from(testCarGlb());
  bytes.write(randomUUID().slice(0, 20), bytes.indexOf('RacingCoach test car'));
  const response = await page.request.post('/api/admin/car-models', {
    multipart: {
      carId: String(carId),
      carKeys: 'bmwm4gt3',
      source: 'RacingCoach test car (scripts/testCarGlb.mjs)',
      license: 'CC-BY-4.0',
      attribution: 'Test car by RacingCoach, CC BY 4.0',
      notes: '',
      file: { name: 'test-car.glb', mimeType: 'model/gltf-binary', buffer: bytes },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const { id } = await response.json();
  return id as number;
}

test.setTimeout(1_200_000);
test('an Admin uploads, reviews and activates a model; drivers get only the active one', async ({ browser }) => {
  const admin = await signUp(browser, 'Admin');
  const carId = await bmw();
  const id = await uploadAndActivate(admin.page, carId);

  const driver = await signUp(browser, 'User');
  // Uploaded: an Admin may preview the file, a driver may not, and drivers aren't told about it
  expect((await admin.page.request.get(`/api/car-models/${id}/file`)).status()).toBe(200);
  expect((await driver.page.request.get(`/api/car-models/${id}/file`)).status()).toBe(404);
  expect((await (await driver.page.request.get('/api/car-models?carKey=bmwm4gt3')).json()).model?.id).not.toBe(id);

  // The Admin page's preview of it, in WebGL
  for (const p of [admin.page, driver.page]) {
    p.on('pageerror', (e) => console.log(`page error: ${e.message}`));
    p.on('console', (m) => m.type() === 'error' && !m.text().includes('Failed to load resource') && console.log(`console: ${m.text()}`));
  }
  await admin.page.goto('/admin#car-models');
  const section = admin.page.locator('#car-models');
  await expect(section.getByRole('heading', { name: '3D Car Models' })).toBeVisible();
  const row = section.locator('li').filter({ hasText: 'test-car.glb', has: admin.page.getByRole('button', { name: 'Preview' }) }).first();
  await row.getByRole('button', { name: 'Preview' }).click();
  // The first viewer waits for next dev to compile three.js and Drei
  await expect(section.locator('canvas').first())
    .toBeVisible({ timeout: 480_000 })
    .catch(async (error) => {
      await admin.page.screenshot({ path: test.info().outputPath('admin-preview.png'), fullPage: false });
      throw error;
    });
  // The model itself is in the scene, not only the canvas
  await expect(section.locator('[data-car3d="model"]')).toBeVisible({ timeout: 60_000 });
  await section.locator('[data-car3d]').screenshot({ path: test.info().outputPath('admin-preview-viewer.png') });
  await expect(section.getByText(/Model: 4\.600 m long, 2\.000 m wide/)).toBeVisible();

  for (const action of ['submit', 'approve', 'activate']) {
    const r = await admin.page.request.put(`/api/admin/car-models/${id}`, { data: { action } });
    expect(r.status(), `${action}: ${await r.text()}`).toBe(200);
  }

  const resolved = await (await driver.page.request.get('/api/car-models?carKey=bmwm4gt3')).json();
  expect(resolved.model.id).toBe(id);
  expect(resolved.resolvedBy).toBe('carKey');
  const file = await driver.page.request.get(resolved.model.url);
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toBe('model/gltf-binary');
  expect(file.headers()['cache-control']).toContain('immutable');
  expect((await file.body()).subarray(0, 4).toString()).toBe('glTF');
  // Never a similar car path, and visitors get nothing
  expect((await (await driver.page.request.get('/api/car-models?carKey=bmwm4gt3evo')).json()).model).toBeNull();
  const visitor = await browser.newContext();
  expect((await visitor.request.get(new URL(resolved.model.url, test.info().project.use.baseURL).href)).status()).toBe(404);
  await visitor.close();

  // The Suspension tab's Interactive 3D view, for a captured setup and a revision of it
  const key = await driver.page.request.post('/api/collector/key');
  const { key: uploadKey } = await key.json();
  const capture = await driver.page.request.post('/api/collector/setup', {
    headers: { Authorization: `Bearer ${uploadKey}` },
    data: {
      simulator: 'iracing',
      car: 'BMW M4 GT3 EVO',
      carKey: 'bmwm4gt3',
      track: 'Mobility Resort Motegi (Full Road Course)',
      trackKey: 'twinring fullrc',
      setupName: 'fixed.sto',
      loadType: 'iracing',
      modified: false,
      passedTech: 1,
      fixedSession: false,
      sessionId: 1,
      subSessionId: 2,
      yaml: fixture,
    },
  });
  expect(capture.status()).toBe(200);
  // A second revision, the wing a degree up, made through the API (e2e/setups.spec.ts makes one through the page)
  const { rows: [revision] } = await db.query(
    `SELECT r.id, v.path FROM racingcoach."SetupRevisions" r JOIN racingcoach."SetupValues" v ON v.revision_id = r.id
     WHERE r.user_id = $1 AND v.path LIKE '%WingAngle' ORDER BY r.id DESC LIMIT 1`,
    [driver.id]
  );
  const changed = await driver.page.request.post(`/api/setups/revisions/${revision.id}`, {
    data: { action: 'change', changes: [{ path: revision.path, value: 7 }] },
  });
  expect(changed.status(), await changed.text()).toBeLessThan(300);
  const page = driver.page;
  await page.goto('/setups');
  await expect(page.getByRole('button', { name: 'fixed.sto' }).first()).toBeVisible();
  await page.getByRole('tab', { name: 'History' }).click();
  await page.getByRole('button', { name: 'Compare with' }).first().click();
  await page.getByRole('tab', { name: 'Suspension' }).click();
  await expect(page.getByRole('heading', { name: 'Suspension: engineering comparison' })).toBeVisible();

  const fileRequests: string[] = [];
  page.on('request', (r) => r.url().includes('/api/car-models/') && r.url().includes('/file') && fileRequests.push(r.url()));
  await page.getByRole('button', { name: 'Interactive 3D' }).click();
  const viewer = page.locator('[data-car3d="model"]');
  await expect(page.getByRole('img', { name: '3D model of BMW M4 GT3 EVO' }).or(page.getByRole('img', { name: /^3D model of BMW M4 GT3/ }))).toBeVisible();
  await expect(viewer.locator('canvas')).toBeVisible();
  await expect(viewer.getByText('Wheel positions approximate')).toBeVisible();
  await expect(page.getByText('Model: Test car by RacingCoach, CC BY 4.0')).toBeVisible();
  await viewer.screenshot({ path: test.info().outputPath('suspension-3d.png') });
  // Turn it, pick a preset and a corner: the corner card below is the one selected
  const box = (await viewer.locator('canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 20, { steps: 8 });
  await page.mouse.up();
  await viewer.getByRole('button', { name: 'Top' }).click();
  await expect(viewer.getByRole('button', { name: 'Top' })).toHaveAttribute('aria-pressed', 'true');
  await viewer.getByRole('button', { name: 'RR', exact: true }).click();
  await expect(page.getByText('Selected corner: Right rear')).toBeVisible();
  await page.waitForTimeout(1500); // the camera eases to the corner
  await viewer.screenshot({ path: test.info().outputPath('suspension-3d-rr.png') });
  expect(fileRequests.length).toBeLessThanOrEqual(1);

  // The 2D drawings are still there, and the choice is kept for the visit
  await page.getByRole('button', { name: '2D Engineering' }).click();
  await expect(page.getByRole('button', { name: 'Select Right rear' })).toBeVisible();
  await page.getByRole('tab', { name: 'Brakes' }).click();
  await page.getByRole('tab', { name: 'Suspension' }).click();
  await expect(page.getByRole('button', { name: '2D Engineering' })).toHaveAttribute('aria-pressed', 'true');

  await admin.context.close();
  await driver.context.close();
});
