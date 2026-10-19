import { defineConfig, devices } from '@playwright/test';

// The tests talk to the local Supabase stack (npm run db:start) using the keys in .env.local.
process.loadEnvFile('.env.local');

export default defineConfig({
  testDir: './e2e',
  // One worker: the tests share one local database and one mail catcher.
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // Must match site_url in supabase/config.toml, because email links point there.
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  // PLAYWRIGHT_CHANNEL=msedge uses the Edge already installed on Windows instead of the
  // downloaded Chromium build.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.PLAYWRIGHT_CHANNEL || undefined } }],
  webServer: {
    command: 'npm run build && npm run start',
    url: 'http://localhost:3000/login',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
