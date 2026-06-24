import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useMapPageTokenSpawning } from '~/composables/map-editor/useMapPageTokenSpawning'
import { useTokenControls } from '~/composables/map-editor/useTokenControls'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'spawn-test',
  name: 'Spawn Test',
  dimensions: { x: 6, y: 2, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
})

const pokemon = (): CharacterSheet => ({
  slug: 'bolt',
  nickname: 'Bolt',
  species: 'Bulbasaur',
  level: 5,
  stats: {},
} as CharacterSheet)

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

const makeSpawnHarness = (options: {
  setupEdit?: boolean
  snapshotReady?: boolean
  spawnToken?: (payload: { placement: SheetPlacement }) => Promise<{ dispatched: boolean }>
  ids?: string[]
} = {}) => {
  const map = ref(mapFixture())
  const sheet = pokemon()
  const idFactory = vi.fn(() => options.ids?.shift() ?? 'spawned-token')
  const controls = useTokenControls({
    map,
    pokemonBySlug: ref(new Map([[sheet.slug, sheet]])),
    trainerBySlug: ref(new Map()),
    mapVoxels: computed(() => map.value?.voxels ?? []),
    mapGroundLevelY: computed(() => map.value?.groundLevelY ?? 0),
    canSpawnTokens: ref(true),
    canControlAllTokens: ref(true),
    createPlacementId: idFactory,
  })
  const spawnToken = vi.fn(options.spawnToken ?? (async () => ({ dispatched: true })))
  const spawning = useMapPageTokenSpawning({
    isSetupEditMode: () => options.setupEdit ?? false,
    authoritativeSnapshotReady: ref(options.snapshotReady ?? true),
    createSpawnPlacement: controls.createSpawnPlacement,
    spawnSheetForSetupEdit: controls.spawnSheetForSetupEdit,
    spawnToken,
  })
  return {
    map,
    sheet,
    controls,
    idFactory,
    spawnToken,
    ...spawning,
  }
}

describe('useMapPageTokenSpawning', () => {
  it('uses setup/edit local spawning and never calls the live spawn route', async () => {
    const harness = makeSpawnHarness({ setupEdit: true, ids: ['setup-spawn'] })

    await expect(harness.spawnSheetFromMenu({ kind: 'pokemon', sheet: harness.sheet })).resolves.toBe(true)

    expect(harness.map.value.placements).toHaveLength(1)
    expect(harness.map.value.placements[0]).toMatchObject({ id: 'setup-spawn', sheetSlug: 'bolt' })
    expect(harness.spawnToken).not.toHaveBeenCalled()
    expect(harness.idFactory).toHaveBeenCalledTimes(1)
  })

  it('requires an authoritative snapshot before planning a live spawn', async () => {
    const harness = makeSpawnHarness({ snapshotReady: false, ids: ['should-not-generate'] })

    await expect(harness.spawnSheetFromMenu({ kind: 'pokemon', sheet: harness.sheet })).resolves.toBe(false)

    expect(harness.map.value.placements).toEqual([])
    expect(harness.spawnToken).not.toHaveBeenCalled()
    expect(harness.idFactory).not.toHaveBeenCalled()
  })

  it('dispatches live spawns without mutating placements before the command response', async () => {
    const pending = deferred<{ dispatched: boolean }>()
    const harness = makeSpawnHarness({
      ids: ['live-spawn'],
      spawnToken: () => pending.promise,
    })

    const result = harness.spawnSheetFromMenu({ kind: 'pokemon', sheet: harness.sheet })

    expect(harness.spawnToken).toHaveBeenCalledTimes(1)
    expect(harness.spawnToken).toHaveBeenCalledWith({
      placement: expect.objectContaining({ id: 'live-spawn', sheetSlug: 'bolt' }),
    })
    expect(harness.map.value.placements).toEqual([])
    expect(harness.spawnSheetPending.value).toBe(true)

    pending.resolve({ dispatched: true })
    await expect(result).resolves.toBe(true)
    expect(harness.spawnSheetPending.value).toBe(false)
    expect(harness.map.value.placements).toEqual([])
  })

  it('leaves placements unchanged when a live spawn is rejected or transport fails', async () => {
    const rejected = makeSpawnHarness({
      ids: ['rejected-spawn'],
      spawnToken: async () => ({ dispatched: false }),
    })

    await expect(rejected.spawnSheetFromMenu({ kind: 'pokemon', sheet: rejected.sheet })).resolves.toBe(false)
    expect(rejected.map.value.placements).toEqual([])

    const failed = makeSpawnHarness({
      ids: ['failed-spawn'],
      spawnToken: async () => { throw new Error('network down') },
    })

    await expect(failed.spawnSheetFromMenu({ kind: 'pokemon', sheet: failed.sheet })).resolves.toBe(false)
    expect(failed.map.value.placements).toEqual([])
  })

  it('does not append a live accepted spawn after the authoritative adoption path applies it', async () => {
    const harness = makeSpawnHarness({
      ids: ['accepted-spawn'],
      spawnToken: async ({ placement }) => {
        harness.map.value.placements.push({ ...placement })
        return { dispatched: true }
      },
    })

    await expect(harness.spawnSheetFromMenu({ kind: 'pokemon', sheet: harness.sheet })).resolves.toBe(true)

    expect(harness.map.value.placements.map((placement) => placement.id)).toEqual(['accepted-spawn'])
    expect(harness.spawnToken).toHaveBeenCalledTimes(1)
  })

  it('blocks repeated live spawn clicks while one command is pending without generating extra ids', async () => {
    const pending = deferred<{ dispatched: boolean }>()
    const harness = makeSpawnHarness({
      ids: ['first-id', 'second-id'],
      spawnToken: () => pending.promise,
    })

    const first = harness.spawnSheetFromMenu({ kind: 'pokemon', sheet: harness.sheet })
    await expect(harness.spawnSheetFromMenu({ kind: 'pokemon', sheet: harness.sheet })).resolves.toBe(false)

    expect(harness.spawnToken).toHaveBeenCalledTimes(1)
    expect(harness.idFactory).toHaveBeenCalledTimes(1)
    expect(harness.spawnToken).toHaveBeenCalledWith({
      placement: expect.objectContaining({ id: 'first-id' }),
    })

    pending.resolve({ dispatched: true })
    await expect(first).resolves.toBe(true)
  })
})
