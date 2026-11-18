// The Setups page in a real browser: npm run test:e2e (playwright.config.ts has the database it needs)
//
// Signs up real accounts, sends a setup capture the way the collector does (the BMW M4 GT3 EVO's "fixed.sto" from
// scripts/fixtures/setups/), uploads a .sto in iRacing's layout (built here; iRacing's own files aren't committed),
// makes a revision, compares, and checks the Setup Engineer is refused to Bronze before any AI call. The data rules are
// tested in scripts/setups-db.test.mjs.

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';
import { POLICY_VERSIONS } from '../src/lib/policyVersions';

const fixture = fs.readFileSync(new URL('../scripts/fixtures/setups/bmwm4gt3-fixed-carsetup.yaml', import.meta.url), 'utf8');

let db: pg.Client;
test.beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
});
test.afterAll(async () => {
  await db?.end();
});

async function signUp(browser: Browser): Promise<{ context: BrowserContext; page: Page; id: number }> {
  const email = `setups-${randomUUID()}@example.test`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto('/cookies');
  await page.getByRole('button', { name: 'Reject All' }).first().click();
  const response = await page.request.post('/api/auth/signup', {
    data: { userName: 'Setup Driver', emailAddress: email, password: 'correct-horse-9', preferredLanguage: 'en', acceptedPolicies: POLICY_VERSIONS },
  });
  expect(response.status()).toBe(201);
  const { rows: [row] } = await db.query('SELECT id FROM racingcoach."Users" WHERE email_address = $1', [email]);
  // An upload key needs a confirmed address
  await db.query('UPDATE racingcoach."Users" SET email_verified_at = now() WHERE id = $1', [row.id]);
  return { context, page, id: Number(row.id) };
}

async function sendCapture(page: Page, yaml = fixture) {
  const key = await page.request.post('/api/collector/key');
  expect(key.ok()).toBe(true);
  const { key: uploadKey } = await key.json();
  const response = await page.request.post('/api/collector/setup', {
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
      yaml,
    },
  });
  expect(response.status()).toBe(200);
  return response.json();
}

function sto(): Buffer {
  const text = Buffer.from('Baseline notes\u0000', 'utf16le');
  const header = Buffer.alloc(16);
  header.writeUInt32LE(3, 0);
  header.writeUInt32LE(8 + 32 + 32 + text.length, 4);
  header.writeUInt32LE(32, 8);
  header.writeUInt32LE(text.length, 12);
  return Buffer.concat([header, Buffer.alloc(32, 0xab), Buffer.alloc(32, 0xcd), text, Buffer.alloc(8)]);
}

test('a visitor is sent to log in and comes back', async ({ page }) => {
  await page.goto('/setups?tab=compare');
  await expect(page).toHaveURL(/\/login\?next=%2Fsetups%3Ftab%3Dcompare/);
});

test('a captured setup, an uploaded .sto, a revision, a comparison and its change sheet', async ({ browser }) => {
  const { context, page } = await signUp(browser);
  const captured = await sendCapture(page);
  expect(captured.inspection).toBe('passed');

  // The sidebar's link
  await page.goto('/my-dashboard');
  const sidebar = page.locator('nav').first();
  await sidebar.hover();
  await sidebar.getByRole('link', { name: 'Setups' }).click();
  await expect(page).toHaveURL(/\/setups$/);

  // Overview
  await expect(page.getByRole('button', { name: 'fixed.sto' })).toBeVisible();
  await expect(page.getByText('As loaded')).toBeVisible();
  await expect(page.getByText('Passed').first()).toBeVisible();

  // Live Setup: the values as iRacing wrote them
  await page.getByRole('tab', { name: 'Live Setup' }).click();
  await expect(page.getByText('iRacing session info (CarSetup)').first()).toBeVisible();
  const spring = page.getByRole('row').filter({ hasText: 'Spring Rate' }).first();
  await expect(spring).toContainText('223');
  await expect(spring).toContainText('N/mm');

  // My Setups: uploading the file joins the setup iRacing loaded under that name
  await page.getByRole('tab', { name: 'My Setups' }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'fixed.sto', mimeType: 'application/octet-stream', buffer: sto() });
  await expect(page.getByText('Uploaded fixed.sto.')).toBeVisible();
  await expect(page.getByText('Partially decoded').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download original' })).toHaveCount(2); // the table's and the details'

  // A revision by hand: the wing a degree up
  await page.getByRole('button', { name: 'Create Setup Revision' }).click();
  await page.getByRole('button', { name: 'Expand all' }).click();
  await page.getByRole('spinbutton', { name: 'Wing Angle', exact: true }).fill('7');
  await page.getByRole('button', { name: 'Create revision (1)' }).click();
  await expect(page.getByRole('button', { name: 'Revision 2 · Changed by you' })).toBeVisible();

  // History: compare the capture with the new revision
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByText('Changed by you: fixed, revision 2')).toBeVisible();
  await page.getByRole('button', { name: 'Compare with' }).first().click();
  await expect(page.getByRole('heading', { name: '1 difference' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Wing Angle' }).first()).toContainText('+1 degrees');

  // The change sheet, as RacingCoach can't write a .sto iRacing accepts
  const list = await (await page.request.get('/api/setups')).json();
  const setup = list.setups.find((s: { fileName: string }) => s.fileName === 'fixed.sto');
  const sheet = await page.request.get(`/api/setups/revisions/${setup.latestRevisionId}/change-sheet`);
  expect(sheet.ok()).toBe(true);
  expect(await sheet.text()).toContain('Chassis › Rear › WingAngle: from 6 degrees  to 7 degrees');

  // Another account can't reach any of it
  const other = await signUp(browser);
  expect((await other.page.request.get(`/api/setups/${setup.id}`)).status()).toBe(404);
  expect((await other.page.request.get(`/api/setups/${setup.id}/file`)).status()).toBe(404);
  expect((await other.page.request.get(`/api/setups/revisions/${setup.latestRevisionId}`)).status()).toBe(404);
  await other.context.close();
  await context.close();
});

test('the Setup Engineer is for Silver and Gold, refused before any AI call', async ({ browser }) => {
  const { context, page } = await signUp(browser);
  const { revisionId } = await sendCapture(page);
  await page.goto('/setups?tab=engineer');
  await expect(page.getByText('The Setup Engineer is for Silver and Gold members.')).toBeVisible();
  const response = await page.request.post('/api/setups/engineer', { data: { revisionId, question: 'I have understeer on entry' } });
  expect(response.status()).toBe(403);
  expect((await response.json()).code).toBe('membershipRequired');
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM racingcoach."AiUsage" WHERE feature = 'setupEngineer'`);
  expect(rows[0].n).toBe(0);
  await context.close();
});
