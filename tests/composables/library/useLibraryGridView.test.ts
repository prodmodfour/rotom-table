import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useLibraryGridView } from '~/composables/library/useLibraryGridView'

type TestItem = {
  name: string
  folder: string
}

const filterItems = ({ items, currentPath, searchTerm }: {
  items: TestItem[]
  currentPath: string
  searchTerm: string
}) => {
  const query = searchTerm.trim().toLowerCase()
  return items.filter((item) => {
    const inScope = currentPath
      ? item.folder === currentPath || item.folder.startsWith(`${currentPath}/`)
      : true
    if (!inScope) return false
    if (!query) return item.folder === currentPath
    return item.name.toLowerCase().includes(query)
  })
}

describe('useLibraryGridView', () => {
  it('derives visible items, direct child folders, and empty-state flags', () => {
    const currentPath = ref('root')
    const items = ref<TestItem[]>([
      { name: 'Visible root item', folder: 'root' },
      { name: 'Nested item', folder: 'root/child' },
      { name: 'Other item', folder: 'other' },
    ])
    const folderPaths = computed(() => new Set(['root', 'root/child', 'root/child/deep', 'other']))

    const view = useLibraryGridView({
      items,
      folderPaths,
      currentPath,
      filterVisibleItems: filterItems,
      formatFolderLabel: (leaf) => leaf.toUpperCase(),
    })

    expect(view.visibleItems.value.map((item) => item.name)).toEqual(['Visible root item'])
    expect(view.visibleFolders.value).toEqual([{ path: 'root/child', label: 'CHILD', count: 1 }])
    expect(view.hasAnything.value).toBe(true)
    expect(view.totalCount.value).toBe(3)
    expect(view.filteredCount.value).toBe(1)
  })

  it('hides folder tiles while searching and uses the optional filtered counter', () => {
    const view = useLibraryGridView<TestItem>({
      items: [
        { name: 'Alpha', folder: '' },
        { name: 'Beta', folder: 'archive' },
      ],
      folderPaths: ['archive'],
      currentPath: '',
      filterVisibleItems: filterItems,
      countFilteredItems: (items, searchTerm) => items.filter((item) =>
        item.name.toLowerCase().includes(searchTerm.trim().toLowerCase()),
      ).length,
    })

    view.searchTerm.value = 'be'

    expect(view.visibleItems.value.map((item) => item.name)).toEqual(['Beta'])
    expect(view.visibleFolders.value).toEqual([])
    expect(view.filteredCount.value).toBe(1)
    expect(view.totalCount.value).toBe(2)
  })
})
