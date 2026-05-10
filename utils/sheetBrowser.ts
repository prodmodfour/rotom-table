import type { SheetKind } from '~/shared/sheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  buildVisibleFolderTiles,
  isInsideFolder,
  normalizeSearchText,
  type FolderTile,
} from '~/utils/folderBrowser'

export type SheetBrowserSelection =
  | { kind: 'pokemon'; sheet: CharacterSheet }
  | { kind: 'trainer'; sheet: TrainerSheet }

export interface SheetBrowserItem {
  kind: SheetKind
  slug: string
  folder: string
  sheet: CharacterSheet | TrainerSheet
  spriteUrl: string | null
  displayName: string
  meta: string
  sortKey: string
}

export interface BuildSheetBrowserItemsOptions {
  pokemonSheets: readonly CharacterSheet[]
  trainerSheets: readonly TrainerSheet[]
  spriteUrlForSpecies: (species: string) => string | null
}

export const buildSheetBrowserItems = ({
  pokemonSheets,
  trainerSheets,
  spriteUrlForSpecies,
}: BuildSheetBrowserItemsOptions): SheetBrowserItem[] => {
  const items: SheetBrowserItem[] = []

  for (const sheet of pokemonSheets) {
    items.push({
      kind: 'pokemon',
      slug: sheet.slug,
      folder: sheet.folder ?? '',
      sheet,
      spriteUrl: spriteUrlForSpecies(sheet.species),
      displayName: sheet.nickname,
      meta: `${sheet.species} · Lv ${sheet.level}`,
      sortKey: sheet.nickname.toLowerCase(),
    })
  }

  for (const sheet of trainerSheets) {
    const cls = sheet.classes?.[0]?.name
    items.push({
      kind: 'trainer',
      slug: sheet.slug,
      folder: sheet.folder ?? '',
      sheet,
      spriteUrl: sheet.portraitUrl ?? null,
      displayName: sheet.name,
      meta: cls ? `Trainer · Lv ${sheet.level} · ${cls}` : `Trainer · Lv ${sheet.level}`,
      sortKey: sheet.name.toLowerCase(),
    })
  }

  return items
}

export const buildSheetBrowserFolderSet = (items: readonly SheetBrowserItem[]): Set<string> => {
  const folders = new Set<string>()
  for (const item of items) if (item.folder) folders.add(item.folder)
  return folders
}

export const matchesSheetBrowserQuery = (item: SheetBrowserItem, query: string): boolean =>
  [item.displayName, item.meta, item.folder]
    .some((value) => normalizeSearchText(value).includes(query))

export const filterSheetBrowserItems = (
  items: readonly SheetBrowserItem[],
  currentPath: string,
  searchTerm: string,
): SheetBrowserItem[] => {
  const query = normalizeSearchText(searchTerm)
  const pool = items.filter((item) => isInsideFolder(item.folder, currentPath))
  const matched = query ? pool.filter((item) => matchesSheetBrowserQuery(item, query)) : pool
  const visible = query ? matched : matched.filter((item) => item.folder === currentPath)
  return [...visible].sort((a, b) => a.sortKey.localeCompare(b.sortKey))
}

export const buildSheetBrowserFolderTiles = (
  items: readonly SheetBrowserItem[],
  currentPath: string,
  searchTerm: string,
): FolderTile[] => {
  if (searchTerm) return []
  return buildVisibleFolderTiles({
    folderPaths: buildSheetBrowserFolderSet(items),
    currentPath,
    items,
  })
}

export const sheetBrowserSelectionForItem = (item: SheetBrowserItem): SheetBrowserSelection => {
  if (item.kind === 'pokemon') return { kind: 'pokemon', sheet: item.sheet as CharacterSheet }
  return { kind: 'trainer', sheet: item.sheet as TrainerSheet }
}
