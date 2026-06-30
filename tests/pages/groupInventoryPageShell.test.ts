import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')
const readSource = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('group inventory page shell', () => {
  it('loads the authoritative inventory document and wires GM save/reload controls behind navigation-backed states', () => {
    const source = readSource('src/pages/group-inventory.vue')

    expect(source).toContain("import AppNavigation from '~/components/AppNavigation.vue'")
    expect(source).toContain("import GroupInventoryPanel from '~/components/inventory/GroupInventoryPanel.vue'")
    expect(source).toContain("import { useGroupInventoryEditor } from '~/composables/useGroupInventoryEditor'")
    expect(source).toContain("import { GROUP_INVENTORY_API_PATHS } from '~/utils/apiRoutes'")
    expect(source).toContain('const { isGm } = useAuth()')
    expect(source).toContain("title: 'Inventory · Rotom Table'")
    expect(source).toContain('<AppNavigation />')
    expect(source).toContain('await useFetch<GroupInventoryDocument | null>(GROUP_INVENTORY_API_PATHS.load')
    expect(source).toContain("key: 'group-inventory-main'")
    expect(source).toContain('useGroupInventoryEditor(groupInventoryDocument, { canEdit: isGm })')
    expect(source).toContain('isGroupInventoryLoading')
    expect(source).toContain('groupInventoryErrorMessage')
    expect(source).toContain('reloadGroupInventory')
    expect(source).toContain('<GroupInventoryPanel')
    expect(source).toContain(':document="groupInventoryEditor.document.value"')
    expect(source).toContain(':can-edit="isGm"')
    expect(source).toContain(':is-dirty="groupInventoryEditor.isDirty.value"')
    expect(source).toContain(':save-status="groupInventoryEditor.saveStatus.value"')
    expect(source).toContain('@save="groupInventoryEditor.save"')
    expect(source).toContain('@reload-after-conflict="reloadGroupInventory"')
    expect(source).toContain('No shared inventory document loaded')
    expect(source).not.toContain('postJson')
    expect(source).not.toContain('/api/sessions')
  })
})
