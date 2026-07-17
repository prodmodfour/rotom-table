import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createEmptyEncounterHistory } from '#shared/moveAutomation/encounterHistory'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type DeleteTokenLivePlayCommand,
  type MoveTokenLivePlayCommand,
  type SendOutPokemonLivePlayCommand,
  type SpawnTokenLivePlayCommand,
} from '#shared/livePlayCommands'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { createInMemoryLivePlayOpStore } from '~~/server/livePlay/opStore'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'
import { executeMapTokenLivePlayCommandUseCase } from '~~/server/useCases/applyMapTokenAction'
import { spendEncounterMoveResourceCosts } from '~~/server/domain/moveAutomation/reduceEncounterResources'
import { openRotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { MAPS_ROOT } from '~~/server/utils/mapPaths'
import type { TabletopMap } from '~/types/map'

const playerProfile = (linkedCharacters: PlayerProfile['linkedCharacters']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_mapactor' as PlayerProfileId,
  displayName: 'Map Actor' as PlayerProfileDisplayName,
  linkedCharacters,
})

const baseMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 4,
  slug: 'arena',
  name: 'Arena',
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    {
      id: 'linked-token',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
      position: { x: 1, y: 0, z: 1 },
      sideId: 'heroes',
      facing: 'south-east',
      turned: false,
    },
    {
      id: 'unlinked-token',
      sheetKind: 'trainer',
      sheetSlug: 'giovanni',
      position: { x: 2, y: 0, z: 2 },
      sideId: 'rivals',
      facing: 'north-west',
      turned: true,
    },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  encounterState: {
    schemaVersion: 1,
    sides: {
      heroes: { id: 'heroes', label: 'Heroes', color: '#33aa44', status: 'active' },
      rivals: { id: 'rivals', label: 'Rivals', color: '#aa3344', status: 'active' },
      wild: { id: 'wild', label: 'Wild', status: 'active' },
    },
    effects: [],
    counters: {},
    history: createEmptyEncounterHistory(),
    turnResources: {},
    zones: [],
    pendingResolutionSummaries: [],
  },
  metadata: { owner: 'gm' },
  createdAt: 10,
  updatedAt: 20,
  ...overrides,
})

const moveCommand = (
  overrides: Partial<MoveTokenLivePlayCommand> = {},
): MoveTokenLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_mapmovetest01',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
  scopes: [{ kind: 'token', placementId: 'linked-token', field: 'position' }],
  payload: {
    placementId: 'linked-token',
    position: { x: 4, y: 0, z: 1 },
    pathLength: 999,
  },
  ...overrides,
})

const spawnCommand = (
  overrides: Partial<SpawnTokenLivePlayCommand> = {},
): SpawnTokenLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_mapspawntest',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN,
  scopes: [{ kind: 'token', placementId: 'spawned-eevee', field: 'spawn' }],
  payload: {
    placement: {
      id: 'spawned-eevee',
      sheetKind: 'pokemon',
      sheetSlug: 'eevee',
      position: { x: 3, y: 0, z: 3 },
      sideId: 'wild',
      facing: 'south-east',
      turned: false,
    },
  },
  ...overrides,
})

const sendOutCommand = (
  overrides: Partial<SendOutPokemonLivePlayCommand> = {},
): SendOutPokemonLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_mapsendout1',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON,
  scopes: [
    { kind: 'token', placementId: 'unlinked-token', field: 'sendOut' },
    { kind: 'token', placementId: 'sent-out-eevee', field: 'spawn' },
  ],
  payload: {
    trainerId: 'unlinked-token',
    pokemonSlug: 'eevee',
    tokenId: 'sent-out-eevee',
    position: { x: 3, y: 0, z: 2 },
    facing: 'south-east',
  },
  ...overrides,
})

const deleteCommand = (
  overrides: Partial<DeleteTokenLivePlayCommand> = {},
): DeleteTokenLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_mapdeletetest',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN,
  scopes: [{ kind: 'token', placementId: 'linked-token', field: 'delete' }],
  payload: { placementId: 'linked-token' },
  ...overrides,
})

const createHarness = (initialMap: TabletopMap = baseMap()) => {
  const path = join(MAPS_ROOT, 'arena.json')
  let storedMap = initialMap
  const writes: TabletopMap[] = []
  const published: unknown[] = []
  const executor = createAuthoritativeLivePlayCommandExecutor({
    opStore: createInMemoryLivePlayOpStore(),
    queue: createInProcessMapWriteQueue(),
    ...acceptedRealtimeTestHooks(published),
  })
  const mapRepository = {
    getBySlug: vi.fn((slug: string) => (slug === 'arena' ? storedMap : null)),
    applyLivePlayUpdate: vi.fn((input: { slug: string; expectedRevision: number; nextMap: TabletopMap }) => {
      if (input.slug !== 'arena' || input.expectedRevision !== storedMap.revision) return 'stale' as const
      storedMap = {
        ...input.nextMap,
        revision: input.expectedRevision + 1,
      }
      writes.push(storedMap)
      return 'applied' as const
    }),
  }
  const deps = {
    mapRepository,
    database: { withTransaction: <T>(work: () => T) => work() },
    readSheet: vi.fn((kind: string, slug: string) => ({
      sheet: kind === 'pokemon'
        ? {
            slug,
            nickname: 'Bolt',
            species: 'Pikachu',
            level: 10,
            revision: 1,
            capabilities: { overland: 6 },
          }
        : {
            slug,
            name: 'Boss',
            level: 10,
            revision: 1,
            currentTeam: ['eevee'],
            capabilities: { overland: 5 },
          },
    })),
    relativePath: vi.fn((filePath: string) => filePath.replace(`${MAPS_ROOT}/`, 'data/maps/')),
    now: vi.fn(() => 2000),
    commandExecutor: executor,
  }

  return {
    deps,
    writes,
    published,
    get storedMap() {
      return storedMap
    },
  }
}

describe('live-play map token commands', () => {
  it('applies a GM move through the authoritative executor, increments revision, and publishes revisioned events', async () => {
    const harness = createHarness(baseMap({ playerVisible: false }))

    const response = await executeMapTokenLivePlayCommandUseCase({
      role: 'gm',
      command: moveCommand({
        payload: { placementId: 'unlinked-token', position: { x: 5, y: 0, z: 5 } },
        scopes: [{ kind: 'token', placementId: 'unlinked-token', field: 'position' }],
      }),
      clientId: 'gm-client',
      playerProfile: null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
    }, harness.deps)

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.writes).toHaveLength(1)
    expect(harness.storedMap.revision).toBe(5)
    expect(harness.storedMap.placements[1]).toMatchObject({
      id: 'unlinked-token',
      position: { x: 5, y: 0, z: 5 },
      sideId: 'rivals',
      facing: 'south-east',
    })
    expect(response.map).toBe(harness.storedMap)
    expect(harness.published).toEqual([
      expect.objectContaining({
        channel: 'map:arena',
        type: 'live-play-command-accepted',
        mapSlug: 'arena',
        previousRevision: 4,
        revision: 5,
        opId: 'op_mapmovetest01',
        clientId: 'gm-client',
        patches: expect.arrayContaining([expect.objectContaining({ revision: 5 })]),
      }),
    ])
  })

  it('applies a controlled player move and logs the server-derived cost instead of the client hint', async () => {
    const harness = createHarness()

    const response = await executeMapTokenLivePlayCommandUseCase({
      role: 'player',
      command: moveCommand(),
      clientId: 'player-client',
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }]),
      expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
    }, harness.deps)

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(response.placement).toMatchObject({
      id: 'linked-token',
      position: { x: 4, y: 0, z: 1 },
      facing: 'north-east',
      turned: false,
    })
    expect(harness.storedMap.encounterState?.turnResources['linked-token']).toMatchObject({
      actions: { shift: { spent: 1 } },
      movement: { budget: 6, spent: 3 },
    })
    expect(response.result).toMatchObject({
      patches: [{
        type: 'token.position',
        payload: {
          turnResources: {
            previous: {},
            current: {
              'linked-token': {
                actions: { shift: { spent: 1 } },
                movement: { budget: 6, spent: 3 },
              },
            },
          },
        },
      }],
    })
    expect(harness.storedMap.metadata?.movementLog).toMatchObject([
      {
        at: 2000,
        userId: 'linked-token',
        userName: 'Bolt',
        from: { x: 1, y: 0, z: 1 },
        to: { x: 4, y: 0, z: 1 },
        pathLength: 3,
      },
    ])
  })

  it('enforces reachability, restricts the explicit override to GMs, and never clamps destinations', async () => {
    const arena = baseMap({ dimensions: { x: 10, y: 3, z: 10 } })
    const configureSlowActor = (harness: ReturnType<typeof createHarness>) => {
      harness.deps.readSheet.mockImplementation((kind: string, slug: string) => ({
        sheet: kind === 'pokemon'
          ? {
              slug,
              nickname: 'Bolt',
              species: 'Pikachu',
              level: 10,
              revision: 1,
              capabilities: { overland: 2 },
            }
          : {
              slug,
              name: 'Boss',
              level: 10,
              revision: 1,
              currentTeam: ['eevee'],
              capabilities: { overland: 5 },
            },
      }))
    }

    const playerHarness = createHarness(arena)
    configureSlowActor(playerHarness)
    const playerProfileInput = playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }])
    const tooFar = await executeMapTokenLivePlayCommandUseCase({
      role: 'player',
      command: moveCommand({
        opId: 'op_standardtoofar',
        payload: { placementId: 'linked-token', position: { x: 8, y: 0, z: 1 }, pathLength: 0 },
      }),
      playerProfile: playerProfileInput,
      expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
    }, playerHarness.deps)
    const forgedOverride = await executeMapTokenLivePlayCommandUseCase({
      role: 'player',
      command: moveCommand({
        opId: 'op_playergmovr',
        payload: {
          placementId: 'linked-token',
          position: { x: 8, y: 0, z: 1 },
          movementPolicy: 'gm-override',
        },
      }),
      playerProfile: playerProfileInput,
      expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
    }, playerHarness.deps)

    expect(tooFar.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      currentRevision: 4,
      message: expect.stringContaining('movement-cost-exceeds-limit'),
    })
    expect(forgedOverride.result).toMatchObject({
      ok: false,
      reason: 'unauthorized',
      currentRevision: 4,
      message: 'Only a GM can request the explicit movement override policy',
    })
    expect(playerHarness.writes).toEqual([])

    const exhaustedGmResources = spendEncounterMoveResourceCosts({}, {
      placementId: 'linked-token',
      canonicalMoveId: 'Seed Exhausted Movement',
      resolutionId: 'seed.gm-override.resolution',
      sourceOperationId: 'seed.gm-override.operation',
      costs: [{
        id: 'seed.cost.shift',
        phase: 'pay',
        cost: { kind: 'action-resource', resource: 'shift', amount: 1 },
      }, {
        id: 'seed.cost.movement',
        phase: 'movement',
        cost: { kind: 'movement-distance', amount: 2 },
      }],
      movementBudget: 2,
      movementDistance: 0,
      round: 1,
      turn: null,
      actedThisRound: false,
    })
    const gmHarness = createHarness({
      ...arena,
      encounterState: {
        ...arena.encounterState!,
        turnResources: exhaustedGmResources.resources,
      },
    })
    configureSlowActor(gmHarness)
    const overridden = await executeMapTokenLivePlayCommandUseCase({
      role: 'gm',
      command: moveCommand({
        opId: 'op_gmoverride01',
        payload: {
          placementId: 'linked-token',
          position: { x: 8, y: 0, z: 1 },
          pathLength: 0,
          movementPolicy: 'gm-override',
        },
      }),
      playerProfile: null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
    }, gmHarness.deps)

    expect(overridden.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(gmHarness.storedMap.placements[0]?.position).toEqual({ x: 8, y: 0, z: 1 })
    expect(gmHarness.storedMap.metadata?.movementLog).toEqual([
      expect.objectContaining({ pathLength: 7 }),
    ])
    expect(gmHarness.storedMap.encounterState?.turnResources)
      .toEqual(exhaustedGmResources.resources)

    const boundsHarness = createHarness(arena)
    configureSlowActor(boundsHarness)
    const outOfBounds = await executeMapTokenLivePlayCommandUseCase({
      role: 'gm',
      command: moveCommand({
        opId: 'op_gmoutbounds',
        payload: {
          placementId: 'linked-token',
          position: { x: 10, y: 0, z: 1 },
          movementPolicy: 'gm-override',
        },
      }),
      playerProfile: null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
    }, boundsHarness.deps)

    expect(outOfBounds.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      message: expect.stringContaining('movement-destination-out-of-bounds'),
    })
    expect(boundsHarness.writes).toEqual([])
    expect(boundsHarness.storedMap.placements[0]?.position).toEqual({ x: 1, y: 0, z: 1 })
  })

  it('allows a selected player profile to move Pokémon from their linked trainer team', async () => {
    const harness = createHarness(baseMap({
      placements: [
        {
          id: 'trainer-token',
          sheetKind: 'trainer',
          sheetSlug: 'giovanni',
          position: { x: 1, y: 0, z: 1 },
        },
        {
          id: 'team-pokemon-token',
          sheetKind: 'pokemon',
          sheetSlug: 'eevee',
          position: { x: 2, y: 0, z: 1 },
        },
      ],
    }))

    const response = await executeMapTokenLivePlayCommandUseCase({
      role: 'player',
      command: moveCommand({
        opId: 'op_trainerteammove',
        scopes: [{ kind: 'token', placementId: 'team-pokemon-token', field: 'position' }],
        payload: {
          placementId: 'team-pokemon-token',
          position: { x: 4, y: 0, z: 1 },
        },
      }),
      clientId: 'player-client',
      playerProfile: playerProfile([{ sheetKind: 'trainer', sheetSlug: 'giovanni' }]),
      expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
    }, harness.deps)

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(response.placement).toMatchObject({
      id: 'team-pokemon-token',
      sheetSlug: 'eevee',
      position: { x: 4, y: 0, z: 1 },
    })
  })

  it('rejects unauthorized player moves without advancing revision or writing', async () => {
    const harness = createHarness()

    const response = await executeMapTokenLivePlayCommandUseCase({
      role: 'player',
      command: moveCommand({
        payload: { placementId: 'unlinked-token', position: { x: 4, y: 0, z: 4 } },
        scopes: [{ kind: 'token', placementId: 'unlinked-token', field: 'position' }],
      }),
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }]),
      expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
    }, harness.deps)

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'unauthorized',
      currentRevision: 4,
      message: 'Token is not linked to selected player profile',
    })
    expect(harness.writes).toEqual([])
    expect(harness.storedMap.revision).toBe(4)
    expect(harness.published).toEqual([])
  })

  it('rejects stale moves before applying or persisting them', async () => {
    const harness = createHarness()

    const response = await executeMapTokenLivePlayCommandUseCase({
      role: 'gm',
      command: moveCommand({ baseRevision: 3, opId: 'op_stalemove01' }),
      playerProfile: null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
    }, harness.deps)

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'stale-revision',
      currentRevision: 4,
    })
    expect(harness.writes).toEqual([])
    expect(harness.storedMap.placements[0]?.position).toEqual({ x: 1, y: 0, z: 1 })
  })

  it('allows stale different-token moves with retained operation history and rejects same-token conflicts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rotom-live-conflicts-'))
    const database = openRotomDatabase({ path: join(root, 'campaign.sqlite') })

    try {
      const harness = createHarness()
      const executor = createAuthoritativeLivePlayCommandExecutor({
        opStore: createSqliteLivePlayOpRepository({ database }),
        queue: createInProcessMapWriteQueue(),
      })
      const deps = { ...harness.deps, commandExecutor: executor }

      const first = await executeMapTokenLivePlayCommandUseCase({
        role: 'gm',
        command: moveCommand({ opId: 'op_conflictmove1' }),
        playerProfile: null,
        expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
      }, deps)
      const differentToken = await executeMapTokenLivePlayCommandUseCase({
        role: 'gm',
        command: moveCommand({
          opId: 'op_conflictmove2',
          baseRevision: 4,
          scopes: [{ kind: 'token', placementId: 'unlinked-token', field: 'position' }],
          payload: { placementId: 'unlinked-token', position: { x: 5, y: 0, z: 5 } },
        }),
        playerProfile: null,
        expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
      }, deps)
      const sameToken = await executeMapTokenLivePlayCommandUseCase({
        role: 'gm',
        command: moveCommand({
          opId: 'op_conflictmove3',
          baseRevision: 4,
          payload: { placementId: 'linked-token', position: { x: 5, y: 0, z: 1 } },
        }),
        playerProfile: null,
        expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
      }, deps)

      expect(first.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
      expect(differentToken.result).toMatchObject({ ok: true, previousRevision: 5, revision: 6 })
      expect(sameToken.result).toMatchObject({
        ok: false,
        reason: 'conflict',
        currentRevision: 6,
        message: expect.stringContaining('token linked-token position'),
      })
      expect(harness.writes).toHaveLength(2)
      expect(harness.storedMap.placements.find((placement) => placement.id === 'linked-token')?.position)
        .toEqual({ x: 4, y: 0, z: 1 })
      expect(harness.storedMap.placements.find((placement) => placement.id === 'unlinked-token')?.position)
        .toEqual({ x: 5, y: 0, z: 5 })
    } finally {
      database.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('revalidates every movement sheet read inside commit before writing the map', async () => {
    const harness = createHarness()
    let trainerReads = 0
    harness.deps.readSheet.mockImplementation((kind: string, slug: string) => ({
      sheet: kind === 'pokemon'
        ? {
            slug,
            nickname: 'Bolt',
            species: 'Pikachu',
            level: 10,
            revision: 1,
            capabilities: { overland: 6 },
          }
        : {
            slug,
            name: 'Boss',
            level: 10,
            revision: ++trainerReads === 1 ? 1 : 2,
            currentTeam: ['eevee'],
            capabilities: { overland: 5 },
          },
    }))

    const response = await executeMapTokenLivePlayCommandUseCase({
      role: 'player',
      command: moveCommand({ opId: 'op_movestalesheet' }),
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }]),
      expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
    }, harness.deps)

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      currentRevision: 4,
      message: 'A sheet consulted by authoritative movement changed before the token position could commit.',
    })
    expect(harness.writes).toEqual([])
    expect(harness.published).toEqual([])
    expect(harness.storedMap.revision).toBe(4)
    expect(harness.storedMap.placements[0]?.position).toEqual({ x: 1, y: 0, z: 1 })
  })

  it('rejects an exhausted oracle-derived movement budget atomically and replays the stored rejection', async () => {
    const seeded = spendEncounterMoveResourceCosts({}, {
      placementId: 'linked-token',
      canonicalMoveId: 'Seed Movement',
      resolutionId: 'seed.movement.resolution',
      sourceOperationId: 'seed.movement.operation',
      costs: [{
        id: 'seed.cost.movement',
        phase: 'movement',
        cost: { kind: 'movement-distance', amount: 5 },
      }],
      movementBudget: 6,
      movementDistance: 0,
      round: 1,
      turn: null,
      actedThisRound: false,
    })
    const map = baseMap()
    const initialMap: TabletopMap = {
      ...map,
      encounterState: {
        ...map.encounterState!,
        turnResources: seeded.resources,
      },
    }
    const harness = createHarness(initialMap)
    const before = structuredClone(harness.storedMap)
    const command = moveCommand({ opId: 'op_moveunavailable' })
    const request = () => executeMapTokenLivePlayCommandUseCase({
      role: 'player' as const,
      command,
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }]),
      expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
    }, harness.deps)

    const first = await request()
    const readsAfterFirst = harness.deps.readSheet.mock.calls.length
    const duplicate = await request()

    expect(first.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      currentRevision: 4,
      message: expect.stringContaining('movement-unavailable'),
    })
    expect(duplicate.result).toEqual(first.result)
    expect(harness.deps.readSheet.mock.calls).toHaveLength(readsAfterFirst)
    expect(harness.writes).toEqual([])
    expect(harness.published).toEqual([])
    expect(harness.storedMap).toEqual(before)
  })

  it('returns the stored result for duplicate move opIds without applying movement twice', async () => {
    const harness = createHarness()
    const command = moveCommand({ opId: 'op_duplicatemove1' })

    const first = await executeMapTokenLivePlayCommandUseCase({
      role: 'player',
      command,
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }]),
      expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
    }, harness.deps)
    const second = await executeMapTokenLivePlayCommandUseCase({
      role: 'player',
      command,
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }]),
      expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
    }, harness.deps)

    expect(second.result).toEqual(first.result)
    expect(harness.writes).toHaveLength(1)
    expect(harness.storedMap.revision).toBe(5)
    expect(harness.storedMap.metadata?.movementLog).toHaveLength(1)
    expect(harness.storedMap.encounterState?.turnResources['linked-token']).toMatchObject({
      actions: { shift: { spent: 1 } },
      movement: { budget: 6, spent: 3 },
    })
  })

  it('applies a GM spawn through the authoritative executor and publishes a placement patch', async () => {
    const harness = createHarness(baseMap({ playerVisible: false }))

    const response = await executeMapTokenLivePlayCommandUseCase({
      role: 'gm',
      command: spawnCommand(),
      clientId: 'gm-client',
      playerProfile: null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN,
    }, harness.deps)

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(response.placement).toMatchObject({
      id: 'spawned-eevee',
      sheetKind: 'pokemon',
      sheetSlug: 'eevee',
      position: { x: 3, y: 0, z: 3 },
      sideId: 'wild',
      facing: 'south-east',
      turned: false,
    })
    expect(harness.writes).toHaveLength(1)
    expect(harness.storedMap.placements.map((placement) => placement.id)).toContain('spawned-eevee')
    if (!response.result.ok || 'duplicate' in response.result) throw new Error('expected accepted spawnToken result')
    expect(response.result.patches[0]).toMatchObject({
      type: 'map.placements',
      scopes: [{ kind: 'token', placementId: 'spawned-eevee', field: 'spawn' }],
      payload: {
        command: 'spawnToken',
        placementId: 'spawned-eevee',
        previous: null,
        current: expect.objectContaining({ id: 'spawned-eevee' }),
      },
    })
    expect(harness.published).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'map:arena', type: 'live-play-command-accepted', revision: 5, opId: 'op_mapspawntest' }),
    ]))
  })

  it('applies a selected player profile send-out from a controlled linked trainer', async () => {
    const harness = createHarness()

    const response = await executeMapTokenLivePlayCommandUseCase({
      role: 'player',
      command: sendOutCommand(),
      clientId: 'player-client',
      playerProfile: playerProfile([{ sheetKind: 'trainer', sheetSlug: 'giovanni' }]),
      expectedType: LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON,
    }, harness.deps)

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(response.placement).toMatchObject({
      id: 'sent-out-eevee',
      sheetKind: 'pokemon',
      sheetSlug: 'eevee',
      position: { x: 3, y: 0, z: 2 },
      sideId: 'rivals',
      facing: 'south-east',
      turned: false,
    })
    expect(harness.writes).toHaveLength(1)
    expect(harness.storedMap.placements.map((placement) => placement.id)).toContain('sent-out-eevee')
    if (!response.result.ok || 'duplicate' in response.result) throw new Error('expected accepted sendOutPokemon result')
    expect(response.result.patches[0]).toMatchObject({
      type: 'map.placements',
      scopes: [
        { kind: 'token', placementId: 'unlinked-token', field: 'sendOut' },
        { kind: 'token', placementId: 'sent-out-eevee', field: 'spawn' },
      ],
      payload: {
        command: 'sendOutPokemon',
        trainerId: 'unlinked-token',
        placementId: 'sent-out-eevee',
        previous: null,
        current: expect.objectContaining({ id: 'sent-out-eevee' }),
      },
    })
    expect(harness.published).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'map:arena', type: 'live-play-command-accepted', revision: 5, opId: 'op_mapsendout1' }),
    ]))
  })

  it('returns the stored result for duplicate spawn opIds without adding or publishing the placement twice', async () => {
    const harness = createHarness()
    const command = spawnCommand({ opId: 'op_dupspawn001' })

    const first = await executeMapTokenLivePlayCommandUseCase({
      role: 'gm',
      command,
      playerProfile: null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN,
    }, harness.deps)
    const second = await executeMapTokenLivePlayCommandUseCase({
      role: 'gm',
      command,
      playerProfile: null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN,
    }, harness.deps)

    expect(second.result).toEqual(first.result)
    expect(harness.writes).toHaveLength(1)
    expect(harness.published).toHaveLength(1)
    expect(harness.storedMap.placements.filter((placement) => placement.id === 'spawned-eevee')).toHaveLength(1)
  })

  it('rejects duplicate placement ids with different spawn command bodies as conflicts', async () => {
    const harness = createHarness()

    const response = await executeMapTokenLivePlayCommandUseCase({
      role: 'gm',
      command: spawnCommand({
        opId: 'op_spawnconflict',
        scopes: [{ kind: 'token', placementId: 'linked-token', field: 'spawn' }],
        payload: {
          placement: {
            id: 'linked-token',
            sheetKind: 'pokemon',
            sheetSlug: 'eevee',
            position: { x: 4, y: 0, z: 4 },
          },
        },
      }),
      playerProfile: null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN,
    }, harness.deps)

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      currentRevision: 4,
      message: 'Placement linked-token already exists',
    })
    expect(harness.writes).toEqual([])
    expect(harness.storedMap.placements).toHaveLength(2)
  })

  it('deletes a GM token, clears active initiative, and returns a placement patch', async () => {
    const harness = createHarness(baseMap({ initiative: { activeId: 'linked-token', round: 2 } }))

    const response = await executeMapTokenLivePlayCommandUseCase({
      role: 'gm',
      command: deleteCommand(),
      clientId: 'gm-client',
      playerProfile: null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN,
    }, harness.deps)

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(response.placement).toMatchObject({ id: 'linked-token', sheetSlug: 'pikachu', sideId: 'heroes' })
    expect(harness.storedMap.placements.map((placement) => placement.id)).not.toContain('linked-token')
    expect(harness.storedMap.initiative?.activeId).toBeNull()
    if (!response.result.ok || 'duplicate' in response.result) throw new Error('expected accepted deleteToken result')
    expect(response.result.patches[0]).toMatchObject({
      type: 'map.placements',
      scopes: [{ kind: 'token', placementId: 'linked-token', field: 'delete' }],
      payload: {
        command: 'deleteToken',
        placementId: 'linked-token',
        previous: expect.objectContaining({ id: 'linked-token', sideId: 'heroes' }),
        current: null,
      },
    })
  })

  it('rejects player spawn/delete commands and invalid sheet references without writing', async () => {
    const harness = createHarness()

    const playerSpawn = await executeMapTokenLivePlayCommandUseCase({
      role: 'player',
      command: spawnCommand({ opId: 'op_playerspawn1' }),
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'eevee' }]),
      expectedType: LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN,
    }, harness.deps)
    const playerDelete = await executeMapTokenLivePlayCommandUseCase({
      role: 'player',
      command: deleteCommand({ opId: 'op_playerdelete' }),
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }]),
      expectedType: LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN,
    }, harness.deps)
    const invalidSheet = await executeMapTokenLivePlayCommandUseCase({
      role: 'gm',
      command: spawnCommand({
        opId: 'op_invalidsheet',
        scopes: [{ kind: 'token', placementId: 'spawned-missing', field: 'spawn' }],
        payload: {
          placement: {
            id: 'spawned-missing',
            sheetKind: 'pokemon',
            sheetSlug: 'missingno',
            position: { x: 2, y: 0, z: 2 },
          },
        },
      }),
      playerProfile: null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN,
    }, {
      ...harness.deps,
      readSheet: vi.fn(() => null),
    })
    const outOfBounds = await executeMapTokenLivePlayCommandUseCase({
      role: 'gm',
      command: spawnCommand({
        opId: 'op_spawnbounds',
        payload: {
          placement: {
            id: 'spawned-bounds',
            sheetKind: 'pokemon',
            sheetSlug: 'eevee',
            position: { x: 99, y: 0, z: 3 },
          },
        },
        scopes: [{ kind: 'token', placementId: 'spawned-bounds', field: 'spawn' }],
      }),
      playerProfile: null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN,
    }, harness.deps)
    const unknownSide = await executeMapTokenLivePlayCommandUseCase({
      role: 'gm',
      command: spawnCommand({
        opId: 'op_spawnunknownside',
        payload: {
          placement: {
            id: 'spawned-unknown-side',
            sheetKind: 'pokemon',
            sheetSlug: 'eevee',
            position: { x: 3, y: 0, z: 3 },
            sideId: 'missing-side',
          },
        },
        scopes: [{ kind: 'token', placementId: 'spawned-unknown-side', field: 'spawn' }],
      }),
      playerProfile: null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN,
    }, harness.deps)

    expect(playerSpawn.result).toMatchObject({ ok: false, reason: 'unauthorized', message: 'Only GMs can spawn map tokens' })
    expect(playerDelete.result).toMatchObject({ ok: false, reason: 'unauthorized', message: 'Only GMs can delete map tokens' })
    expect(invalidSheet.result).toMatchObject({ ok: false, reason: 'not-found', message: 'pokemon sheet missingno not found' })
    expect(outOfBounds.result).toMatchObject({ ok: false, reason: 'invalid' })
    expect(unknownSide.result).toMatchObject({
      ok: false,
      reason: 'invalid',
      message: 'spawnToken placement side missing-side is not defined on map arena',
    })
    expect(harness.writes).toEqual([])
    expect(harness.storedMap.revision).toBe(4)
  })

  it('persists live-play moves through the SQLite map repository', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rotom-live-map-'))
    const database = openRotomDatabase({ path: join(root, 'campaign.sqlite') })

    try {
      const mapRepository = createSqliteMapRepository<TabletopMap>(database)
      // The adjacent rival trainer is moved out of the path so this movement
      // persistence check does not provoke a durable Attack of Opportunity.
      const movementOnlyMap: TabletopMap = {
        ...baseMap(),
        placements: baseMap().placements.map((placement) => (
          placement.id === 'unlinked-token'
            ? { ...placement, position: { x: 7, y: 0, z: 7 } }
            : placement
        )),
      }
      await mapRepository.saveSetupMap(movementOnlyMap)
      const executor = createAuthoritativeLivePlayCommandExecutor({
        opStore: createInMemoryLivePlayOpStore(),
        queue: createInProcessMapWriteQueue(),
      })

      const response = await executeMapTokenLivePlayCommandUseCase({
        role: 'player',
        command: moveCommand({ opId: 'op_sqlitemapmove1' }),
        playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }]),
        expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
      }, {
        mapRepository,
        database,
        commandExecutor: executor,
        readSheet: vi.fn((kind: string, slug: string) => ({
          sheet: kind === 'pokemon'
            ? { slug, nickname: 'Bolt', species: 'Pikachu' }
            : { slug, name: 'Boss' },
        })),
        now: vi.fn(() => 2_000),
      })

      expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
      const stored = await mapRepository.getBySlug('arena')
      expect(stored).toMatchObject({ revision: 5, updatedAt: 2_000 })
      expect(stored?.placements.find((placement) => placement.id === 'linked-token')).toMatchObject({
        id: 'linked-token',
        position: { x: 4, y: 0, z: 1 },
        sideId: 'heroes',
        facing: 'north-east',
      })
      expect(stored?.encounterState?.sides).toEqual(baseMap().encounterState?.sides)
    } finally {
      database.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects no-op moves without advancing revision or writing', async () => {
    const harness = createHarness()

    const response = await executeMapTokenLivePlayCommandUseCase({
      role: 'gm',
      command: moveCommand({
        opId: 'op_noopmove001',
        payload: { placementId: 'linked-token', position: { x: 1, y: 0, z: 1 } },
      }),
      playerProfile: null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
    }, harness.deps)

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'no-op',
      currentRevision: 4,
    })
    expect(harness.writes).toEqual([])
    expect(harness.storedMap.revision).toBe(4)
  })
})
