import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

// Browser tests (e2e/), run with: npm run test:e2e. See e2e/cookie-consent.spec.ts's header for the database they need.
//
// The site runs with NODE_ENV=test, so Next.js doesn't load .env.local (which holds live keys), against the disposable
// local database in E2E_DATABASE_URL only, with every outside service off.
// Consent runs in 'regional' mode with a test country header, so the tests can be an EU, UK, US or unknown visitor;
// production's default is 'global'.

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];
const databaseUrl = process.env.E2E_DATABASE_URL ?? '';
if (!databaseUrl || !LOCAL_HOSTS.includes(new URL(databaseUrl).hostname)) {
  throw new Error('Set E2E_DATABASE_URL to a disposable local Postgres (see e2e/cookie-consent.spec.ts); refusing anything else');
}

const PORT = Number(process.env.E2E_PORT ?? 3100);
// The tests send the visitor's country in this header (e2e/cookie-consent.spec.ts's COUNTRY_HEADER)
const E2E_COUNTRY_HEADER = 'x-e2e-country';

export default defineConfig({
  testDir: 'e2e',
  // One dev server and one database; the tests are independent but share them
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  // Playwright's own Chromium (npx playwright install chromium), or E2E_BROWSER_CHANNEL=msedge for the Edge installed with
  // Windows, which needs no download
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.E2E_BROWSER_CHANNEL ? { channel: process.env.E2E_BROWSER_CHANNEL } : {}),
        // A particular browser build: e2e/broadcast-director.spec.ts needs one that plays H.264
        ...(process.env.E2E_BROWSER_PATH ? { launchOptions: { executablePath: process.env.E2E_BROWSER_PATH } } : {}),
      },
    },
  ],
  webServer: {
    // E2E_SERVER_COMMAND runs them against something else, e.g. a production build (`npm run build` first, then
    // E2E_SERVER_COMMAND="npx next start -p 3100"), when next dev is too slow to compile a page in time
    command: process.env.E2E_SERVER_COMMAND || `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/cookies`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      NODE_ENV: 'test',
      // The spam guards (src/lib/abuseGuards.ts) would refuse the tests' quick signups from one address
      ABUSE_GUARDS: 'off',
      // The background jobs run only on the live server (src/lib/serverEnvironment.ts); the tests want the video
      // worker and the rest, against their own database
      BACKGROUND_JOBS: 'on',
      DATABASE_URL: databaseUrl,
      // Its own address, which a production build (E2E_SERVER_COMMAND) requires for email and redirect links
      SITE_URL: `http://localhost:${PORT}`,
      CONSENT_MODE: 'regional',
      CONSENT_COUNTRY_HEADER: E2E_COUNTRY_HEADER,
      // Empty, so nothing reaches a real service even if the shell has them set
      STRIPE_SECRET_KEY: '',
      RESEND_API_KEY: '',
      // e2e/broadcast-director.spec.ts's stand-in for the speech service (its header says how); no real key belongs here
      OPENAI_API_KEY: process.env.E2E_OPENAI_API_KEY ?? '',
      ANTHROPIC_API_KEY: '',
      DEEPSEEK_API_KEY: '',
      LANGSMITH_TRACING: 'false',
      GOOGLE_CLIENT_ID: '',
      DISCORD_CLIENT_ID: '',
      // e2e/car-models.spec.ts: the 3D car models' files in a folder on this computer, unless the shell gives the
      // broadcast tests' own object storage (BROADCAST_VIDEO_S3_*)
      CAR_MODEL_DEV_STORAGE_DIR: path.join(os.tmpdir(), 'racingcoach-e2e-car-models'),
    },
  },
});
