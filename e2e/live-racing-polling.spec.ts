// How often the Live Racing page asks for the live drivers, in a real browser: npm run test:e2e (playwright.config.ts
// has the database it needs)
//
// The page asks every second while someone is live. With nobody live it asks less often, and once its sign-in has
// ended it nearly stops: a display left open for days otherwise asks the server every second for good (seen on the
// live site: 18 hours of 401 answers, one a second). The counts allow for a slow machine, which only lowers them.

import { expect, test } from '@playwright/test';
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

test('the page asks less often with nobody live, and nearly stops once signed out', async ({ browser }) => {
  const email = `live-${randomUUID()}@example.test`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const signup = await page.request.post('/api/auth/signup', {
    data: { userName: 'Live Viewer', emailAddress: email, password: 'correct-horse-9', preferredLanguage: 'en', acceptedPolicies: POLICY_VERSIONS },
  });
  expect(signup.status()).toBe(201);

  const answers: number[] = [];
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/api/live') answers.push(response.status());
  });
  await page.goto('/live-racing');
  await expect.poll(() => answers.length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(answers[0]).toBe(200);

  // Nobody is live: every 3 s, so about 4 in 12 s (it was 12)
  const idleFrom = answers.length;
  await page.waitForTimeout(12_000);
  const idle = answers.length - idleFrom;
  expect(idle, 'still asking while idle').toBeGreaterThanOrEqual(2);
  expect(idle, 'asked every second with nobody live').toBeLessThanOrEqual(6);

  // The sign-in ends (as after a week): the next answer is 401, and the page then waits 30 s between asks
  await db.query('DELETE FROM racingcoach."Sessions" WHERE user_id = (SELECT id FROM racingcoach."Users" WHERE email_address = $1)', [email]);
  await expect.poll(() => answers.includes(401), { timeout: 15_000 }).toBe(true);
  const signedOutFrom = answers.length;
  await page.waitForTimeout(10_000);
  expect(answers.length - signedOutFrom, 'kept asking every second after the sign-in ended').toBeLessThanOrEqual(1);
  await context.close();
});
