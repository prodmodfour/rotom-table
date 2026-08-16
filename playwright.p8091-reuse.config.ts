import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({
  ...base,
  testMatch: 'campaign-day-continuation.spec.ts',
  fullyParallel: false,
  workers: 1,
  webServer: {
    ...base.webServer,
    command: 'rm -rf .playwright-campaign && mkdir -p .playwright-campaign && npm run start',
    reuseExistingServer: false,
  },
})
