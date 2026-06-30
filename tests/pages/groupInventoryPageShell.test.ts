import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')
const readSource = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('group inventory page shell', () => {
  it('renders a static navigation-backed placeholder with page status states', () => {
    const source = readSource('src/pages/group-inventory.vue')

    expect(source).toContain("import AppNavigation from '~/components/AppNavigation.vue'")
    expect(source).toContain("title: 'Inventory · Rotom Table'")
    expect(source).toContain('<AppNavigation />')
    expect(source).toContain("inventoryShellState === 'loading'")
    expect(source).toContain("inventoryShellState === 'error'")
    expect(source).toContain('Shared inventory panel')
    expect(source).toContain('No inventory rows loaded yet.')
    expect(source).not.toContain('GROUP_INVENTORY_API_PATHS')
    expect(source).not.toContain('useFetch')
    expect(source).not.toContain('getJson')
    expect(source).not.toContain('postJson')
  })
})
