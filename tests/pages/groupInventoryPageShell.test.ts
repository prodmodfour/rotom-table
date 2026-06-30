import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')
const readSource = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('group inventory page shell', () => {
  it('loads the authoritative read-only inventory document behind navigation-backed status states', () => {
    const source = readSource('src/pages/group-inventory.vue')

    expect(source).toContain("import AppNavigation from '~/components/AppNavigation.vue'")
    expect(source).toContain("import GroupInventoryPanel from '~/components/inventory/GroupInventoryPanel.vue'")
    expect(source).toContain("import { GROUP_INVENTORY_API_PATHS } from '~/utils/apiRoutes'")
    expect(source).toContain("title: 'Inventory · Rotom Table'")
    expect(source).toContain('<AppNavigation />')
    expect(source).toContain('await useFetch<GroupInventoryDocument | null>(GROUP_INVENTORY_API_PATHS.load')
    expect(source).toContain("key: 'group-inventory-main'")
    expect(source).toContain('isGroupInventoryLoading')
    expect(source).toContain('groupInventoryErrorMessage')
    expect(source).toContain('<GroupInventoryPanel')
    expect(source).toContain(':document="groupInventoryDocument"')
    expect(source).toContain('No shared inventory document loaded')
    expect(source).not.toContain('GROUP_INVENTORY_API_PATHS.save')
    expect(source).not.toContain('postJson')
    expect(source).not.toContain('expectedRevision')
    expect(source).not.toContain('@add-item')
  })
})
