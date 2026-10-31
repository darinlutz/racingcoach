import { defineConfig, devices } from '@playwright/test';

// Temporary: the production build, because the owner's own next dev holds .next/dev/lock. Deleted after the run.
export default defineConfig({
  testDir: 'e2e',
  testMatch: /(my-dashboard\.spec|zz-dash-shots\.tmp\.spec)\.ts/,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3100', trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node node_modules/next/dist/bin/next start -p 3100',
    url: 'http://localhost:3100/cookies',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? '',
      STRIPE_SECRET_KEY: '',
      RESEND_API_KEY: '',
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      DEEPSEEK_API_KEY: '',
      LANGSMITH_TRACING: 'false',
      GOOGLE_CLIENT_ID: '',
      DISCORD_CLIENT_ID: '',
      LAP_RETENTION_MODE: '',
    },
  },
});
