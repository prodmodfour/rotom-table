import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  createLivePlayAcceptedResult,
  createLivePlayRejectedResult,
  type LivePlayCommandEnvelope,
  type LivePlayCommandRejected,
  type LivePlayPatch,
} from '#shared/livePlayCommands'
import { LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION } from '#shared/livePlayOperationAbandonment'
import { LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION } from '#shared/livePlayOperationStatus'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { PLAYER_PROFILE_SCHEMA_VERSION, type PlayerProfile, type PlayerProfileDisplayName, type PlayerProfileId } from '#shared/playerProfiles'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { createLivePlayCommandHash } from '~~/server/livePlay/opResult'
import { createInMemoryLivePlayOpStore } from '~~/server/livePlay/opStore'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { abandonLivePlayOperationUseCase } from '~~/server/useCases/abandonLivePlayOperation'
import { getLivePlayOperationStatusUseCase } from '~~/server/useCases/getLivePlayOperationStatus'
import type { TabletopMap } from '~/types/map'
import { LivePlayIntegrationHarness, assertAccepted } from './livePlayIntegrationHarness'

const openDatabases: RotomDatabase[] = []

const noOpDatabase = {
  withTransaction: <T>(work: () => T): T => work(),
}

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 0,
  slug: 'integration-arena',
  name: 'Integration Arena',
  folder: '',
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    { id: 'token-a', sheetKind: 'pokemon', sheetSlug: 'alpha-mon', position: { x: 1, y: 0, z: 1 } },
  ],
  lights: [],
  initiative: { activeId: 'token-a', round: 1 },
  metadata: {},
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...overrides,
})

const command = (overrides: Partial<LivePlayCommandEnvelope> & Record<string, unknown> = {}): LivePlayCommandEnvelope & Record<string, unknown> => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_abandon0001',
  mapSlug: 'integration-arena',
  baseRevision: 0,
  type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
  scopes: [{ kind: 'token', placementId: 'token-a', field: 'position' }],
  payload: { placementId: 'token-a', position: { x: 3, y: 0, z: 1 } },
  ...overrides,
})

const acceptedResult = (currentCommand: LivePlayCommandEnvelope = command()) => createLivePlayAcceptedResult({
  opId: currentCommand.opId,
  mapSlug: currentCommand.mapSlug,
  previousRevision: 0,
  revision: 1,
  patches: [{
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
    mapSlug: currentCommand.mapSlug,
    revision: 1,
    scopes: currentCommand.scopes,
    payload: currentCommand.payload,
  }],
})

const rejectedResult = (currentCommand: LivePlayCommandEnvelope = command()) => createLivePlayRejectedResult({
  opId: currentCommand.opId,
  mapSlug: currentCommand.mapSlug,
  reason: 'stale-revision',
  message: 'Refresh before retrying.',
  currentRevision: 2,
})

const abandonedResultFor = (currentCommand: LivePlayCommandEnvelope, revision = 0): LivePlayCommandRejected => createLivePlayRejectedResult({
  opId: currentCommand.opId,
  mapSlug: currentCommand.mapSlug,
  reason: 'abandoned',
  message: 'This live-play operation was abandoned before execution.',
  currentRevision: revision,
})

const mapRepository = (map: TabletopMap | null) => ({
  getBySlug: vi.fn(() => map),
})

const playerProfile = (id: string): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: id as PlayerProfileId,
  displayName: 'Player' as PlayerProfileDisplayName,
  linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'alpha-mon' }],
})

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
})

describe('abandonLivePlayOperationUseCase', () => {
  it('creates an abandoned terminal result without changing map, sheet, revision, or realtime state', async () => {
    const harness = LivePlayIntegrationHarness.create()
    try {
      const currentCommand = harness.moveTokenCommand({
        opId: 'op_abandonnew1',
        baseRevision: 0,
        placementId: 'token-a',
        position: { x: 4, y: 0, z: 1 },
      })
      const beforeMap = await harness.readMap()
      const beforeSheet = await harness.readSheet('pokemon', 'alpha-mon')
      const beforeEvents = harness.publishedEvents.length

      const response = await abandonLivePlayOperationUseCase({
        role: 'gm',
        command: currentCommand,
      }, {
        mapRepository: harness.mapRepository,
        operationStore: harness.opRepository,
        database: harness.database,
        queue: harness.queue,
      })

      expect(response).toEqual({
        schemaVersion: LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION,
        disposition: 'abandoned',
        mapSlug: currentCommand.mapSlug,
        opId: currentCommand.opId,
        result: abandonedResultFor(currentCommand, beforeMap!.revision),
      })
      expect(await harness.readMap()).toEqual(beforeMap)
      expect(await harness.readSheet('pokemon', 'alpha-mon')).toEqual(beforeSheet)
      expect((await harness.readMap())!.revision).toBe(beforeMap!.revision)
      expect(harness.publishedEvents).toHaveLength(beforeEvents)
      expect(harness.operationRecordCount()).toBe(1)
    } finally {
      harness.dispose()
    }
  })

  it('returns the existing terminal result for repeated abandonment and existing accepted or rejected records', async () => {
    const store = createInMemoryLivePlayOpStore()
    const queue = createInProcessMapWriteQueue()
    const currentCommand = command({ opId: 'op_abandonterm1' })

    const first = await abandonLivePlayOperationUseCase({ role: 'gm', command: currentCommand }, {
      mapRepository: mapRepository(mapFixture()),
      operationStore: store,
      queue,
      database: noOpDatabase,
    })
    const second = await abandonLivePlayOperationUseCase({ role: 'gm', command: currentCommand }, {
      mapRepository: mapRepository(mapFixture()),
      operationStore: store,
      queue,
      database: noOpDatabase,
    })
    expect(second).toEqual({
      schemaVersion: LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION,
      disposition: 'already-terminal',
      mapSlug: currentCommand.mapSlug,
      opId: currentCommand.opId,
      result: first.result,
    })

    const acceptedCommand = command({ opId: 'op_abandonacc1' })
    const accepted = acceptedResult(acceptedCommand)
    store.saveOpResult({
      mapSlug: acceptedCommand.mapSlug,
      opId: acceptedCommand.opId,
      commandHash: createLivePlayCommandHash(acceptedCommand),
      result: accepted,
    })
    await expect(abandonLivePlayOperationUseCase({ role: 'gm', command: acceptedCommand }, {
      mapRepository: mapRepository(mapFixture()),
      operationStore: store,
      queue,
      database: noOpDatabase,
    })).resolves.toMatchObject({ disposition: 'already-terminal', result: accepted })

    const rejectedCommand = command({ opId: 'op_abandonrej1' })
    const rejected = rejectedResult(rejectedCommand)
    store.saveOpResult({
      mapSlug: rejectedCommand.mapSlug,
      opId: rejectedCommand.opId,
      commandHash: createLivePlayCommandHash(rejectedCommand),
      result: rejected,
    })
    await expect(abandonLivePlayOperationUseCase({ role: 'gm', command: rejectedCommand }, {
      mapRepository: mapRepository(mapFixture()),
      operationStore: store,
      queue,
      database: noOpDatabase,
    })).resolves.toMatchObject({ disposition: 'already-terminal', result: rejected })
  })

  it('returns conflict for the same operation ID with a different command hash', async () => {
    const store = createInMemoryLivePlayOpStore()
    const original = command({ opId: 'op_abandonhash' })
    const changed = command({
      opId: original.opId,
      payload: { placementId: 'token-a', position: { x: 7, y: 0, z: 1 } },
    })
    store.saveOpResult({
      mapSlug: original.mapSlug,
      opId: original.opId,
      commandHash: createLivePlayCommandHash(original),
      result: acceptedResult(original),
    })

    await expect(abandonLivePlayOperationUseCase({ role: 'gm', command: changed }, {
      mapRepository: mapRepository(mapFixture()),
      operationStore: store,
      queue: createInProcessMapWriteQueue(),
      database: noOpDatabase,
    })).rejects.toMatchObject({
      statusCode: 409,
      message: `Operation ID ${original.mapSlug}:${original.opId} was already recorded for a different command envelope`,
    })
  })

  it('enforces current map access and exact profile context', async () => {
    const profileA = playerProfile('profile_aaaaaaaa')
    const profileBCommand = command({ profileId: 'profile_bbbbbbbb' })

    await expect(abandonLivePlayOperationUseCase({
      role: 'player',
      command: command(),
      playerProfile: null,
    }, {
      mapRepository: mapRepository(mapFixture({ playerVisible: false })),
      operationStore: createInMemoryLivePlayOpStore(),
      database: noOpDatabase,
    })).rejects.toMatchObject({ statusCode: 403 })

    await expect(abandonLivePlayOperationUseCase({
      role: 'player',
      command: profileBCommand,
      playerProfile: profileA,
    }, {
      mapRepository: mapRepository(mapFixture()),
      operationStore: createInMemoryLivePlayOpStore(),
      database: noOpDatabase,
    })).rejects.toMatchObject({ statusCode: 403 })

    await expect(abandonLivePlayOperationUseCase({
      role: 'gm',
      command: profileBCommand,
    }, {
      mapRepository: mapRepository(mapFixture()),
      operationStore: createInMemoryLivePlayOpStore(),
      database: noOpDatabase,
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('works in Prepare Map mode and operation-status returns the abandoned terminal result', async () => {
    const harness = LivePlayIntegrationHarness.create()
    try {
      createSqliteMapInteractionModeRepository(harness.database).set({
        slug: 'integration-arena',
        interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
        updatedAt: 1_700_000_000_000,
      })
      const currentCommand = harness.moveTokenCommand({
        opId: 'op_abandonprep',
        baseRevision: 0,
        placementId: 'token-a',
        position: { x: 3, y: 0, z: 1 },
      })

      const abandoned = await abandonLivePlayOperationUseCase({ role: 'gm', command: currentCommand }, {
        mapRepository: harness.mapRepository,
        operationStore: harness.opRepository,
        database: harness.database,
        queue: harness.queue,
      })
      expect(abandoned.disposition).toBe('abandoned')

      await expect(getLivePlayOperationStatusUseCase({ role: 'gm', command: currentCommand }, {
        mapRepository: harness.mapRepository,
        operationStore: harness.opRepository,
      })).resolves.toEqual({
        schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
        status: 'terminal',
        mapSlug: currentCommand.mapSlug,
        opId: currentCommand.opId,
        result: abandoned.result,
      })
    } finally {
      harness.dispose()
    }
  })

  it('serializes command-first races by returning the existing accepted result', async () => {
    const harness = LivePlayIntegrationHarness.create()
    try {
      const currentCommand = harness.moveTokenCommand({
        opId: 'op_abandoncmd1',
        baseRevision: 0,
        placementId: 'token-a',
        position: { x: 3, y: 0, z: 1 },
      })
      const accepted = assertAccepted((await harness.moveToken({
        actor: { role: 'gm', clientId: 'gm-client' },
        command: currentCommand,
      })).result)

      await expect(abandonLivePlayOperationUseCase({ role: 'gm', command: currentCommand }, {
        mapRepository: harness.mapRepository,
        operationStore: harness.opRepository,
        database: harness.database,
        queue: harness.queue,
      })).resolves.toMatchObject({ disposition: 'already-terminal', result: accepted })
    } finally {
      harness.dispose()
    }
  })

  it('serializes abandonment-first races so late exact commands do not apply or persist', async () => {
    const store = createInMemoryLivePlayOpStore()
    const queue = createInProcessMapWriteQueue()
    const currentCommand = command({ opId: 'op_abandonlate' })
    const apply = vi.fn(() => { throw new Error('should not apply') })
    const persist = vi.fn(() => { throw new Error('should not persist') })
    const readMap = vi.fn(() => ({ slug: currentCommand.mapSlug, revision: 0, log: [] as string[] }))
    const executor = createAuthoritativeLivePlayCommandExecutor({ opStore: store, queue })

    const abandoned = await abandonLivePlayOperationUseCase({ role: 'gm', command: currentCommand }, {
      mapRepository: mapRepository(mapFixture()),
      operationStore: store,
      queue,
      database: noOpDatabase,
    })

    const lateResult = await executor.execute<typeof currentCommand, { slug: string; revision: number; log: string[] }, undefined, undefined>({
      command: currentCommand,
      readMap,
      apply,
      persist,
    })

    expect(lateResult).toEqual(abandoned.result)
    expect(readMap).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
    expect(store.recordCount).toBe(1)
  })

  it('creates one terminal record for concurrent duplicate abandonment requests', async () => {
    const store = createInMemoryLivePlayOpStore()
    const queue = createInProcessMapWriteQueue()
    const currentCommand = command({ opId: 'op_abandondupe' })

    const [first, second] = await Promise.all([
      abandonLivePlayOperationUseCase({ role: 'gm', command: currentCommand }, {
        mapRepository: mapRepository(mapFixture()),
        operationStore: store,
        queue,
        database: noOpDatabase,
      }),
      abandonLivePlayOperationUseCase({ role: 'gm', command: currentCommand }, {
        mapRepository: mapRepository(mapFixture()),
        operationStore: store,
        queue,
        database: noOpDatabase,
      }),
    ])

    expect([first.disposition, second.disposition].sort()).toEqual(['abandoned', 'already-terminal'])
    expect(first.result).toEqual(second.result)
    expect(store.recordCount).toBe(1)
  })

  it('rolls back map and sheet changes when an abandonment tombstone appears between planning and commit', async () => {
    const database = openRotomDatabase({ path: ':memory:' })
    openDatabases.push(database)
    const maps = createSqliteMapRepository<TabletopMap>(database)
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const ops = createSqliteLivePlayOpRepository({ database })
    const queue = createInProcessMapWriteQueue()
    const executor = createAuthoritativeLivePlayCommandExecutor({ opStore: ops, queue })
    const initialMap = mapFixture({
      slug: 'rollback-arena',
      metadata: { log: [] },
    })
    maps.save({ slug: initialMap.slug, document: initialMap, revision: 0, updatedAt: initialMap.updatedAt ?? 0 })
    sheets.save({
      kind: 'pokemon',
      slug: 'alpha-mon',
      document: { slug: 'alpha-mon', revision: 0, combat: { currentHp: 30 } },
      revision: 0,
      updatedAt: 1_700_000_000_000,
    })
    const currentCommand: LivePlayCommandEnvelope = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: 'op_abandonroll',
      mapSlug: 'rollback-arena',
      baseRevision: 0,
      type: LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
      scopes: [
        { kind: 'token', placementId: 'token-a', field: 'hp' },
        { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'alpha-mon', field: 'hp' },
      ],
      payload: { placementId: 'token-a', currentHp: 12 },
    }
    const abandoned = abandonedResultFor(currentCommand, 0)
    let tombstoneInserted = false

    const result = await executor.execute<typeof currentCommand, { map: TabletopMap; sheet: Record<string, unknown> }, undefined, undefined>({
      command: currentCommand,
      readMap: () => {
        const map = maps.getBySlug(currentCommand.mapSlug)
        const sheet = sheets.getByRef('pokemon', 'alpha-mon')
        if (!map || !sheet) throw new Error('missing fixture state')
        return { map, sheet: sheet.sheet }
      },
      getMapRevision: (context) => context.map.revision ?? 0,
      apply: ({ command: plannedCommand, map, currentRevision }) => {
        const revision = currentRevision + 1
        const patch: LivePlayPatch = {
          schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
          type: LIVE_PLAY_PATCH_TYPES.MAP_METADATA,
          mapSlug: plannedCommand.mapSlug,
          revision,
          scopes: [{ kind: 'map', lane: 'metadata' }],
          payload: { log: ['planned'] },
        }
        return {
          status: 'accepted',
          previousRevision: currentRevision,
          revision,
          nextMap: {
            map: { ...map.map, revision, metadata: { log: ['planned'] } },
            sheet: { ...map.sheet, combat: { currentHp: 12 } },
          },
          patches: [patch],
        }
      },
      persist: () => {
        throw new Error('must use commit')
      },
      commit: ({ currentRevision, nextMap, result, saveOpResult, commandHash }) => {
        if (!tombstoneInserted) {
          tombstoneInserted = true
          ops.saveCommandResult({
            mapSlug: currentCommand.mapSlug,
            opId: currentCommand.opId,
            commandHash,
            command: currentCommand,
            result: abandoned,
          })
        }

        database.withTransaction(() => {
          const mapResult = maps.applyLivePlayUpdate({
            slug: result.mapSlug,
            expectedRevision: currentRevision,
            nextMap: nextMap.map,
          })
          if (mapResult !== 'applied') throw new Error('map update failed')
          const sheetResult = sheets.applyLivePlayUpdate({
            kind: 'pokemon',
            slug: 'alpha-mon',
            expectedRevision: 0,
            nextSheet: nextMap.sheet,
          })
          if (sheetResult !== 'applied') throw new Error('sheet update failed')
          saveOpResult()
        })
      },
    })

    expect(result).toEqual(abandoned)
    expect(maps.getBySlug('rollback-arena')).toMatchObject({
      revision: 0,
      metadata: { log: [] },
    })
    expect(sheets.getByRef('pokemon', 'alpha-mon')).toMatchObject({
      revision: 0,
      sheet: { combat: { currentHp: 30 } },
    })
    expect(ops.getOpRecord(currentCommand.mapSlug, currentCommand.opId)?.result).toEqual(abandoned)
  })
})
