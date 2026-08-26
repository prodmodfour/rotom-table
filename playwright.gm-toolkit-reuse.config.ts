import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({
  ...base,
  testMatch: 'gm-campaign-toolkit-liveplay.spec.ts',
  fullyParallel: false,
  workers: 1,
  outputDir: '.pi/artifacts/ui-validation/gm-campaign-toolkit/playwright',
  use: {
    ...base.use,
    trace: 'on',
    screenshot: 'only-on-failure',
  },
  webServer: {
    ...base.webServer,
    command: 'rm -rf .playwright-campaign && mkdir -p .playwright-campaign && npm run start',
    reuseExistingServer: false,
  },
})
