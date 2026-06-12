import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type DeleteTokenLivePlayCommand,
  type MoveTokenLivePlayCommand,
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
import { executeMapTokenLivePlayCommandUseCase } from '~~/server/useCases/applyMapTokenAction'
import { openRotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
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
      facing: 'south-east',
      turned: false,
    },
    {
      id: 'unlinked-token',
      sheetKind: 'trainer',
      sheetSlug: 'giovanni',
      position: { x: 2, y: 0, z: 2 },
      facing: 'north-west',
      turned: true,
    },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
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
    pathLength: 3,
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
      facing: 'south-east',
      turned: false,
    },
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
  })
  const mapRepository = {
    getBySlug: vi.fn(async (slug: string) => (slug === 'arena' ? storedMap : null)),
    applyLivePlayUpdate: vi.fn(async (input: { slug: string; expectedRevision: number; nextMap: TabletopMap }) => {
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
    readSheet: vi.fn((kind: string, slug: string) => ({
      sheet: kind === 'pokemon'
        ? { slug, nickname: 'Bolt', species: 'Pikachu' }
        : { slug, name: 'Boss' },
    })),
    relativePath: vi.fn((filePath: string) => filePath.replace(`${MAPS_ROOT}/`, 'data/maps/')),
    now: vi.fn(() => 2000),
    commandExecutor: executor,
    publishRealtimeEvent: vi.fn((event) => published.push(event)),
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
      facing: 'south-east',
    })
    expect(response.map).toBe(harness.storedMap)
    expect(harness.published).toEqual([
      expect.objectContaining({ channel: 'map:arena', type: 'updated', revision: 5, clientId: 'gm-client', data: expect.objectContaining({ revision: 5 }) }),
      expect.objectContaining({ channel: 'maps', type: 'updated', revision: 5, clientId: 'gm-client', data: expect.objectContaining({ revision: 5 }) }),
      expect.objectContaining({
        channel: 'map:arena',
        type: 'live-play-command-accepted',
        mapSlug: 'arena',
        previousRevision: 4,
        revision: 5,
        opId: 'op_mapmovetest01',
        clientId: 'gm-client',
        patches: expect.arrayContaining([expect.objectContaining({ revision: 5 })]),
        data: expect.objectContaining({ revision: 5 }),
      }),
    ])
  })

  it('applies a selected player profile move only for controlled tokens', async () => {
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

  it('returns the stored result for duplicate spawn opIds without adding the placement twice', async () => {
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
    expect(response.placement).toMatchObject({ id: 'linked-token', sheetSlug: 'pikachu' })
    expect(harness.storedMap.placements.map((placement) => placement.id)).not.toContain('linked-token')
    expect(harness.storedMap.initiative?.activeId).toBeNull()
    if (!response.result.ok || 'duplicate' in response.result) throw new Error('expected accepted deleteToken result')
    expect(response.result.patches[0]).toMatchObject({
      type: 'map.placements',
      scopes: [{ kind: 'token', placementId: 'linked-token', field: 'delete' }],
      payload: {
        command: 'deleteToken',
        placementId: 'linked-token',
        previous: expect.objectContaining({ id: 'linked-token' }),
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

    expect(playerSpawn.result).toMatchObject({ ok: false, reason: 'unauthorized', message: 'Only GMs can spawn map tokens' })
    expect(playerDelete.result).toMatchObject({ ok: false, reason: 'unauthorized', message: 'Only GMs can delete map tokens' })
    expect(invalidSheet.result).toMatchObject({ ok: false, reason: 'not-found', message: 'pokemon sheet missingno not found' })
    expect(outOfBounds.result).toMatchObject({ ok: false, reason: 'invalid' })
    expect(harness.writes).toEqual([])
    expect(harness.storedMap.revision).toBe(4)
  })

  it('persists live-play moves through the SQLite map repository', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rotom-live-map-'))
    const database = openRotomDatabase({ path: join(root, 'campaign.sqlite') })

    try {
      const mapRepository = createSqliteMapRepository<TabletopMap>(database)
      await mapRepository.saveSetupMap(baseMap())
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
        commandExecutor: executor,
        readSheet: vi.fn((kind: string, slug: string) => ({
          sheet: kind === 'pokemon'
            ? { slug, nickname: 'Bolt', species: 'Pikachu' }
            : { slug, name: 'Boss' },
        })),
        now: vi.fn(() => 2_000),
        publishRealtimeEvent: vi.fn(),
      })

      expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
      const stored = await mapRepository.getBySlug('arena')
      expect(stored).toMatchObject({ revision: 5, updatedAt: 2_000 })
      expect(stored?.placements.find((placement) => placement.id === 'linked-token')).toMatchObject({
        id: 'linked-token',
        position: { x: 4, y: 0, z: 1 },
        facing: 'north-east',
      })
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
