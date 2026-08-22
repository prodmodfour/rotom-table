import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // All browser journeys exercise one production server and one campaign
  // authority root. Keep suites serial; multi-client concurrency is created
  // explicitly inside the journeys that certify it.
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3017',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Keep screenshot authority on Playwright's package-pinned Chromium locally
    // and in CI; an independently updated system Chrome changes font metrics.
    video: process.env.CI ? 'retain-on-failure' : 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'rm -rf .playwright-campaign && mkdir -p .playwright-campaign && npm run build && npm run start',
    url: 'http://127.0.0.1:3017/api/health',
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NODE_OPTIONS: process.env.NODE_OPTIONS ?? '--max-old-space-size=8192',
      NITRO_HOST: '127.0.0.1',
      NITRO_PORT: '3017',
      ROTOM_CAMPAIGN_ROOT: '.playwright-campaign',
      ROTOM_ENABLE_HOSTED_WRITES: '1',
      ROTOM_ENABLE_SESSION_HOST: '1',
      NUXT_PUBLIC_PRESENTATION_CONTRACT_PREVIEW: 'true',
    },
  },
})
