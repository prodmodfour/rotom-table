import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
const srcDir = fileURLToPath(new URL('./src/', import.meta.url))
const sharedDir = fileURLToPath(new URL('./shared/', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '~': srcDir,
      '@': srcDir,
      '~~': rootDir,
      '@@': rootDir,
      '#shared': sharedDir,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setupEnv.ts'],
  },
})
