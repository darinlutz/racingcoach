// The Cars tab by role, in a real browser: npm run test:e2e (playwright.config.ts has the database it needs)
//
// There's one list of cars. A User can look at it but not change it, on the page or through /api/car-data; Coaches and
// Admins can, and everyone sees what they change.

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

async function signUp(browser: Browser, role: 'User' | 'Coach' | 'Admin') {
  const email = `cars-${randomUUID()}@example.test`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('/cookies');
  await page.getByRole('button', { name: 'Reject All' }).first().click();
  await expect(page.getByRole('button', { name: 'Reject All' })).toHaveCount(0);
  const response = await page.request.post('/api/auth/signup', {
    data: { userName: `${role} Driver`, emailAddress: email, password: 'correct-horse-9', preferredLanguage: 'en', acceptedPolicies: POLICY_VERSIONS },
  });
  expect(response.status()).toBe(201);
  await db.query('UPDATE racingcoach."Users" SET role = $1 WHERE email_address = $2', [role, email]);
  return { context, page };
}

const newCar = (name: string) => ({
  name,
  racingDiscipline: null,
  lengthIn: null,
  widthIn: null,
  wheelbaseIn: null,
  dryWeightLbs: null,
  wetWeightLbs: null,
  displacementLiters: null,
  rpmLimit: null,
  torqueLbFt: null,
  powerBhp: null,
  notes: null,
});

test('a User sees the cars with no way to change them, and the API refuses', async ({ browser }) => {
  const { context, page } = await signUp(browser, 'User');
  await page.goto('/cars-tracks?tab=cars');

  const rows = page.locator('table').last().locator('tbody > tr');
  await expect(rows.first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Car' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await expect(page.getByText('or press Edit to change them')).toHaveCount(0);

  const { cars } = await (await page.request.get('/api/car-data')).json();
  expect(cars.length).toBeGreaterThan(0);
  const car = cars[0];
  const { id, ...fields } = car;
  expect((await page.request.post('/api/car-data', { data: { car: newCar('Not Allowed') } })).status()).toBe(404);
  expect((await page.request.put('/api/car-data', { data: { id, car: { ...fields, notes: 'changed' } } })).status()).toBe(404);
  expect((await page.request.delete('/api/car-data', { data: { id } })).status()).toBe(404);

  const after = await (await page.request.get('/api/car-data')).json();
  expect(after.cars).toEqual(cars);
  await context.close();
});

for (const role of ['Coach', 'Admin'] as const) {
  test(`a ${role} can add, edit and delete cars, and a User sees the changes`, async ({ browser }) => {
    const { context, page } = await signUp(browser, role);
    const user = await signUp(browser, 'User');
    const carsAUserSees = async () => (await (await user.page.request.get('/api/car-data')).json()).cars as { id: number; notes: string | null }[];
    await page.goto('/cars-tracks?tab=cars');

    await expect(page.getByRole('button', { name: 'Edit', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Car' })).toBeVisible();

    const name = `Test Car ${randomUUID()}`;
    const added = await page.request.post('/api/car-data', { data: { car: newCar(name) } });
    expect(added.status()).toBe(201);
    const { id } = await added.json();
    expect((await carsAUserSees()).some((car) => car.id === id)).toBe(true);

    expect((await page.request.put('/api/car-data', { data: { id, car: { ...newCar(name), notes: 'changed' } } })).status()).toBe(200);
    expect((await carsAUserSees()).find((car) => car.id === id)?.notes).toBe('changed');

    expect((await page.request.post('/api/car-data', { data: { car: newCar(name) } })).status()).toBe(409);
    expect((await page.request.delete('/api/car-data', { data: { id } })).status()).toBe(200);
    expect((await carsAUserSees()).some((car) => car.id === id)).toBe(false);
    await context.close();
    await user.context.close();
  });
}
