import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('useLiveSheets runtime hydration', () => {
  it('hydrates runtime campaign sheets in production as well as development', () => {
    const source = readText('src/composables/useLiveSheets.ts')

    expect(source).toContain('if (!runtimeLoadStarted)')
    expect(source).not.toContain('import.meta.dev && !runtimeLoadStarted')
  })
})
