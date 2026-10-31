// My Dashboard in a real browser: npm run test:e2e (playwright.config.ts has the database it needs)
//
// Signs up real accounts and gives them laps directly in the disposable database; the queries themselves are tested
// in scripts/my-dashboard-db.test.mjs.

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
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

// The cookie banner would otherwise sit over what the tests click
async function answerCookieBanner(page: Page) {
  await page.goto('/cookies');
  await page.getByRole('button', { name: 'Reject All' }).first().click();
  await expect(page.getByRole('button', { name: 'Reject All' })).toHaveCount(0);
}

async function signUp(browser: Browser, name: string, viewport = { width: 1440, height: 900 }): Promise<{ context: BrowserContext; page: Page; id: number; email: string }> {
  const email = `dash-${randomUUID()}@example.test`;
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await answerCookieBanner(page);
  const response = await page.request.post('/api/auth/signup', {
    data: { userName: name, emailAddress: email, password: 'correct-horse-9', preferredLanguage: 'en', acceptedPolicies: POLICY_VERSIONS },
  });
  expect(response.status()).toBe(201);
  const { rows: [row] } = await db.query('SELECT id FROM racingcoach."Users" WHERE email_address = $1', [email]);
  return { context, page, id: Number(row.id), email };
}

const addLap = (userId: number, car: string, track: string, lapNumber: number) =>
  db.query(
    `INSERT INTO racingcoach."CollectorLaps" (user_id, client_lap_id, track, car, driver, iracing_session_id, iracing_subsession_id,
       session_num, session_type, lap_number, lap_time_seconds, sample_count, missing_samples, incidents, pit_road, off_track,
       recorded_at, completed_at, expires_at, csv_bytes, csv_gzip)
     VALUES ($1, gen_random_uuid(), $2, $3, 'x', 77, 77, 0, 'Race', $4, 60, 3, 0, 0, false, false,
       now() - interval '2 hours', now() - interval '2 hours', now() + interval '20 days', 100, '\\x00')`,
    [userId, track, car, lapNumber]
  );

test('a visitor is sent to log in and comes back', async ({ page }) => {
  await page.goto('/my-dashboard');
  await expect(page).toHaveURL(/\/login\?next=%2Fmy-dashboard/);
});

test("the nav bar's link is My Dashboard, not Toolkit, and asks visitors to log in", async ({ browser }) => {
  const { context, page } = await signUp(browser, 'Nav Driver');
  await page.goto('/racing');
  const sidebar = page.locator('nav').first();
  await sidebar.hover();
  await expect(sidebar.getByRole('link', { name: 'My Dashboard' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Toolkit' })).toHaveCount(0);
  await sidebar.getByRole('link', { name: 'My Dashboard' }).click();
  await expect(page).toHaveURL(/\/my-dashboard$/);
  await context.close();

  const visitor = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const visitorPage = await visitor.newPage();
  await answerCookieBanner(visitorPage);
  await visitorPage.goto('/learning');
  await visitorPage.locator('nav').first().hover();
  await visitorPage.locator('nav').first().getByRole('link', { name: 'My Dashboard' }).click();
  await expect(visitorPage.getByRole('dialog')).toBeVisible();
  await visitor.close();
});

test('a new driver sees their profile, an empty state and zeros, and My Settings goes to the settings page', async ({ browser }) => {
  const { context, page, email } = await signUp(browser, 'Ayrton Example');
  await page.goto('/my-dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Ayrton\s*Example/i);
  await expect(page.getByRole('heading', { name: 'No laps yet' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Install the Collector' })).toHaveAttribute('href', '/installing');
  await expect(page.getByText('Bronze Member', { exact: true })).toBeVisible();
  await expect(page.getByText('Free', { exact: true })).toBeVisible();
  await expect(page.getByText(`${email[0]}•••••@example.test`)).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toHaveCount(0);
  // Bronze is current; the others are there but not marked current
  await expect(page.locator('[aria-current="true"]')).toHaveCount(1);
  await expect(page.locator('[aria-current="true"]').getByRole('img', { name: 'Bronze membership trophy' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Gold membership trophy' })).toBeVisible();
  await page.getByRole('link', { name: 'My Settings' }).last().click();
  await expect(page).toHaveURL(/\/account$/);
  await context.close();
});

test("a driver sees their own laps and subscription, never another driver's", async ({ browser }) => {
  const me = await signUp(browser, 'Driver Mine');
  const other = await signUp(browser, 'Driver Theirs');
  await addLap(me.id, 'Ferrari 296 GT3', 'Mine Raceway (Grand Prix)', 1);
  await addLap(me.id, 'Ferrari 296 GT3', 'Mine Raceway (Grand Prix)', 2);
  await addLap(other.id, 'Theirs Car', 'Theirs Raceway', 1);
  await db.query(
    `UPDATE racingcoach."Users" SET membership_level = 'Gold', account_status = 'Subscribed', stripe_subscription_id = $2, stripe_customer_id = 'cus_x',
       subscription_end_date = $3 WHERE id = $1`,
    [me.id, `sub_${me.id}`, new Date(Date.now() + 86400_000 * 20).toISOString()]
  );

  await me.page.goto('/my-dashboard');
  await expect(me.page.getByRole('heading', { name: 'Ferrari 296 GT3' })).toBeVisible();
  await expect(me.page.getByRole('img', { name: 'Ferrari 296 GT3' })).toBeVisible();
  await expect(me.page.getByText('Mine Raceway', { exact: true })).toBeVisible();
  await expect(me.page.getByText('Grand Prix configuration')).toBeVisible();
  await expect(me.page.getByText('Avg 2 laps / session')).toBeVisible();
  await expect(me.page.getByText('Theirs')).toHaveCount(0);
  await expect(me.page.getByText('Gold Member', { exact: true })).toBeVisible();
  await expect(me.page.getByText('Active', { exact: true })).toBeVisible();
  await expect(me.page.getByText('Renews', { exact: true })).toBeVisible();
  await expect(me.page.getByRole('link', { name: 'Manage Subscription' })).toHaveAttribute('href', '/account#subscription');
  await expect(me.page.getByRole('link', { name: 'View My Sessions' })).toHaveAttribute('href', '/racing');
  // There's no parameter to ask for someone else
  await me.page.goto(`/my-dashboard?userId=${other.id}`);
  await expect(me.page.getByRole('heading', { level: 1 })).toHaveText(/Driver\s*Mine/i);
  await expect(me.page.getByText('Theirs')).toHaveCount(0);

  // A past-due payment isn't shown as active
  await db.query(
    `INSERT INTO racingcoach."StripeSubscriptions" (stripe_subscription_id, user_id, stripe_customer_id, livemode, plan, status, currency, start_date, current_period_end)
     VALUES ($1, $2, 'cus_x', false, 'gold_monthly', 'past_due', 'usd', now(), now() + interval '3 days')`,
    [`sub_${me.id}`, me.id]
  );
  await me.page.reload();
  await expect(me.page.getByText('Payment past due')).toBeVisible();
  await expect(me.page.getByText('Active', { exact: true })).toHaveCount(0);
  await me.context.close();
  await other.context.close();
});

test('it reflects a language changed in My Settings', async ({ browser }) => {
  const { context, page } = await signUp(browser, 'Lingua Driver');
  await page.goto('/my-dashboard');
  await expect(page.getByText('English').first()).toBeVisible();
  await page.getByRole('link', { name: 'My Settings' }).last().click();
  await page.locator('#preferredLanguage').selectOption('pt');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt');
  await page.goto('/my-dashboard');
  await expect(page.getByText('Português').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Minha assinatura' })).toBeVisible();
  await context.close();
});

for (const [name, width, height] of [['phone', 375, 800], ['tablet', 800, 1000], ['desktop', 1440, 900]] as const) {
  test(`fits a ${name} without scrolling sideways, even with a long name`, async ({ browser }) => {
    const { context, page } = await signUp(browser, 'Maximiliano Wolfeschlegelsteinhausen', { width, height });
    await page.goto('/my-dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });
}

test('sections are labeled, in order, and images have text alternatives', async ({ browser }) => {
  const { context, page } = await signUp(browser, 'Access Driver');
  await page.goto('/my-dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Driver profile' })).toBeVisible();
  for (const section of ['Last On Track', 'My Racing Statistics', 'My Membership', 'My Account']) {
    await expect(page.getByRole('region', { name: section })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: section })).toBeVisible();
  }
  await expect(page.locator('.my-dashboard img:not([alt])')).toHaveCount(0);
  await expect(page.getByRole('img', { name: "Driver's red racing helmet" })).toBeVisible();
  // The keyboard reaches My Settings
  await page.getByRole('link', { name: 'My Settings' }).last().focus();
  await expect(page.getByRole('link', { name: 'My Settings' }).last()).toBeFocused();
  await context.close();
});
