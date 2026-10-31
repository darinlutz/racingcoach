// Temporary screenshots for checking the page by eye. Deleted after the run.
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { POLICY_VERSIONS } from '../src/lib/policyVersions';

const OUT = process.env.SHOTS_DIR ?? '.';

test('screenshots', async ({ browser }) => {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  const email = `shots-${randomUUID()}@example.test`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('/cookies');
  await page.getByRole('button', { name: 'Reject All' }).first().click();
  await expect(page.getByRole('button', { name: 'Reject All' })).toHaveCount(0);
  const response = await page.request.post('/api/auth/signup', {
    data: { userName: 'Darin Lutz', emailAddress: email, password: 'correct-horse-9', preferredLanguage: 'en', acceptedPolicies: POLICY_VERSIONS },
  });
  expect(response.status()).toBe(201);
  const { rows: [{ id }] } = await db.query('SELECT id FROM racingcoach."Users" WHERE email_address = $1', [email]);
  const points = Array.from({ length: 500 }, (_, i) => {
    const a = (i / 500) * 2 * Math.PI;
    return [41.9 + 0.006 * Math.sin(a) * (1 + 0.3 * Math.cos(3 * a)), -73.38 + 0.01 * Math.cos(a) * (1 + 0.2 * Math.sin(2 * a))];
  });
  await db.query(
    `INSERT INTO racingcoach."Tracks" (track_key, track_name, config_name, track_length_feet, track_outline)
     VALUES ('shots gp', 'Sebring International Raceway (International)', 'International', 19000, $1)
     ON CONFLICT (lower(track_name)) DO UPDATE SET track_key = 'shots gp', track_length_feet = 19000, track_outline = $1, config_name = 'International'`,
    [JSON.stringify({ kind: 'latlon', points })]
  );
  for (let lap = 1; lap <= 24; lap++) {
    await db.query(
      `INSERT INTO racingcoach."CollectorLaps" (user_id, client_lap_id, track, track_key, car, driver, iracing_session_id, iracing_subsession_id,
         session_num, session_type, lap_number, lap_time_seconds, sample_count, missing_samples, incidents, pit_road, off_track,
         recorded_at, completed_at, expires_at, csv_bytes, csv_gzip)
       VALUES ($1, gen_random_uuid(), 'Sebring International Raceway (International)', 'shots gp', 'Lamborghini Huracán GT3 EVO', 'x', 5, $2, 0, 'Race', $3, 120, 3, 0, 0, false, false,
         now() - ($3 * interval '2 hours'), now() - ($3 * interval '2 hours'), now() + interval '20 days', 100, '\\x00')`,
      [id, 100 + Math.floor(lap / 6), lap]
    );
  }
  await db.query(
    `UPDATE racingcoach."Users" SET membership_level = 'Gold', account_status = 'Subscribed', stripe_subscription_id = 'sub_shots', stripe_customer_id = 'cus_s',
       subscription_end_date = $2 WHERE id = $1`,
    [id, new Date(Date.now() + 86400_000 * 25).toISOString()]
  );
  await page.goto('/my-dashboard');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/desktop-dark.png`, fullPage: true });
  await page.locator('nav').first().hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/nav-open.png`, clip: { x: 0, y: 0, width: 320, height: 500 } });
  await page.mouse.move(900, 400);
  await db.query(`UPDATE racingcoach."Users" SET theme = 'light' WHERE id = $1`, [id]);
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/desktop-light.png`, fullPage: true });
  await db.query(`UPDATE racingcoach."Users" SET theme = 'dark' WHERE id = $1`, [id]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/phone-dark.png`, fullPage: true });
  await context.close();
  await db.end();
});
