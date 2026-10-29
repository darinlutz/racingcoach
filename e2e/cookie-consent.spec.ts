// Cookie consent in a real browser: npm run test:e2e
//
// Needs a disposable local Postgres; the dev server and these tests use it and nothing else (playwright.config.ts):
//   docker run -d --rm --name rc-consent-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rctest -p 127.0.0.1:55432:5432 postgres:16
//   E2E_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/rctest npm run test:e2e
// Checks the browser's actual cookies, storage and network requests, and the consent records in the database. The
// tests that fail when anything optional happens before consent are marked "before consent".

import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test';
import pg from 'pg';
import { CONSENT_PURPOSES_VERSION } from '../src/lib/cookieConsent';
import { POLICY_VERSIONS } from '../src/lib/policyVersions';

const COUNTRY_HEADER = 'x-e2e-country';
// Longer than the tracker's 3 s batching, so anything it queued would have been sent
const SETTLE_MS = 4_000;

let db: pg.Client;
test.beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
});
test.afterAll(async () => {
  await db?.end();
});

async function visitor(browser: import('@playwright/test').Browser, country: string | null, options: Parameters<import('@playwright/test').Browser['newContext']>[0] = {}) {
  const context = await browser.newContext({
    ...options,
    extraHTTPHeaders: country ? { [COUNTRY_HEADER]: country } : {},
  });
  const page = await context.newPage();
  return { context, page, net: watchNetwork(page) };
}

// Every request the page makes, so tests can assert what was (not) sent
function watchNetwork(page: Page) {
  const requests: Request[] = [];
  page.on('request', (request) => requests.push(request));
  const origin = () => new URL(page.url() === 'about:blank' ? 'http://localhost' : page.url()).origin;
  return {
    activity: () => requests.filter((r) => new URL(r.url()).pathname === '/api/activity'),
    thirdParty: () =>
      requests.filter((r) => {
        const url = r.url();
        return !url.startsWith('data:') && !url.startsWith('blob:') && new URL(url).origin !== origin();
      }),
  };
}

const banner = (page: Page) => page.getByTestId('cookie-banner');
const preferences = (page: Page) => page.getByRole('dialog', { name: 'Cookie Settings' });

async function cookie(context: BrowserContext, name: string) {
  return (await context.cookies()).find((c) => c.name === name);
}

async function browserId(context: BrowserContext): Promise<string> {
  const value = (await cookie(context, 'cookie_consent'))?.value;
  if (!value) throw new Error('no consent cookie');
  return JSON.parse(decodeURIComponent(value)).b;
}

async function records(context: BrowserContext) {
  const { rows } = await db.query(
    'SELECT * FROM racingcoach."CookieConsents" WHERE browser_id = $1 ORDER BY recorded_at',
    [await browserId(context)]
  );
  return rows;
}

async function activityRows(visitorId: string) {
  const { rows } = await db.query('SELECT event_type, path FROM racingcoach."ActivityLog" WHERE visitor_id = $1', [visitorId]);
  return rows;
}

// Clicks some links and buttons and moves between pages, as a visitor would
async function browseAround(page: Page) {
  await page.getByRole('contentinfo').getByRole('link', { name: 'Terms' }).click();
  await page.waitForURL('**/terms');
  await page.getByRole('link', { name: /All legal documents/ }).click();
  await page.waitForURL('**/legal');
  await page.goBack();
}

test.describe('who is asked', () => {
  test('1. a first-time EU visitor sees the banner, and nothing optional runs before consent', async ({ browser }) => {
    const { context, page, net } = await visitor(browser, 'DE');
    await page.goto('/');
    await expect(banner(page)).toBeVisible();
    for (const name of ['Accept All', 'Reject All', 'Customize']) {
      await expect(banner(page).getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(banner(page).getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
    await expect(banner(page).getByRole('link', { name: 'Cookie Policy' })).toHaveAttribute('href', '/cookies');
    await page.waitForTimeout(SETTLE_MS);
    expect(net.activity()).toHaveLength(0);
    expect(await cookie(context, 'visitor_id')).toBeUndefined();
    expect(await cookie(context, 'cookie_consent')).toBeUndefined();
    expect(await page.evaluate(() => sessionStorage.getItem('activitySessionId'))).toBeNull();
    await context.close();
  });

  test('2. a first-time UK visitor sees the banner', async ({ browser }) => {
    const { context, page } = await visitor(browser, 'GB');
    await page.goto('/');
    await expect(banner(page)).toBeVisible();
    await context.close();
  });

  test('3. an unknown location gets the strict opt-in behavior', async ({ browser }) => {
    for (const country of [null, 'XX']) {
      const { context, page, net } = await visitor(browser, country);
      await page.goto('/');
      await expect(banner(page)).toBeVisible();
      await page.waitForTimeout(SETTLE_MS);
      expect(net.activity()).toHaveLength(0);
      await context.close();
    }
  });

  test('3b. in regional mode, a visitor outside opt-in regions sees no banner but can still opt out', async ({ browser }) => {
    const { context, page, net } = await visitor(browser, 'US');
    await page.goto('/');
    await expect(page.getByRole('contentinfo').getByRole('button', { name: 'Cookie Settings' })).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
    await expect.poll(() => net.activity().length).toBeGreaterThan(0);
    await page.getByRole('contentinfo').getByRole('button', { name: 'Cookie Settings' }).click();
    await preferences(page).getByRole('button', { name: 'Reject All' }).click();
    await expect(preferences(page)).toHaveCount(0);
    expect(await cookie(context, 'visitor_id')).toBeUndefined();
    await context.close();
  });
});

test.describe('choices', () => {
  test('4. Reject All prevents optional tracking, and is recorded', async ({ browser }) => {
    const { context, page, net } = await visitor(browser, 'FR');
    await page.goto('/');
    await banner(page).getByRole('button', { name: 'Reject All' }).click();
    await expect(banner(page)).toHaveCount(0);
    await browseAround(page);
    await page.waitForTimeout(SETTLE_MS);
    expect(net.activity()).toHaveLength(0);
    expect(await cookie(context, 'visitor_id')).toBeUndefined();
    expect(await page.evaluate(() => sessionStorage.getItem('activitySessionId'))).toBeNull();
    const [record] = await records(context);
    expect(record).toMatchObject({ action: 'rejected', method: 'banner', region: 'EEA', country: 'FR', notice_language: 'en' });
    expect(record.categories).toEqual({ necessary: true, analytics: false });
    await context.close();
  });

  test('5. Accept All enables the activity log, and is recorded', async ({ browser }) => {
    const { context, page, net } = await visitor(browser, 'DE');
    await page.goto('/');
    await page.waitForTimeout(1_000);
    expect(net.activity()).toHaveLength(0);
    await banner(page).getByRole('button', { name: 'Accept All' }).click();
    await expect(banner(page)).toHaveCount(0);
    await expect.poll(() => net.activity().length).toBeGreaterThan(0);
    const visitorCookie = await cookie(context, 'visitor_id');
    expect(visitorCookie?.httpOnly).toBe(true);
    expect(visitorCookie?.sameSite).toBe('Lax');
    await expect.poll(async () => (await activityRows(visitorCookie!.value)).length).toBeGreaterThan(0);
    const [record] = await records(context);
    expect(record).toMatchObject({ action: 'accepted', method: 'banner', purposes_version: CONSENT_PURPOSES_VERSION });
    expect(record.categories).toEqual({ necessary: true, analytics: true });
    // The consent cookie is HttpOnly and SameSite=Lax; it holds no personal data
    const consentCookie = await cookie(context, 'cookie_consent');
    expect(consentCookie?.httpOnly).toBe(true);
    expect(consentCookie?.sameSite).toBe('Lax');
    await context.close();
  });

  test('6. Customize enables only the categories turned on', async ({ browser }) => {
    // Saved with everything off: nothing optional runs
    {
      const { context, page, net } = await visitor(browser, 'IT');
      await page.goto('/');
      await banner(page).getByRole('button', { name: 'Customize' }).click();
      const analytics = preferences(page).getByRole('switch', { name: 'Analytics' });
      await expect(analytics).not.toBeChecked();
      await preferences(page).getByRole('button', { name: 'Save Preferences' }).click();
      await expect(preferences(page)).toHaveCount(0);
      await expect(banner(page)).toHaveCount(0);
      await page.waitForTimeout(SETTLE_MS);
      expect(net.activity()).toHaveLength(0);
      const [record] = await records(context);
      expect(record).toMatchObject({ action: 'customized', method: 'preferenceCenter' });
      expect(record.categories).toEqual({ necessary: true, analytics: false });
      await context.close();
    }
    // Analytics turned on: it runs
    {
      const { context, page, net } = await visitor(browser, 'IT');
      await page.goto('/');
      await banner(page).getByRole('button', { name: 'Customize' }).click();
      await preferences(page).getByRole('switch', { name: 'Analytics' }).check();
      await preferences(page).getByRole('button', { name: 'Save Preferences' }).click();
      await expect.poll(() => net.activity().length).toBeGreaterThan(0);
      const [record] = await records(context);
      expect(record).toMatchObject({ action: 'customized' });
      expect(record.categories).toEqual({ necessary: true, analytics: true });
      await context.close();
    }
  });

  test('8. preferences survive a refresh and navigation', async ({ browser }) => {
    const { context, page, net } = await visitor(browser, 'ES');
    await page.goto('/');
    await banner(page).getByRole('button', { name: 'Accept All' }).click();
    await expect(banner(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('contentinfo')).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
    const before = net.activity().length;
    await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' }).click();
    await page.waitForURL('**/privacy');
    await expect(banner(page)).toHaveCount(0);
    await expect.poll(() => net.activity().length).toBeGreaterThan(before);
    expect(await records(context)).toHaveLength(1);
    await context.close();
  });

  test('9. withdrawing consent stops tracking at once and deletes its cookie and storage', async ({ browser }) => {
    const { context, page, net } = await visitor(browser, 'NL');
    await page.goto('/');
    await banner(page).getByRole('button', { name: 'Accept All' }).click();
    await expect.poll(() => net.activity().length).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('activitySessionId'))).not.toBeNull();
    const visitorId = (await cookie(context, 'visitor_id'))!.value;

    await page.getByRole('contentinfo').getByRole('button', { name: 'Cookie Settings' }).click();
    await expect(preferences(page).getByRole('switch', { name: 'Analytics' })).toBeChecked();
    await preferences(page).getByRole('switch', { name: 'Analytics' }).uncheck();
    await preferences(page).getByRole('button', { name: 'Save Preferences' }).click();
    await expect(preferences(page)).toHaveCount(0);
    const sentAtWithdrawal = net.activity().length;
    const rowsAtWithdrawal = (await activityRows(visitorId)).length;

    await browseAround(page);
    await page.waitForTimeout(SETTLE_MS);
    expect(net.activity()).toHaveLength(sentAtWithdrawal);
    expect((await activityRows(visitorId)).length).toBe(rowsAtWithdrawal);
    expect(await cookie(context, 'visitor_id')).toBeUndefined();
    expect(await page.evaluate(() => sessionStorage.getItem('activitySessionId'))).toBeNull();
    const actions = (await records(context)).map((r) => r.action);
    expect(actions).toEqual(['accepted', 'withdrawn']);

    // Signing in still works after withdrawing (strictly necessary cookies are untouched)
    await expect(page.getByRole('contentinfo')).toBeVisible();
    await context.close();
  });

  test('10. Cookie Settings reopens the preference center, with the current choice', async ({ browser }) => {
    const { context, page } = await visitor(browser, 'BE');
    await page.goto('/');
    await banner(page).getByRole('button', { name: 'Reject All' }).click();
    await expect(banner(page)).toHaveCount(0);
    const settings = page.getByRole('contentinfo').getByRole('button', { name: 'Cookie Settings' });
    await settings.click();
    await expect(preferences(page)).toBeVisible();
    await expect(preferences(page).getByRole('switch', { name: 'Analytics' })).not.toBeChecked();
    await expect(preferences(page).getByText('Always active')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(preferences(page)).toHaveCount(0);
    await expect(settings).toBeFocused();
    // Closing without choosing changes nothing
    expect(await records(context)).toHaveLength(1);

    // And from the Cookie Policy page itself
    await page.goto('/cookies');
    await page.getByRole('button', { name: 'Open Cookie Settings' }).click();
    await expect(preferences(page)).toBeVisible();
    await context.close();
  });

  test('11. a material change, or an expired choice, asks again and stops optional tracking until answered', async ({ browser }) => {
    const stale = (purposesVersion: number, decidedAt: number) =>
      encodeURIComponent(JSON.stringify({
        b: '33333333-3333-4333-8333-333333333333',
        r: '44444444-4444-4444-8444-444444444444',
        p: purposesVersion,
        c: { analytics: true },
        t: decidedAt,
      }));
    for (const value of [
      stale(CONSENT_PURPOSES_VERSION - 1, Date.now()),
      stale(CONSENT_PURPOSES_VERSION, Date.now() - 200 * 24 * 60 * 60 * 1000),
    ]) {
      const { context, page, net } = await visitor(browser, 'AT');
      await context.addCookies([{ name: 'cookie_consent', value, url: test.info().project.use.baseURL! }]);
      await page.goto('/');
      await expect(banner(page)).toBeVisible();
      await expect(banner(page).getByRole('heading', { name: 'Our use of cookies has changed' })).toBeVisible();
      await page.waitForTimeout(SETTLE_MS);
      expect(net.activity()).toHaveLength(0);
      await context.close();
    }
  });
});

test.describe('enforcement', () => {
  test('7 & 14. before consent: no optional request, cookie or storage, even when clicking before hydration', async ({ browser }) => {
    const { context, page, net } = await visitor(browser, 'PL');
    // Record any attempt to reach the activity log from the first script on the page
    await page.addInitScript(() => {
      const attempts: string[] = [];
      (window as unknown as { __attempts: string[] }).__attempts = attempts;
      const fetch0 = window.fetch.bind(window);
      window.fetch = (input, init) => {
        if (String(input instanceof Request ? input.url : input).includes('/api/activity')) attempts.push('fetch');
        return fetch0(input, init);
      };
      const beacon0 = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = (url, data) => {
        if (String(url).includes('/api/activity')) attempts.push('beacon');
        return beacon0(url, data);
      };
    });
    await page.goto('/', { waitUntil: 'commit' });
    // Click as early as possible, while the page may still be hydrating
    await page.locator('footer a[href="/terms"]').click({ noWaitAfter: true }).catch(() => {});
    await page.waitForLoadState('load');
    await page.goto('/');
    await page.waitForTimeout(SETTLE_MS);
    expect(net.activity()).toHaveLength(0);
    expect(await page.evaluate(() => (window as unknown as { __attempts: string[] }).__attempts)).toEqual([]);
    expect(await cookie(context, 'visitor_id')).toBeUndefined();
    expect(await page.evaluate(() => Object.keys(sessionStorage))).not.toContain('activitySessionId');
    // Nothing on the page talks to a third party
    expect(net.thirdParty().map((r) => r.url())).toEqual([]);
    await context.close();
  });

  test('14b. the server refuses activity without consent, whatever the browser sends', async ({ browser }) => {
    const { context, page } = await visitor(browser, 'DE');
    const batch = {
      sessionId: '55555555-5555-4555-8555-555555555555',
      language: 'en',
      events: [{ type: 'page_view', occurredAt: Date.now(), path: '/forged' }],
    };
    const before = (await db.query(`SELECT count(*)::int AS n FROM racingcoach."ActivityLog" WHERE path = '/forged'`)).rows[0].n;
    const response = await page.request.post('/api/activity', { data: batch });
    expect(response.status()).toBe(204);
    // The only visitor_id the server sends without consent is its deletion
    expect(response.headers()['set-cookie'] ?? '').not.toMatch(/visitor_id=[^;]/);
    expect(await cookie(context, 'visitor_id')).toBeUndefined();
    // An outdated acceptance doesn't count either
    await context.addCookies([{
      name: 'cookie_consent',
      url: test.info().project.use.baseURL!,
      value: encodeURIComponent(JSON.stringify({
        b: '66666666-6666-4666-8666-666666666666', r: '77777777-7777-4777-8777-777777777777',
        p: CONSENT_PURPOSES_VERSION - 1, c: { analytics: true }, t: Date.now(),
      })),
    }]);
    expect((await page.request.post('/api/activity', { data: batch })).status()).toBe(204);
    const after = (await db.query(`SELECT count(*)::int AS n FROM racingcoach."ActivityLog" WHERE path = '/forged'`)).rows[0].n;
    expect(after).toBe(before);
    // And a cross-site page can't record a choice
    const crossSite = await page.request.post('/api/consent', {
      data: { via: 'acceptAll', method: 'banner' },
      headers: { Origin: 'https://evil.example' },
    });
    expect(crossSite.status()).toBe(403);
    await context.close();
  });

  test('13. sign up, log in, log out and checkout work with optional cookies rejected; consent is tied to the account', async ({ browser }) => {
    const { context, page, net } = await visitor(browser, 'IE');
    await page.goto('/');
    await banner(page).getByRole('button', { name: 'Reject All' }).click();
    await expect(banner(page)).toHaveCount(0);

    const email = `e2e-${Date.now()}@example.test`;
    const password = 'correct-horse-battery-staple';
    const signup = await page.request.post('/api/auth/signup', {
      data: { userName: 'E2E Driver', emailAddress: email, password, preferredLanguage: 'en', acceptedPolicies: POLICY_VERSIONS },
    });
    expect(signup.status()).toBe(201);
    const session = await cookie(context, 'session');
    expect(session?.httpOnly).toBe(true);
    await page.goto('/account');
    await expect(page.getByText('E2E Driver').first()).toBeVisible();
    await expect(banner(page)).toHaveCount(0);

    // The browser's anonymous choice is now tied to the account (not copied to it)
    const { rows: [user] } = await db.query('SELECT id FROM racingcoach."Users" WHERE email_address = $1', [email]);
    const [record] = await records(context);
    expect(Number(record.user_id)).toBe(Number(user.id));

    // Checkout reaches the route as a signed-in user (Stripe itself is switched off in tests, so it stops at its config check)
    const checkout = await page.request.post('/api/create-checkout-session', { form: { plan: 'silver_monthly' } });
    expect(checkout.status()).toBe(500);
    expect((await checkout.json()).error).toBe('This feature isn’t available right now. Please try again later.');

    // Log out and back in: the choice stays with the browser, the banner doesn't come back
    expect((await page.request.post('/api/auth/logout')).ok()).toBe(true);
    expect(await cookie(context, 'session')).toBeUndefined();
    expect((await page.request.post('/api/auth/login', { data: { emailAddress: email, password } })).ok()).toBe(true);
    await page.goto('/account');
    await expect(banner(page)).toHaveCount(0);
    await page.waitForTimeout(SETTLE_MS);
    expect(net.activity()).toHaveLength(0);
    await context.close();
  });
});

// WCAG 2.2 AA checks that can be measured: names and roles, keyboard order and focus, contrast, target size, reflow
async function contrastOf(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((element) => {
    const parse = (color: string) => {
      const m = color.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const [r, g, b, a = '1'] = m[1].split(/[ ,/]+/).filter(Boolean);
        return [Number(r), Number(g), Number(b), Number(a)];
      }
      // oklch() and other modern formats: let a canvas convert them
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const luminance = ([r, g, b]: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    let node: Element | null = element;
    let background = [0, 0, 0, 0];
    while (node && background[3] === 0) {
      background = parse(getComputedStyle(node).backgroundColor);
      node = node.parentElement;
    }
    const fg = parse(getComputedStyle(element).color);
    // Blend a translucent text color over the background
    const blended = fg.slice(0, 3).map((v, i) => v * fg[3] + background[i] * (1 - fg[3]));
    const [l1, l2] = [luminance(blended), luminance(background)].sort((a, b) => b - a);
    return (l1 + 0.05) / (l2 + 0.05);
  });
}

for (const theme of ['dark', 'light'] as const) {
  test(`15. the banner and preference center are accessible on desktop (${theme} theme)`, async ({ browser }) => {
    const { context, page } = await visitor(browser, 'DE');
    await context.addCookies([{ name: 'theme', value: theme, url: test.info().project.use.baseURL! }]);
    await page.goto('/');
    const region = page.getByRole('region', { name: 'Cookie consent' });
    await expect(region).toBeVisible();

    // The three choices are the same size: none is played down
    const boxes = await Promise.all(
      ['Reject All', 'Accept All', 'Customize'].map((name) => region.getByRole('button', { name }).boundingBox())
    );
    for (const box of boxes) {
      expect(box!.height).toBeGreaterThanOrEqual(24);
      expect(Math.abs(box!.height - boxes[0]!.height)).toBeLessThan(1);
    }

    // Contrast: text 4.5:1
    for (const selector of ['[data-testid="cookie-banner"] h2', '#cookie-banner-body', '[data-testid="cookie-banner"] a', '[data-testid="cookie-banner"] button']) {
      expect(await contrastOf(page, selector), selector).toBeGreaterThanOrEqual(4.5);
    }

    // Keyboard: the banner comes first in the tab order, links then the three buttons
    await page.locator('body').focus();
    const reached: string[] = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      reached.push(await page.evaluate(() => (document.activeElement as HTMLElement)?.innerText?.trim()));
    }
    expect(reached).toEqual(['Privacy Policy', 'Cookie Policy', 'REJECT ALL', 'ACCEPT ALL', 'CUSTOMIZE'].map((s) => expect.stringMatching(new RegExp(s, 'i'))));

    // Customize opens a modal dialog with focus inside; Tab never leaves it; Escape closes it and returns focus
    await page.keyboard.press('Enter');
    const dialog = preferences(page);
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const active = document.activeElement;
        return !active || active === document.body || !!active.closest('dialog');
      });
      expect(inside).toBe(true);
    }
    for (const selector of ['dialog h2', 'dialog p', 'dialog a', 'dialog button']) {
      expect(await contrastOf(page, selector), selector).toBeGreaterThanOrEqual(4.5);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(region.getByRole('button', { name: 'Customize' })).toBeFocused();
    // Closing the preference center isn't a choice: the banner is still there
    await expect(region).toBeVisible();
    await context.close();
  });
}

test('15b. the banner is usable on a phone: no sideways scrolling, nothing hidden for good', async ({ browser }) => {
  const { context, page } = await visitor(browser, 'DE', { viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  await page.goto('/');
  const region = page.getByRole('region', { name: 'Cookie consent' });
  await expect(region).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const box = (await region.boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(667 * 0.7 + 1);
  for (const name of ['Reject All', 'Accept All', 'Customize']) {
    const button = region.getByRole('button', { name });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport();
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(24);
  }
  // The page leaves room for the banner, so the footer's links can be scrolled clear of it
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const footerLink = page.getByRole('contentinfo').getByRole('button', { name: 'Cookie Settings' });
  const linkBox = (await footerLink.boundingBox())!;
  const bannerTop = (await region.boundingBox())!.y;
  expect(linkBox.y + linkBox.height).toBeLessThanOrEqual(bannerTop + 1);
  await region.getByRole('button', { name: 'Customize' }).tap();
  await expect(preferences(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await context.close();
});
