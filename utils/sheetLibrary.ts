import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { isSameOrDescendantFolder, normalizeSearchText, renameFolderPrefix } from '~/utils/folderBrowser'

export type SheetLibraryKind = 'pokemon' | 'trainer'

export interface PokemonSheetLibraryItem {
  kind: 'pokemon'
  slug: string
  folder: string
  sheet: CharacterSheet
  types: string[]
  spriteUrl: string | null
  sortKey: string
}

export interface TrainerSheetLibraryItem {
  kind: 'trainer'
  slug: string
  folder: string
  sheet: TrainerSheet
  sortKey: string
}

export type SheetLibraryItem = PokemonSheetLibraryItem | TrainerSheetLibraryItem

export interface BuildSheetLibraryItemsOptions {
  pokemonSheets: ReadonlyArray<CharacterSheet>
  trainerSheets: ReadonlyArray<TrainerSheet>
  speciesTypesFor: (species: string) => string[] | undefined
  spriteUrlFor: (species: string) => string | null
}

export interface SheetLibraryOverrideOptions {
  playerOnly: boolean
  sheetOverrides: Readonly<Record<string, string | undefined>>
  folderRenames: ReadonlyArray<{ from: string; to: string }>
  nameOverrides: Readonly<Record<string, string | undefined>>
  deletedSheets: ReadonlySet<string>
  deletedFolders: ReadonlySet<string>
}

export interface SheetFolderSetOptions {
  items: ReadonlyArray<SheetLibraryItem>
  extraFolders: Iterable<string>
  includeExtraFolders: boolean
  folderRenames: ReadonlyArray<{ from: string; to: string }>
  deletedFolders: ReadonlySet<string>
}

export const sheetLibraryKey = (kind: SheetLibraryKind, slug: string): string => `${kind}:${slug}`

export const displaySheetLibraryName = (item: SheetLibraryItem): string =>
  item.kind === 'pokemon' ? item.sheet.nickname : item.sheet.name

export const applyFolderRenames = (
  path: string,
  renames: ReadonlyArray<{ from: string; to: string }>,
): string => {
  let result = path
  for (const { from, to } of renames) result = renameFolderPrefix(result, from, to)
  return result
}

export const isInsideDeletedSheetFolder = (
  folder: string,
  deletedFolders: ReadonlySet<string>,
): boolean => {
  for (const path of deletedFolders) {
    if (isSameOrDescendantFolder(folder, path)) return true
  }
  return false
}

export const resolveSheetLibraryFolder = (
  item: Pick<SheetLibraryItem, 'kind' | 'slug' | 'folder'>,
  sheetOverrides: Readonly<Record<string, string | undefined>>,
  folderRenames: ReadonlyArray<{ from: string; to: string }>,
): string => {
  const key = sheetLibraryKey(item.kind, item.slug)
  const direct = Object.prototype.hasOwnProperty.call(sheetOverrides, key)
    ? sheetOverrides[key]
    : item.folder
  return applyFolderRenames(direct ?? '', folderRenames)
}

export const buildSheetLibraryItems = (options: BuildSheetLibraryItemsOptions): SheetLibraryItem[] => {
  const pokes: PokemonSheetLibraryItem[] = options.pokemonSheets.map((sheet) => {
    const speciesTypes = options.speciesTypesFor(sheet.species)
    return {
      kind: 'pokemon',
      slug: sheet.slug,
      folder: sheet.folder ?? '',
      sheet,
      types: sheet.types ?? speciesTypes ?? [],
      spriteUrl: options.spriteUrlFor(sheet.species),
      sortKey: sheet.nickname.toLowerCase(),
    }
  })

  const trainers: TrainerSheetLibraryItem[] = options.trainerSheets.map((sheet) => ({
    kind: 'trainer',
    slug: sheet.slug,
    folder: sheet.folder ?? '',
    sheet,
    sortKey: sheet.name.toLowerCase(),
  }))

  return [...pokes, ...trainers]
}

export const applySheetLibraryOverrides = (
  baseItems: ReadonlyArray<SheetLibraryItem>,
  options: SheetLibraryOverrideOptions,
): SheetLibraryItem[] => {
  const out: SheetLibraryItem[] = []

  for (const item of baseItems) {
    if (options.playerOnly && item.sheet.player !== true) continue
    if (options.deletedSheets.has(sheetLibraryKey(item.kind, item.slug))) continue

    const folder = resolveSheetLibraryFolder(item, options.sheetOverrides, options.folderRenames)
    if (isInsideDeletedSheetFolder(folder, options.deletedFolders)) continue

    const overrideKey = sheetLibraryKey(item.kind, item.slug)
    const newName = options.nameOverrides[overrideKey]
    if (item.kind === 'pokemon') {
      const sheet = newName !== undefined ? { ...item.sheet, nickname: newName } : item.sheet
      out.push({
        ...item,
        folder,
        sheet,
        sortKey: (newName ?? item.sheet.nickname).toLowerCase(),
      })
    } else {
      const sheet = newName !== undefined ? { ...item.sheet, name: newName } : item.sheet
      out.push({
        ...item,
        folder,
        sheet,
        sortKey: (newName ?? item.sheet.name).toLowerCase(),
      })
    }
  }

  return out
}

export const buildSheetFolderSet = (options: SheetFolderSetOptions): Set<string> => {
  const set = new Set<string>()
  for (const item of options.items) if (item.folder) set.add(item.folder)

  if (options.includeExtraFolders) {
    for (const path of options.extraFolders) {
      const renamed = applyFolderRenames(path, options.folderRenames)
      if (renamed && !isInsideDeletedSheetFolder(renamed, options.deletedFolders)) set.add(renamed)
    }
  }

  for (const deleted of options.deletedFolders) {
    set.delete(deleted)
    for (const folder of [...set]) {
      if (folder.startsWith(deleted + '/')) set.delete(folder)
    }
  }
  return set
}

export const matchesSheetLibraryQuery = (item: SheetLibraryItem, query: string): boolean => {
  if (item.kind === 'pokemon') {
    const { sheet, types, folder } = item
    const haystacks = [sheet.nickname, sheet.species, sheet.nature ?? '', folder, ...types]
    return haystacks.some((value) => normalizeSearchText(value).includes(query))
  }

  const { sheet, folder } = item
  const haystacks = [
    sheet.name,
    sheet.playedBy ?? '',
    sheet.skillBackground?.name ?? '',
    folder,
    ...(sheet.classes?.map((c) => c.name) ?? []),
  ]
  return haystacks.some((value) => normalizeSearchText(value).includes(query))
}
