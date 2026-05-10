import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  useSheetLibraryActions,
  type SheetLibraryContextTarget,
} from '~/composables/library/useSheetLibraryActions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { sheetLibraryKey, type SheetLibraryItem } from '~/utils/sheetLibrary'

const makePokemonItem = (overrides: Partial<SheetLibraryItem> = {}): SheetLibraryItem => ({
  kind: 'pokemon',
  slug: 'ember',
  folder: 'party/sub',
  sheet: {
    slug: 'ember',
    nickname: 'Ember',
    species: 'Charmander',
    level: 5,
    folder: 'party/sub',
  } as CharacterSheet,
  types: ['Fire'],
  spriteUrl: null,
  sortKey: 'ember',
  ...overrides,
} as SheetLibraryItem)

const makeTrainerItem = (overrides: Partial<SheetLibraryItem> = {}): SheetLibraryItem => ({
  kind: 'trainer',
  slug: 'oak',
  folder: 'npcs',
  sheet: {
    slug: 'oak',
    name: 'Professor Oak',
    level: 10,
    folder: 'npcs',
  } as TrainerSheet,
  sortKey: 'professor oak',
  ...overrides,
} as SheetLibraryItem)

const makeHarness = () => {
  const pokemon = makePokemonItem()
  const trainer = makeTrainerItem()
  const currentPath = ref('party/sub')
  const allFolders = ref(new Set(['party', 'party/sub', 'archive', 'npcs']))
  const items = ref<SheetLibraryItem[]>([pokemon, trainer])
  const extraFolders = new Set(['party/sub/empty', 'npcs/archive'])
  const sheetOverrides: Record<string, string | undefined> = {}
  const folderRenames = ref<Array<{ from: string; to: string }>>([])
  const nameOverrides: Record<string, string | undefined> = {}
  const deletedSheets = new Set<string>()
  const deletedFolders = new Set<string>()
  const goToFolder = vi.fn()

  const moveSheet = vi.fn(async () => undefined)
  const moveFolder = vi.fn(async () => undefined)
  const renameSheet = vi.fn(async () => undefined)
  const deleteSheet = vi.fn(async () => undefined)
  const deleteFolder = vi.fn(async () => undefined)

  const actions = useSheetLibraryActions({
    currentPath,
    allFolders,
    items,
    extraFolders,
    sheetOverrides,
    folderRenames,
    nameOverrides,
    deletedSheets,
    deletedFolders,
    goToFolder,
    moveSheet,
    moveFolder,
    renameSheet,
    deleteSheet,
    deleteFolder,
  })

  return {
    actions,
    pokemon,
    trainer,
    currentPath,
    allFolders,
    items,
    extraFolders,
    sheetOverrides,
    folderRenames,
    nameOverrides,
    deletedSheets,
    deletedFolders,
    goToFolder,
    moveSheet,
    moveFolder,
    renameSheet,
    deleteSheet,
    deleteFolder,
  }
}

describe('useSheetLibraryActions', () => {
  it('validates and persists drag/drop moves through injected handlers', async () => {
    const harness = makeHarness()

    expect(harness.actions.canDropPayloadOn({
      type: 'sheet',
      kind: 'pokemon',
      slug: 'ember',
      from: 'party/sub',
    }, 'party/sub')).toBe(false)
    expect(harness.actions.canDropPayloadOn({ type: 'folder', path: 'party' }, 'party/sub')).toBe(false)
    expect(harness.actions.canDropPayloadOn({ type: 'folder', path: 'party' }, 'archive')).toBe(true)

    await harness.actions.movePayload({
      type: 'sheet',
      kind: 'pokemon',
      slug: 'ember',
      from: 'party/sub',
    }, 'archive')
    expect(harness.moveSheet).toHaveBeenCalledWith({ kind: 'pokemon', slug: 'ember', folder: 'archive' })
    expect(harness.sheetOverrides[sheetLibraryKey('pokemon', 'ember')]).toBe('archive')

    await harness.actions.movePayload({ type: 'folder', path: 'party' }, 'archive')
    expect(harness.moveFolder).toHaveBeenCalledWith({ from: 'party', to: 'archive/party' })
    expect(harness.folderRenames.value).toEqual([{ from: 'party', to: 'archive/party' }])
  })

  it('builds context labels, rename defaults, and move destinations', () => {
    const harness = makeHarness()
    const sheetTarget: SheetLibraryContextTarget = { type: 'sheet', item: harness.pokemon }
    const folderTarget: SheetLibraryContextTarget = {
      type: 'folder',
      tile: { path: 'party/sub', label: 'Sub', count: 1 },
    }

    expect(harness.actions.targetLabel(sheetTarget)).toBe('Ember')
    expect(harness.actions.targetLabel(folderTarget)).toBe('Sub')
    expect(harness.actions.renameInputForTarget(folderTarget)).toBe('sub')
    expect(harness.actions.moveDestinationsForTarget(sheetTarget).map((item) => item.value))
      .toEqual(['', 'archive', 'npcs', 'party'])
  })

  it('renames sheets and folders while following the current folder when needed', async () => {
    const harness = makeHarness()

    await harness.actions.renameTarget({ type: 'sheet', item: harness.pokemon }, 'Cinder')
    expect(harness.renameSheet).toHaveBeenCalledWith({ kind: 'pokemon', slug: 'ember', name: 'Cinder' })
    expect(harness.nameOverrides[sheetLibraryKey('pokemon', 'ember')]).toBe('Cinder')

    await harness.actions.renameTarget({
      type: 'folder',
      tile: { path: 'party', label: 'Party', count: 1 },
    }, 'crew')
    expect(harness.moveFolder).toHaveBeenCalledWith({ from: 'party', to: 'crew' })
    expect(harness.folderRenames.value).toEqual([{ from: 'party', to: 'crew' }])
    expect(harness.goToFolder).toHaveBeenCalledWith('crew/sub')
  })

  it('deletes sheets and folder subtrees through local optimistic state', async () => {
    const harness = makeHarness()

    await harness.actions.deleteTarget({ type: 'sheet', item: harness.trainer })
    expect(harness.deleteSheet).toHaveBeenCalledWith({ kind: 'trainer', slug: 'oak' })
    expect(harness.deletedSheets.has(sheetLibraryKey('trainer', 'oak'))).toBe(true)

    await harness.actions.deleteTarget({
      type: 'folder',
      tile: { path: 'party', label: 'Party', count: 1 },
    })
    expect(harness.deleteFolder).toHaveBeenCalledWith({ folder: 'party' })
    expect(harness.deletedFolders.has('party')).toBe(true)
    expect(harness.deletedSheets.has(sheetLibraryKey('pokemon', 'ember'))).toBe(true)
    expect([...harness.extraFolders]).toEqual(['npcs/archive'])
    expect(harness.goToFolder).toHaveBeenCalledWith('')
  })
})
