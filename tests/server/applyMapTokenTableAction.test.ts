import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  MapTokenTableActionUseCaseError,
  useMapTokenAbilityUseCase,
  useMapTokenManeuverUseCase,
  useMapTokenOrderUseCase,
} from '../../server/useCases/applyMapTokenTableAction'
import { MAPS_ROOT } from '../../server/utils/mapPaths'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '../../shared/playerProfiles'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

const playerProfile = (linkedCharacters: PlayerProfile['linkedCharacters']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_actions' as PlayerProfileId,
  displayName: 'Action Player' as PlayerProfileDisplayName,
  linkedCharacters,
})

const baseMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 7,
  slug: 'arena',
  name: 'Arena',
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'sandile', position: { x: 0, y: 0, z: 0 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', position: { x: 2, y: 0, z: 0 } },
    { id: 'trainer', sheetKind: 'trainer', sheetSlug: 'lenora', position: { x: 1, y: 0, z: 0 } },
  ],
  lights: [],
  initiative: { activeId: 'trainer', round: 2 },
  metadata: { owner: 'gm' },
  createdAt: 10,
  updatedAt: 20,
  ...overrides,
})

const pokemonSheet = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  revision: 3,
  slug: 'sandile',
  nickname: 'Sandile',
  species: 'Sandile',
  level: 5,
  stats: {},
  combat: { currentHp: 20, conditions: [] },
  abilities: [{ name: 'Intimidate' }],
  movelist: [],
  ...overrides,
} as CharacterSheet)

const trainerSheet = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  revision: 3,
  slug: 'lenora',
  name: 'Lenora',
  level: 5,
  stats: {},
  currentHp: 20,
  features: [{ name: 'Agility Training' }],
  currentTeam: ['sandile'],
  ...overrides,
} as TrainerSheet)

const createDeps = (options: {
  map?: TabletopMap
  sheets?: Record<string, CharacterSheet | TrainerSheet>
  now?: number
  idFactory?: () => string
} = {}) => {
  const path = join(MAPS_ROOT, 'arena.json')
  const mapWrites: Array<{ path: string; map: TabletopMap }> = []
  const sheetWrites: Array<{ path: string; sheet: Record<string, unknown> }> = []
  const sheets = options.sheets ?? {
    'pokemon:sandile': pokemonSheet(),
    'pokemon:target': pokemonSheet({
      slug: 'target',
      nickname: 'Target',
      species: 'Pikachu',
      stats: { atk: { stage: 2 } },
      abilities: [],
    }),
    'trainer:lenora': trainerSheet(),
  }

  const deps = {
    findMapPath: vi.fn((slug: string) => (slug === 'arena' ? path : null)),
    readMap: vi.fn(() => options.map ?? baseMap()),
    writeMap: vi.fn((filePath: string, map: TabletopMap) => {
      mapWrites.push({ path: filePath, map })
    }),
    readSheet: vi.fn((kind: 'pokemon' | 'trainer', slug: string) => {
      const sheet = sheets[`${kind}:${slug}`]
      return sheet ? { path: `/repo/data/${kind}/${slug}.json`, sheet } : null
    }),
    writeSheet: vi.fn((filePath: string, sheet: Record<string, unknown>) => {
      sheetWrites.push({ path: filePath, sheet })
    }),
    now: vi.fn(() => options.now ?? 5000),
    idFactory: options.idFactory,
    relativePath: vi.fn((filePath: string) => filePath.replace('/repo/', '')),
  }

  return { deps, path, mapWrites, sheetWrites }
}

describe('document-backed map token table actions', () => {
  it('persists linked player maneuver usage on the saved map document', () => {
    const { deps, path, mapWrites, sheetWrites } = createDeps({ now: 1111 })

    const result = useMapTokenManeuverUseCase({
      role: 'player',
      slug: 'arena',
      placementId: 'actor',
      maneuverName: 'Trip',
      targetPlacementId: 'target',
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'sandile' }]),
      clientId: 'client-1',
    }, deps)

    expect(sheetWrites).toEqual([])
    expect(mapWrites).toHaveLength(1)
    expect(mapWrites[0]?.path).toBe(path)
    expect(mapWrites[0]?.map.revision).toBe(8)
    expect(mapWrites[0]?.map.metadata?.maneuverLog).toMatchObject([
      {
        at: 1111,
        userId: 'actor',
        maneuverName: 'Trip',
        lines: expect.arrayContaining(['Sandile used Trip.', 'Target: Target']),
      },
    ])
    expect(result.action).toMatchObject({ type: 'maneuver', placementId: 'actor', targetPlacementId: 'target', name: 'Trip' })
    expect(result.events.map((event) => event.channel)).toEqual(['map:arena', 'maps'])
  })

  it('lets a linked player ability update target sheet state and map logs without target control', () => {
    const { deps, mapWrites, sheetWrites } = createDeps({ now: 2222 })

    const result = useMapTokenAbilityUseCase({
      role: 'player',
      slug: 'arena',
      placementId: 'actor',
      abilityName: 'Intimidate',
      targetPlacementId: 'target',
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'sandile' }]),
      clientId: 'client-2',
    }, deps)

    expect(mapWrites).toHaveLength(1)
    expect(mapWrites[0]?.map.revision).toBe(8)
    expect(mapWrites[0]?.map.metadata?.abilityLog).toMatchObject([
      {
        at: 2222,
        userId: 'actor',
        abilityName: 'Intimidate',
        category: 'map',
      },
    ])
    expect(sheetWrites).toHaveLength(1)
    expect(sheetWrites[0]).toMatchObject({ path: '/repo/data/pokemon/target.json' })
    expect(sheetWrites[0]?.sheet.revision).toBe(4)
    expect(sheetWrites[0]?.sheet.stats).toMatchObject({ atk: { stage: 1 } })
    expect(result.sheetUpdates).toHaveLength(1)
    expect(result.events.map((event) => event.channel)).toEqual([
      'map:arena',
      'maps',
      'sheet:pokemon:target',
      'sheets',
    ])
  })

  it('persists linked trainer orders and active order effects', () => {
    const { deps, mapWrites } = createDeps({ now: 3333, idFactory: () => 'order-effect' })

    useMapTokenOrderUseCase({
      role: 'player',
      slug: 'arena',
      placementId: 'trainer',
      orderName: 'Agility Training',
      targetPlacementId: 'actor',
      playerProfile: playerProfile([{ sheetKind: 'trainer', sheetSlug: 'lenora' }]),
    }, deps)

    expect(mapWrites).toHaveLength(1)
    expect(mapWrites[0]?.map.revision).toBe(8)
    expect(mapWrites[0]?.map.metadata?.activeOrderEffects).toMatchObject([
      {
        id: 'order-effect',
        userId: 'trainer',
        orderName: 'Agility Training',
        targetId: 'actor',
      },
    ])
    expect(mapWrites[0]?.map.metadata?.orderLog).toMatchObject([
      {
        at: 3333,
        orderName: 'Agility Training',
        lines: expect.arrayContaining(['Lenora used Agility Training.', 'Target: Sandile']),
      },
    ])
  })

  it('rejects unlinked player table actions before writing', () => {
    const { deps, mapWrites, sheetWrites } = createDeps()

    expect(() => useMapTokenManeuverUseCase({
      role: 'player',
      slug: 'arena',
      placementId: 'actor',
      maneuverName: 'Trip',
      playerProfile: playerProfile([{ sheetKind: 'trainer', sheetSlug: 'lenora' }]),
    }, deps)).toThrow(MapTokenTableActionUseCaseError)

    try {
      useMapTokenAbilityUseCase({
        role: 'player',
        slug: 'arena',
        placementId: 'actor',
        abilityName: 'Intimidate',
        targetPlacementId: 'target',
        playerProfile: null,
      }, deps)
    } catch (err) {
      expect(err).toMatchObject({
        statusCode: 403,
        message: 'Select a player profile to control linked map tokens',
      })
    }
    expect(mapWrites).toEqual([])
    expect(sheetWrites).toEqual([])
  })

  it('keeps GM table actions unrestricted on hidden maps', () => {
    const { deps, mapWrites } = createDeps({ map: baseMap({ playerVisible: false }) })

    useMapTokenManeuverUseCase({
      role: 'gm',
      slug: 'arena',
      placementId: 'actor',
      maneuverName: 'Trip',
      targetPlacementId: 'target',
      playerProfile: null,
    }, deps)

    expect(mapWrites).toHaveLength(1)
    expect(mapWrites[0]?.map.metadata?.maneuverLog).toHaveLength(1)
  })
})
