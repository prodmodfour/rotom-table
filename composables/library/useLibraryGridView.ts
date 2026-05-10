import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue'
import { buildVisibleFolderTiles, type FolderTile } from '~/utils/folderBrowser'

export interface LibraryVisibleItemsInput<TItem> {
  items: TItem[]
  currentPath: string
  searchTerm: string
}

export interface UseLibraryGridViewOptions<TItem> {
  items: MaybeRefOrGetter<readonly TItem[]>
  folderPaths: MaybeRefOrGetter<Iterable<string>>
  currentPath: MaybeRefOrGetter<string>
  filterVisibleItems: (input: LibraryVisibleItemsInput<TItem>) => TItem[]
  countFilteredItems?: (items: TItem[], searchTerm: string) => number
  folderOf?: (item: TItem) => string
  formatFolderLabel?: (leaf: string) => string
}

/**
 * Shared visible-state derivation for the maps and sheets library grids.
 *
 * Route pages still own domain loading, persistence, and navigation. This
 * composable only owns UI view state: the search model, current visible cards,
 * direct child folder tiles, empty-state detection, and optional filtered
 * counts for intro badges.
 */
export const useLibraryGridView = <TItem>(options: UseLibraryGridViewOptions<TItem>) => {
  const searchTerm = ref('')

  const currentItems = computed(() => Array.from(toValue(options.items)))

  const visibleItems = computed(() => options.filterVisibleItems({
    items: currentItems.value,
    currentPath: toValue(options.currentPath),
    searchTerm: searchTerm.value,
  }))

  const visibleFolders = computed<FolderTile[]>(() => {
    if (searchTerm.value) return []

    return buildVisibleFolderTiles({
      folderPaths: toValue(options.folderPaths),
      currentPath: toValue(options.currentPath),
      items: currentItems.value,
      folderOf: options.folderOf,
      formatLabel: options.formatFolderLabel,
    })
  })

  const hasAnything = computed(
    () => visibleItems.value.length > 0 || visibleFolders.value.length > 0,
  )

  const totalCount = computed(() => currentItems.value.length)

  const filteredCount = computed(() => options.countFilteredItems
    ? options.countFilteredItems(currentItems.value, searchTerm.value)
    : visibleItems.value.length)

  return {
    searchTerm,
    visibleItems,
    visibleFolders,
    hasAnything,
    totalCount,
    filteredCount,
  }
}
