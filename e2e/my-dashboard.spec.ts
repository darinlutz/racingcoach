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
  await visitorPage.goto('/');
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

test('a new account picks a country with its flag, changes it in My Settings, and My Dashboard shows the flag', async ({ browser }) => {
  const email = `dash-${randomUUID()}@example.test`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await answerCookieBanner(page);
  await page.goto('/signup');
  await expect(page.locator('#country')).toHaveText('Not Specified');
  await page.locator('#country').click();
  const countries = page.getByRole('listbox', { name: 'Country' }).getByRole('option');
  await expect(countries).toHaveCount(251);
  // A whole name: "braz" also finds Congo - Brazzaville, as the browser's region names call it
  await page.getByRole('combobox', { name: 'Search countries' }).fill('brazil');
  await expect(countries).toHaveCount(1);
  await expect(countries.filter({ hasText: 'Brazil' }).locator('.fi-br')).toBeVisible();
  // Enter picks the country and doesn't submit the form
  await page.getByRole('combobox', { name: 'Search countries' }).press('Enter');
  await expect(page.locator('#country')).toHaveText('Brazil');
  await expect(page).toHaveURL(/\/signup/);
  await page.locator('#userName').fill('Flag Driver');
  await page.locator('#emailAddress').fill(email);
  await page.locator('#password').fill('correct-horse-9');
  await page.getByRole('button', { name: 'Create Account' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/signup'));
  const { rows: [row] } = await db.query('SELECT country FROM racingcoach."Users" WHERE email_address = $1', [email]);
  expect(row.country).toBe('BR');

  await page.goto('/my-dashboard');
  await expect(page.getByRole('heading', { level: 1 }).getByRole('img', { name: 'Brazil' })).toBeVisible();

  // Under the Preferred Language in My Settings
  await page.goto('/account');
  await expect(page.locator('#country')).toHaveText('Brazil');
  await page.locator('#country').click();
  await page.getByRole('option', { name: 'Germany' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.goto('/my-dashboard');
  await expect(page.getByRole('heading', { level: 1 }).getByRole('img', { name: 'Germany' })).toBeVisible();

  await page.goto('/account');
  await page.locator('#country').click();
  await page.getByRole('option', { name: 'Not Specified' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.goto('/my-dashboard');
  await expect(page.getByRole('heading', { level: 1 }).getByRole('img')).toHaveCount(0);
  await context.close();
});

test('an account made without a country is Not Specified, and a made-up one is refused', async ({ browser }) => {
  const { context, page, id } = await signUp(browser, 'Plain Driver');
  const { rows: [row] } = await db.query('SELECT country FROM racingcoach."Users" WHERE id = $1', [id]);
  expect(row.country).toBeNull();
  const response = await page.request.put('/api/preferences', { data: { country: 'Narnia' } });
  expect(response.status()).toBe(400);
  await context.close();
});

// A small picture twice as wide as it's tall: red on the left half, blue on the right
const WIDE_PNG = async (page: Page) =>
  Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 200;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#ff0000';
      context.fillRect(0, 0, 200, 200);
      context.fillStyle = '#0000ff';
      context.fillRect(200, 0, 200, 200);
      return canvas.toDataURL('image/png').split(',')[1];
    }),
    'base64'
  );

test('a driver swaps the helmet for their own scaled picture, only they can load it, and can go back', async ({ browser }) => {
  const me = await signUp(browser, 'Photo Driver');
  await me.page.goto('/my-dashboard');
  await expect(me.page.getByRole('img', { name: "Driver's red racing helmet" })).toBeVisible();
  await expect(me.page.getByRole('button', { name: 'Remove your picture' })).toHaveCount(0);

  // The camera icon opens the computer's file picker
  const [chooser] = await Promise.all([me.page.waitForEvent('filechooser'), me.page.getByRole('button', { name: 'Change your picture' }).click()]);
  await chooser.setFiles({ name: 'me.png', mimeType: 'image/png', buffer: await WIDE_PNG(me.page) });
  const dialog = me.page.getByRole('dialog', { name: 'Position your picture' });
  await expect(dialog).toBeVisible();

  // Dragged as far right as it goes, the frame shows only the red half
  const frame = dialog.getByRole('group');
  const box = (await frame.boundingBox())!;
  await me.page.mouse.move(box.x + 20, box.y + box.height / 2);
  await me.page.mouse.down();
  await me.page.mouse.move(box.x + box.width + 300, box.y + box.height / 2, { steps: 5 });
  await me.page.mouse.up();
  await dialog.getByRole('slider').fill('1');
  await dialog.getByRole('button', { name: 'Save Picture' }).click();
  await expect(dialog).toHaveCount(0);

  const picture = me.page.getByRole('img', { name: 'Your driver picture' });
  await expect(picture).toBeVisible();
  await expect(me.page.getByRole('img', { name: "Driver's red racing helmet" })).toHaveCount(0);
  const seen = await picture.evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(img, 0, 0);
    const pixel = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data);
    return { width: img.naturalWidth, height: img.naturalHeight, left: pixel(20, 256), right: pixel(490, 256) };
  });
  expect(seen).toMatchObject({ width: 512, height: 512 });
  for (const pixel of [seen.left, seen.right]) {
    expect(pixel[0]).toBeGreaterThan(200);
    expect(pixel[2]).toBeLessThan(60);
  }

  // It stays after a reload
  await me.page.reload();
  await expect(me.page.getByRole('img', { name: 'Your driver picture' })).toBeVisible();

  // A visitor can't load it, and nobody can upload something that isn't a JPEG
  const visitor = await browser.newContext();
  expect((await visitor.request.get('/api/account/picture')).status()).toBe(401);
  await visitor.close();
  const other = await signUp(browser, 'Other Driver');
  expect((await other.page.request.get(`/api/account/picture?userId=${me.id}`)).status()).toBe(404);
  await other.context.close();
  const refused = await me.page.request.put('/api/account/picture', {
    multipart: { file: { name: 'x.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('<svg onload="alert(1)"></svg>') } },
  });
  expect(refused.status()).toBe(415);

  // Something that isn't a picture is turned down in the browser
  const [notPicture] = await Promise.all([me.page.waitForEvent('filechooser'), me.page.getByRole('button', { name: 'Change your picture' }).click()]);
  await notPicture.setFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('not a picture') });
  await expect(me.page.getByRole('alert').filter({ hasText: 'can’t be read as a picture' })).toBeVisible();

  await me.page.getByRole('button', { name: 'Remove your picture' }).click();
  await me.page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(me.page.getByRole('img', { name: "Driver's red racing helmet" })).toBeVisible();
  const { rows } = await db.query('SELECT 1 FROM racingcoach."UserPictures" WHERE user_id = $1', [me.id]);
  expect(rows).toHaveLength(0);
  await me.context.close();
});

test('deleting an account deletes its picture', async ({ browser }) => {
  const { context, page, id } = await signUp(browser, 'Leaving Driver');
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const saved = await page.request.put('/api/account/picture', { multipart: { file: { name: 'x.jpg', mimeType: 'image/jpeg', buffer: jpeg } } });
  expect(saved.status()).toBe(200);
  // As the Delete Account dialog sends it: the typed word and the password (a step-up sign-in)
  const deleted = await page.request.delete('/api/account', { data: { confirm: 'DELETE', password: 'correct-horse-9' } });
  expect(deleted.status()).toBe(200);
  const { rows } = await db.query('SELECT 1 FROM racingcoach."UserPictures" WHERE user_id = $1', [id]);
  expect(rows).toHaveLength(0);
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
