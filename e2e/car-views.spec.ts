// The engineering car drawings' Admin flow in a real browser: npm run test:e2e (playwright.config.ts has the database
// it needs; docs/car-views.md)
//
// An Admin uploads a car's drawings (the generic car's markup stands in for a real car's), an unsafe file is refused
// with the reason, the version goes through review to active, a driver's page reads it back by its exact car path, and
// the Admin preview shows the debug marks. Anyone but an Admin gets 404. Its own car path, so the Setups test's car
// stays generic.

import { expect, test, type Browser } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { genericSources } from '../src/lib/carViews/genericVehicle';
import { POLICY_VERSIONS } from '../src/lib/policyVersions';

let db: pg.Client;
test.beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
});
test.afterAll(async () => {
  await db?.end();
});

async function signUp(browser: Browser, role: 'Admin' | 'User') {
  const email = `car-views-${randomUUID()}@example.test`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto('/cookies');
  await page.getByRole('button', { name: 'Reject All' }).first().click();
  const response = await page.request.post('/api/auth/signup', {
    data: { userName: `${role} Tester`, emailAddress: email, password: 'correct-horse-9', preferredLanguage: 'en', acceptedPolicies: POLICY_VERSIONS },
  });
  expect(response.status()).toBe(201);
  await db.query('UPDATE racingcoach."Users" SET email_verified_at = now(), role = $2 WHERE email_address = $1', [email, role]);
  return { context, page };
}

test('an Admin uploads, reviews and activates a car’s drawings, and a driver’s page gets them by car path', async ({ browser }) => {
  const admin = await signUp(browser, 'Admin');
  const carKey = `e2ecar${randomUUID().slice(0, 8)}`;
  const {
    rows: [car],
  } = await db.query(`INSERT INTO racingcoach."Cars" (car_name) VALUES ($1) RETURNING id`, [`E2E Car ${carKey}`]);
  const sources = genericSources();
  const views = { front: { svg: sources.front.source, anchors: sources.front.anchors }, top: { svg: sources.top.source, anchors: sources.top.anchors } };

  // An unsafe drawing is refused, with the reason, before anything is saved
  const unsafe = await admin.page.request.post('/api/admin/car-views', {
    data: { carId: car.id, carKeys: [carKey], views: { rear: { svg: sources.rear.source.replace('</svg>', '<script>alert(1)</script></svg>'), anchors: sources.rear.anchors } } },
  });
  expect(unsafe.status()).toBe(400);
  expect((await unsafe.json()).problems.join(' ')).toContain('script');

  const saved = await admin.page.request.post('/api/admin/car-views', { data: { carId: car.id, carKeys: [carKey], views, sources: 'Generic car (test)', license: 'Own work' } });
  expect(saved.status()).toBe(201);
  const { id, version } = await saved.json();
  expect(version).toBe(1);

  const before = await admin.page.request.get(`/api/car-views?carKey=${carKey}`);
  expect((await before.json()).asset).toBeNull();
  expect((await admin.page.request.put(`/api/admin/car-views/${id}`, { data: { action: 'approve' } })).status()).toBe(409);
  for (const action of ['submit', 'approve', 'activate']) {
    expect((await admin.page.request.put(`/api/admin/car-views/${id}`, { data: { action } })).status()).toBe(200);
  }

  // A driver's page reads the active version by the exact car path
  const driver = await signUp(browser, 'User');
  const active = await (await driver.page.request.get(`/api/car-views?carKey=${carKey.toUpperCase()}`)).json();
  expect(active.asset.version).toBe(1);
  expect(Object.keys(active.asset.views).sort()).toEqual(['front', 'top']);
  expect((await (await driver.page.request.get(`/api/car-views?carKey=${carKey}x`)).json()).asset).toBeNull();
  expect((await driver.page.request.get('/api/admin/car-views')).status()).toBe(404);
  expect((await driver.page.request.put(`/api/admin/car-views/${id}`, { data: { action: 'deactivate' } })).status()).toBe(404);

  // The Admin page lists it, and its preview shows every view with the debug marks
  await admin.page.goto('/admin');
  const section = admin.page.locator('#engineering-car-drawings');
  await expect(section.getByRole('heading', { name: 'Engineering Car Drawings' })).toBeVisible();
  // The list loads after the page, with every other Admin section's requests. The versions list's row (the repository panel's car pickers name every car too, but have no Preview)
  const previewButton = admin.page.getByRole('button', { name: /^(Preview|Hide preview)$/ });
  const row = section.locator('li').filter({ hasText: `E2E Car ${carKey}`, has: previewButton });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect(row.getByText('Active', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Preview' }).click();
  await expect(row.locator('[data-car-debug="front"]')).toBeVisible();
  await expect(row.locator('[data-car-view="front"][data-car-source="approved"]')).toBeVisible();
  // The views it hasn't got show the generic car, labelled
  await expect(row.locator('[data-car-view="rear"][data-car-source="generic"]')).toBeVisible();
  await expect(row.locator('[data-car-debug="front"]').getByText('RF Wheel')).toBeVisible();

  // The repository's drawings: the Huracán imports as a draft of Car Data's car and previews as its own drawing
  const importButton = admin.page.getByRole('button', { name: 'Import as draft' });
  const huracan = section.locator('li').filter({ hasText: 'lamborghinievogt3', has: importButton });
  await expect(huracan).toBeVisible();
  await expect(section.locator('li').filter({ hasText: 'ferrari296gt3', has: importButton })).toBeVisible();
  await huracan.getByRole('button', { name: 'Import as draft' }).click();
  await expect(section.getByText(/Imported as version \d+\./)).toBeVisible({ timeout: 30_000 });
  const draft = section
    .locator('li')
    .filter({ hasText: 'lamborghinievogt3', has: previewButton })
    .first();
  await expect(draft.getByText('Draft', { exact: true })).toBeVisible();
  await draft.getByRole('button', { name: 'Preview', exact: true }).click();
  for (const view of ['left-side', 'right-side', 'top', 'front', 'rear']) {
    await expect(draft.locator(`[data-car-view="${view}"][data-car-source="preview"]`)).toBeVisible();
  }

  await admin.context.close();
  await driver.context.close();
});
