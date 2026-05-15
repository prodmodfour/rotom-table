import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  useTokenSheetMutations,
  type SavePlacedSheetRequest,
} from '~/composables/map-editor/useTokenSheetMutations'
import { applyConditionsToSheet } from '~/utils/sheetMutations'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'sheet-mutation-test',
  name: 'Sheet Mutation Test',
  dimensions: { x: 4, y: 2, z: 4 },
  voxels: [],
  hazards: [],
  placements: [
    { id: 'token-1', sheetKind: 'pokemon', sheetSlug: 'bolt', position: { x: 0, y: 0, z: 0 } },
  ],
})

const pokemon = (): CharacterSheet => ({
  slug: 'bolt',
  nickname: 'Bolt',
  species: 'Bulbasaur',
  level: 5,
  folder: 'party/a',
  combat: { currentHp: 1, conditions: [] },
  stats: {},
  abilities: [{ name: 'Sand Veil' }],
} as CharacterSheet)

const makeMutations = (options: {
  canControl?: boolean
  saveSheet?: (request: SavePlacedSheetRequest) => Promise<void>
  logError?: (label: string, error: unknown) => void
} = {}) => {
  const map = ref(mapFixture())
  const pokemonSheet = pokemon()
  const pokemonSheets = new Map([[pokemonSheet.slug, pokemonSheet]])
  const trainerSheets = new Map<string, TrainerSheet>()
  const saved: SavePlacedSheetRequest[] = []
  const saveSheet = options.saveSheet ?? (async (request: SavePlacedSheetRequest) => {
    saved.push(request)
  })

  return {
    map,
    pokemonSheets,
    saved,
    mutations: useTokenSheetMutations({
      map,
      sheetLookup: computed(() => ({ pokemon: pokemonSheets, trainer: trainerSheets })),
      canControlPlacement: () => options.canControl ?? true,
      getClientId: () => 'client-1',
      saveSheet,
      logError: options.logError,
    }),
  }
}

describe('useTokenSheetMutations', () => {
  it('optimistically updates a placed sheet and persists a folder-free payload', async () => {
    const { mutations, pokemonSheets, saved } = makeMutations()

    const ok = await mutations.updatePlacedSheet(
      'token-1',
      (kind, sheet) => applyConditionsToSheet(kind, sheet, ['Poisoned']),
      'testUpdate',
    )

    expect(ok).toBe(true)
    expect(pokemonSheets.get('bolt')?.combat?.conditions).toEqual(['Poisoned'])
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      kind: 'pokemon',
      slug: 'bolt',
      clientId: 'client-1',
    })
    expect(saved[0].sheet).not.toHaveProperty('folder')
    expect(saved[0].sheet).toMatchObject({ slug: 'bolt' })
  })

  it('activates sheet ability automation and persists it', async () => {
    const { mutations, pokemonSheets, saved } = makeMutations()

    await mutations.modifyAbilityActivation({ id: 'token-1', abilityName: 'Sand Veil', activated: true })

    expect(pokemonSheets.get('bolt')?.abilities?.[0]).toMatchObject({ name: 'Sand Veil', activated: true })
    expect(saved).toHaveLength(1)
  })

  it('rolls back the optimistic update when persistence fails', async () => {
    const failure = new Error('save failed')
    const logError = vi.fn()
    const { mutations, pokemonSheets } = makeMutations({
      saveSheet: async () => { throw failure },
      logError,
    })

    await mutations.modifyConditions({ id: 'token-1', conditions: ['Burned'] })

    expect(pokemonSheets.get('bolt')?.combat?.conditions).toEqual([])
    expect(logError).toHaveBeenCalledWith('modifyConditions', failure)
  })

  it('honors token control by default but allows move automation to update any target', async () => {
    const { mutations, pokemonSheets, saved } = makeMutations({ canControl: false })

    await mutations.modifyConditions({ id: 'token-1', conditions: ['Burned'] })
    expect(pokemonSheets.get('bolt')?.combat?.conditions).toEqual([])
    expect(saved).toHaveLength(0)

    await mutations.modifyConditions(
      { id: 'token-1', conditions: ['Burned'] },
      { allowAnyTarget: true },
    )
    expect(pokemonSheets.get('bolt')?.combat?.conditions).toEqual(['Burned'])
    expect(saved).toHaveLength(1)
  })
})
