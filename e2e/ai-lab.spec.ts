// The AI Lab page in a real browser: npm run test:e2e (playwright.config.ts has the database it needs).
//
// No Mac is reachable from the tests (no local AI server or secret), so this checks what must hold whatever the
// Mac is doing: only Admins get the page and its routes, every tab renders and says plainly when something isn't
// configured or can't be reached (never a zero for something unmeasured), the cloud budget refuses a run before any
// model is called, and the Production Routing tab still has the Local AI sections.

import { expect, test, type Browser } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { POLICY_VERSIONS } from '../src/lib/policyVersions';

let db: pg.Client;
test.beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
});
test.afterAll(async () => {
  await db?.end();
});

async function signUp(browser: Browser, role: 'User' | 'Admin') {
  const email = `ai-lab-${randomUUID()}@example.test`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('/cookies');
  await page.getByRole('button', { name: 'Reject All' }).first().click();
  await expect(page.getByRole('button', { name: 'Reject All' })).toHaveCount(0);
  const response = await page.request.post('/api/auth/signup', {
    data: { userName: `${role} Lab`, emailAddress: email, password: 'correct-horse-9', preferredLanguage: 'en', acceptedPolicies: POLICY_VERSIONS },
  });
  expect(response.status()).toBe(201);
  await db.query('UPDATE racingcoach."Users" SET role = $1, email_verified_at = now() WHERE email_address = $2', [role, email]);
  return { context, page };
}

test('a User gets a 404 for the AI Lab and every one of its routes', async ({ browser }) => {
  const { context, page } = await signUp(browser, 'User');
  expect((await page.goto('/model-learning'))?.status()).toBe(404);
  for (const path of ['status', 'models', 'saved']) {
    expect((await page.request.get(`/api/admin/ai-lab/${path}`)).status(), path).toBe(404);
  }
  expect((await page.request.post('/api/admin/ai-lab/playground', { data: { target: { provider: 'Cloud', model: 'gpt-4o-mini' }, prompt: 'x' } })).status()).toBe(404);
  expect((await page.request.post('/api/admin/ai-lab/models', { data: { action: 'delete', name: 'qwen3:8b', confirm: 'qwen3:8b' } })).status()).toBe(404);
  expect((await page.request.post('/api/admin/ai-lab/webui', { data: { action: 'memories.list' } })).status()).toBe(404);
  expect((await page.request.put('/api/admin/ai-lab/settings', { data: { dailyCloudBudgetUsd: 50 } })).status()).toBe(404);
  await context.close();
});

test('an Admin sees every tab, told plainly that no Mac is set up', async ({ browser }) => {
  const { context, page } = await signUp(browser, 'Admin');
  await page.goto('/model-learning');
  const tabs = page.getByRole('tablist');
  await expect(tabs).toBeVisible();

  // Overview: services gray or red, unmeasured metrics say so
  await expect(page.getByRole('heading', { name: 'AI Lab Overview' })).toBeVisible();
  await expect(page.getByText(/No local AI server is registered|LOCAL_AI_SHARED_SECRET isn't set/)).toBeVisible();
  await expect(page.getByText('Not configured').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test Connection' })).toBeVisible();
  await page.screenshot({ path: 'test-results/ai-lab-overview.png', fullPage: true });

  // Settings: an http address is refused, an https one saved
  await page.getByLabel('Open WebUI address (Launch Open WebUI)').fill('https://ai-lab.example.test');
  await page.getByLabel('Daily cloud budget for the playground (US dollars)').fill('0');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Launch Open WebUI' })).toHaveAttribute('href', 'https://ai-lab.example.test');
  expect((await page.request.put('/api/admin/ai-lab/settings', { data: { openWebuiUrl: 'http://ai-lab.example.test' } })).status()).toBe(400);

  await tabs.getByRole('tab', { name: 'Open WebUI' }).click();
  await expect(page.getByText('Why a separate tab, not embedded here')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Launch Open WebUI' })).toHaveAttribute('target', '_blank');

  await tabs.getByRole('tab', { name: 'Models' }).click();
  await expect(page.getByText(/can't be reached|routes are off/)).toBeVisible();

  // Playground: a cloud run with the budget at $0 is refused before any model is called
  await tabs.getByRole('tab', { name: 'Playground' }).click();
  await page.getByLabel('Add a model').selectOption('Cloud|gpt-4o-mini');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByLabel('Top K').fill('40');
  await expect(page.getByText(/Not offered: OpenAI doesn't take these for gpt-4o-mini: Top K/)).toBeVisible();
  await page.getByLabel('User prompt').fill('When should I start braking for turn 1?');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByText('Cloud models are off in the AI Lab (daily budget $0).')).toBeVisible();
  const events = await db.query(`SELECT count(*)::int AS n FROM racingcoach."AiInferenceEvents" WHERE source = 'aiLab'`).catch(() => ({ rows: [{ n: 0 }] }));
  expect(events.rows[0].n).toBe(0);
  await page.screenshot({ path: 'test-results/ai-lab-playground.png', fullPage: true });

  // A saved prompt comes back
  page.once('dialog', (dialog) => dialog.accept('Turn 1 braking'));
  await page.getByRole('button', { name: 'Save prompt' }).click();
  await expect(page.getByText('Turn 1 braking')).toBeVisible();

  await tabs.getByRole('tab', { name: 'Memory' }).click();
  await expect(page.getByText('Memory is not training', { exact: false })).toBeVisible();
  await tabs.getByRole('tab', { name: 'Knowledge' }).click();
  await expect(page.getByText('qwen3-embedding:0.6b', { exact: false })).toBeVisible();
  await tabs.getByRole('tab', { name: 'Model Configurations' }).click();
  await expect(page.getByText('Configurations are never used by production AI', { exact: false })).toBeVisible();
  await tabs.getByRole('tab', { name: 'Fine-Tuning Lab' }).click();
  await expect(page.getByText('Status: planned. Nothing on this tab trains a model yet.')).toBeVisible();

  // The existing Local AI sections are on Production Routing, and the hash keeps the tab across a reload
  await tabs.getByRole('tab', { name: 'Production Routing' }).click();
  await expect(page.getByText('Local AI Server Mode').first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Production Routing' })).toHaveAttribute('aria-selected', 'true');
  await context.close();
});
