import { computed, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { emptyAbilityClientCapabilityBundle } from '#shared/abilityAutomation/clientCapabilities'
import { LIVE_TABLE_SNAPSHOT_SCHEMA_VERSION } from '#shared/liveTableSnapshot'
import { useLiveTableSnapshotSync } from '~/composables/map-editor/useLiveTableSnapshotSync'
import { teardownLiveSheets, useLiveSheets } from '~/composables/useLiveSheets'
import { MAP_API_PATHS } from '~/utils/apiRoutes'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfileId } from '#shared/playerProfiles'
import type { TabletopMap } from '~/types/map'

const apiMocks = vi.hoisted(() => ({
  getJson: vi.fn(),
}))

vi.mock('~/composables/useApiClient', () => ({
  useApiClient: () => ({
    getJson: apiMocks.getJson,
  }),
}))

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 1,
  slug: 'arena-map',
  name: 'Arena Map',
  dimensions: { x: 6, y: 2, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
  updatedAt: 100,
  ...overrides,
})

const snapshotFixture = (overrides: Record<string, unknown> = {}) => {
  const mapRevision = typeof overrides.mapRevision === 'number' ? overrides.mapRevision : 1
  return {
    schemaVersion: LIVE_TABLE_SNAPSHOT_SCHEMA_VERSION,
    map: mapFixture(),
    mapRevision,
    interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
    interactionModeUpdatedAt: 500,
    pokemonSheets: [{ slug: 'pikachu', nickname: 'Pikachu', revision: 1 }],
    trainerSheets: [{ slug: 'ash', name: 'Ash', revision: 1 }],
    abilityCapabilities: emptyAbilityClientCapabilityBundle('arena-map', mapRevision),
    ...overrides,
  }
}

const flushPromises = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

const createHarness = (roleValue: AuthRole | null = 'gm', profileValue: PlayerProfileId | null = null) => {
  const role = ref<AuthRole | null>(roleValue)
  const playerProfileId = ref<PlayerProfileId | null>(profileValue)
  const liveSheets = useLiveSheets({ autoHydrate: false, hydrationOwner: 'snapshot-sync-test' })
  const adoptedMaps: TabletopMap[] = []
  const adoptedModes: Array<{ slug: string; interactionMode: string; updatedAt: number }> = []
  const sync = useLiveTableSnapshotSync({
    slug: 'arena-map',
    role,
    playerProfileId: computed(() => playerProfileId.value),
    sheetCache: liveSheets,
    applyMap: (map) => adoptedMaps.push(map),
    applyInteractionMode: (mode) => adoptedModes.push(mode),
  })

  return { role, playerProfileId, liveSheets, adoptedMaps, adoptedModes, sync }
}

describe('useLiveTableSnapshotSync', () => {
  beforeEach(() => {
    apiMocks.getJson.mockReset()
    delete (globalThis as { window?: unknown }).window
    teardownLiveSheets()
  })

  afterEach(() => {
    teardownLiveSheets()
    vi.restoreAllMocks()
    delete (globalThis as { window?: unknown }).window
  })

  it('loads one atomic live-state snapshot and adopts map, mode, and accessible sheets together', async () => {
    apiMocks.getJson.mockResolvedValueOnce(snapshotFixture())
    const { liveSheets, adoptedMaps, adoptedModes, sync } = createHarness('gm')

    await sync.requestSnapshot('initial load')

    expect(apiMocks.getJson).toHaveBeenCalledTimes(1)
    expect(apiMocks.getJson).toHaveBeenCalledWith(MAP_API_PATHS.liveState, {
      params: { slug: 'arena-map' },
    })
    expect(adoptedMaps).toHaveLength(1)
    expect(adoptedMaps[0]).toMatchObject({ slug: 'arena-map', revision: 1 })
    expect(adoptedModes).toEqual([{ slug: 'arena-map', interactionMode: 'live-play', updatedAt: 500 }])
    expect(liveSheets.pokemonBySlug.value.get('pikachu')).toMatchObject({ nickname: 'Pikachu', revision: 1 })
    expect(liveSheets.trainerBySlug.value.get('ash')).toMatchObject({ name: 'Ash', revision: 1 })
    expect(liveSheets.hydrated.value).toBe(true)
    expect(sync.status.value).toBe('ready')
    expect(sync.error.value).toBeNull()
  })

  it('keeps commands blocked by staying in error when snapshot validation fails before adoption', async () => {
    apiMocks.getJson.mockResolvedValueOnce(snapshotFixture({
      mapRevision: 2,
    }))
    const { liveSheets, adoptedMaps, adoptedModes, sync } = createHarness('gm')

    await expect(sync.requestSnapshot('initial load')).rejects.toThrow('mapRevision does not match')

    expect(sync.status.value).toBe('error')
    expect(sync.error.value).toContain('mapRevision does not match')
    expect(liveSheets.hydrated.value).toBe(false)
    expect(adoptedMaps).toHaveLength(0)
    expect(adoptedModes).toHaveLength(0)
  })

  it('coalesces simultaneous snapshot requests for the same access context', async () => {
    let resolveSnapshot!: (payload: unknown) => void
    apiMocks.getJson.mockReturnValueOnce(new Promise((resolve) => {
      resolveSnapshot = resolve
    }))
    const { sync } = createHarness('gm')

    const first = sync.requestSnapshot('reconnect')
    const second = sync.requestSnapshot('revision gap')

    expect(apiMocks.getJson).toHaveBeenCalledTimes(1)
    resolveSnapshot(snapshotFixture({ map: mapFixture({ revision: 2 }), mapRevision: 2 }))
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
    expect(sync.status.value).toBe('ready')
  })

  it('ignores a previous profile response after a newer profile snapshot was requested', async () => {
    let resolveProfileA!: (payload: unknown) => void
    let resolveProfileB!: (payload: unknown) => void
    apiMocks.getJson
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveProfileA = resolve
      }))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveProfileB = resolve
      }))
    const { playerProfileId, liveSheets, adoptedMaps, sync } = createHarness('player', 'profile-a' as PlayerProfileId)

    const profileARequest = sync.requestSnapshot('profile A')
    expect(apiMocks.getJson).toHaveBeenLastCalledWith(MAP_API_PATHS.liveState, {
      params: { slug: 'arena-map', profileId: 'profile-a' },
    })

    playerProfileId.value = 'profile-b' as PlayerProfileId
    const profileBRequest = sync.requestSnapshot('profile B')

    expect(liveSheets.hydrated.value).toBe(false)
    expect(liveSheets.pokemonBySlug.value.size).toBe(0)
    expect(apiMocks.getJson).toHaveBeenLastCalledWith(MAP_API_PATHS.liveState, {
      params: { slug: 'arena-map', profileId: 'profile-b' },
    })

    resolveProfileB(snapshotFixture({
      map: mapFixture({ revision: 3, name: 'Profile B Map' }),
      mapRevision: 3,
      pokemonSheets: [{ slug: 'eevee', nickname: 'Profile B Eevee', revision: 1 }],
      trainerSheets: [],
    }))
    await profileBRequest

    resolveProfileA(snapshotFixture({
      map: mapFixture({ revision: 2, name: 'Profile A Map' }),
      mapRevision: 2,
      pokemonSheets: [{ slug: 'pikachu', nickname: 'Profile A Pikachu', revision: 1 }],
      trainerSheets: [],
    }))
    await profileARequest
    await flushPromises()

    expect(adoptedMaps.at(-1)).toMatchObject({ name: 'Profile B Map', revision: 3 })
    expect(liveSheets.pokemonBySlug.value.has('pikachu')).toBe(false)
    expect(liveSheets.pokemonBySlug.value.get('eevee')).toMatchObject({ nickname: 'Profile B Eevee' })
    expect(sync.status.value).toBe('ready')
  })

  it('removes profile A sheets immediately when profile B starts loading', async () => {
    apiMocks.getJson.mockResolvedValueOnce(snapshotFixture({
      pokemonSheets: [{ slug: 'pikachu', nickname: 'Profile A Pikachu', revision: 1 }],
      trainerSheets: [],
    }))
    const { playerProfileId, liveSheets, sync } = createHarness('player', 'profile-a' as PlayerProfileId)
    await sync.requestSnapshot('profile A')

    expect(liveSheets.hydrated.value).toBe(true)
    expect(liveSheets.pokemonBySlug.value.has('pikachu')).toBe(true)

    apiMocks.getJson.mockReturnValueOnce(new Promise(() => undefined))
    playerProfileId.value = 'profile-b' as PlayerProfileId
    void sync.requestSnapshot('profile B')

    expect(liveSheets.hydrated.value).toBe(false)
    expect(liveSheets.pokemonBySlug.value.size).toBe(0)
    expect(liveSheets.accessScopeKey.value).toBe('player:profile-b')
  })
})
