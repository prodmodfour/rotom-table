import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({
  ...base,
  testMatch: /onboarding-.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  webServer: undefined,
})
