import { describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  createLivePlayAcceptedResult,
  createLivePlayRejectedResult,
  type LivePlayCommandEnvelope,
} from '#shared/livePlayCommands'
import { LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION } from '#shared/livePlayOperationStatus'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { createLivePlayCommandHash } from '~~/server/livePlay/opResult'
import { createInMemoryLivePlayOpStore } from '~~/server/livePlay/opStore'
import { getLivePlayOperationStatusUseCase } from '~~/server/useCases/getLivePlayOperationStatus'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import type { TabletopMap } from '~/types/map'
import { LivePlayIntegrationHarness, assertAccepted } from './livePlayIntegrationHarness'

const mapSlug = 'arena-map'
const opId = 'op_status0001'

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 4,
  slug: mapSlug,
  name: 'Arena Map',
  folder: '',
  dimensions: { x: 6, y: 2, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    { id: 'token-a', sheetKind: 'pokemon', sheetSlug: 'alpha-mon', position: { x: 1, y: 0, z: 1 } },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  metadata: {},
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...overrides,
})

const command = (overrides: Partial<LivePlayCommandEnvelope> = {}): LivePlayCommandEnvelope => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId,
  mapSlug,
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
  scopes: [{ kind: 'token', placementId: 'token-a', field: 'position' }],
  payload: { placementId: 'token-a', position: { x: 2, y: 0, z: 1 } },
  ...overrides,
})

const acceptedResult = (currentCommand: LivePlayCommandEnvelope = command()) => createLivePlayAcceptedResult({
  opId: currentCommand.opId,
  mapSlug: currentCommand.mapSlug,
  previousRevision: 4,
  revision: 5,
  patches: [{
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
    mapSlug: currentCommand.mapSlug,
    revision: 5,
    scopes: currentCommand.scopes,
    payload: currentCommand.payload,
  }],
})

const rejectedResult = (currentCommand: LivePlayCommandEnvelope = command()) => createLivePlayRejectedResult({
  opId: currentCommand.opId,
  mapSlug: currentCommand.mapSlug,
  reason: 'stale-revision',
  message: 'Refresh the map before retrying.',
  currentRevision: 6,
})

const playerProfile = (id: string): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: id as PlayerProfileId,
  displayName: 'Player' as PlayerProfileDisplayName,
  linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'alpha-mon' }],
})

const mapRepository = (map: TabletopMap | null) => ({
  getBySlug: vi.fn(() => map),
})

describe('getLivePlayOperationStatusUseCase', () => {
  it('returns unknown for missing operation records', async () => {
    const currentCommand = command()

    await expect(getLivePlayOperationStatusUseCase({
      role: 'gm',
      command: currentCommand,
    }, {
      mapRepository: mapRepository(mapFixture()),
      operationStore: createInMemoryLivePlayOpStore(),
    })).resolves.toEqual({
      schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
      status: 'unknown',
      mapSlug: currentCommand.mapSlug,
      opId: currentCommand.opId,
    })
  })

  it('returns stored accepted operation results without wrapping them as duplicates', async () => {
    const currentCommand = command()
    const result = acceptedResult(currentCommand)
    const store = createInMemoryLivePlayOpStore()
    store.saveOpResult({
      mapSlug: currentCommand.mapSlug,
      opId: currentCommand.opId,
      commandHash: createLivePlayCommandHash(currentCommand),
      result,
    })

    await expect(getLivePlayOperationStatusUseCase({
      role: 'gm',
      command: currentCommand,
    }, {
      mapRepository: mapRepository(mapFixture()),
      operationStore: store,
    })).resolves.toEqual({
      schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
      status: 'terminal',
      mapSlug: currentCommand.mapSlug,
      opId: currentCommand.opId,
      result,
    })
  })

  it('returns stored rejected operation results', async () => {
    const currentCommand = command()
    const result = rejectedResult(currentCommand)
    const store = createInMemoryLivePlayOpStore()
    store.saveOpResult({
      mapSlug: currentCommand.mapSlug,
      opId: currentCommand.opId,
      commandHash: createLivePlayCommandHash(currentCommand),
      result,
    })

    await expect(getLivePlayOperationStatusUseCase({
      role: 'gm',
      command: currentCommand,
    }, {
      mapRepository: mapRepository(mapFixture()),
      operationStore: store,
    })).resolves.toEqual({
      schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
      status: 'terminal',
      mapSlug: currentCommand.mapSlug,
      opId: currentCommand.opId,
      result,
    })
  })

  it('returns a conflict for the same operation ID with a different command hash', async () => {
    const original = command()
    const changed = command({
      payload: { placementId: 'token-a', position: { x: 5, y: 0, z: 1 } },
    })
    const store = createInMemoryLivePlayOpStore()
    store.saveOpResult({
      mapSlug: original.mapSlug,
      opId: original.opId,
      commandHash: createLivePlayCommandHash(original),
      result: acceptedResult(original),
    })

    await expect(getLivePlayOperationStatusUseCase({
      role: 'gm',
      command: changed,
    }, {
      mapRepository: mapRepository(mapFixture()),
      operationStore: store,
    })).rejects.toMatchObject({
      statusCode: 409,
      message: `Operation ID ${original.mapSlug}:${original.opId} was already recorded for a different command envelope`,
    })
  })

  it('returns 404 for missing maps and 403 for hidden player maps', async () => {
    await expect(getLivePlayOperationStatusUseCase({
      role: 'gm',
      command: command(),
    }, {
      mapRepository: mapRepository(null),
      operationStore: createInMemoryLivePlayOpStore(),
    })).rejects.toMatchObject({ statusCode: 404 })

    await expect(getLivePlayOperationStatusUseCase({
      role: 'player',
      command: command(),
      playerProfile: null,
    }, {
      mapRepository: mapRepository(mapFixture({ playerVisible: false })),
      operationStore: createInMemoryLivePlayOpStore(),
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('enforces player profile and GM profile-boundary semantics', async () => {
    const profileA = playerProfile('profile_aaaaaaaa')
    const profileBCommand = {
      ...command(),
      profileId: 'profile_bbbbbbbb',
    }

    await expect(getLivePlayOperationStatusUseCase({
      role: 'player',
      command: profileBCommand,
      playerProfile: profileA,
    }, {
      mapRepository: mapRepository(mapFixture()),
      operationStore: createInMemoryLivePlayOpStore(),
    })).rejects.toMatchObject({ statusCode: 403 })

    await expect(getLivePlayOperationStatusUseCase({
      role: 'player',
      command: command(),
      playerProfile: null,
    }, {
      mapRepository: mapRepository(mapFixture()),
      operationStore: createInMemoryLivePlayOpStore(),
    })).resolves.toMatchObject({ status: 'unknown' })

    await expect(getLivePlayOperationStatusUseCase({
      role: 'gm',
      command: profileBCommand,
    }, {
      mapRepository: mapRepository(mapFixture()),
      operationStore: createInMemoryLivePlayOpStore(),
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('works while the map is in Prepare Map mode', async () => {
    const harness = LivePlayIntegrationHarness.create()
    try {
      createSqliteMapInteractionModeRepository(harness.database).set({
        slug: 'integration-arena',
        interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
        updatedAt: 1_700_000_000_000,
      })
      const currentCommand = harness.moveTokenCommand({
        opId: 'op_statusprep1',
        baseRevision: 0,
        placementId: 'token-a',
        position: { x: 3, y: 0, z: 1 },
      })

      await expect(getLivePlayOperationStatusUseCase({
        role: 'gm',
        command: currentCommand,
      }, {
        mapRepository: harness.mapRepository,
        operationStore: harness.opRepository,
      })).resolves.toEqual({
        schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
        status: 'unknown',
        mapSlug: currentCommand.mapSlug,
        opId: currentCommand.opId,
      })
    } finally {
      harness.dispose()
    }
  })

  it('reads matching operations without writing database state or publishing realtime events', async () => {
    const harness = LivePlayIntegrationHarness.create()
    try {
      const currentCommand = harness.moveTokenCommand({
        opId: 'op_statuswrite',
        baseRevision: 0,
        placementId: 'token-a',
        position: { x: 2, y: 0, z: 1 },
      })
      const accepted = assertAccepted((await harness.moveToken({
        actor: { role: 'gm', clientId: 'gm-client' },
        command: currentCommand,
      })).result)
      const revisionAfterCommand = (await harness.readMap())!.revision
      const operationCount = harness.operationRecordCount()
      const eventCount = harness.publishedEvents.length
      const totalChanges = (harness.database.connection.prepare('SELECT total_changes() AS count').get() as { count: number }).count

      await expect(getLivePlayOperationStatusUseCase({
        role: 'gm',
        command: currentCommand,
      }, {
        mapRepository: harness.mapRepository,
        operationStore: harness.opRepository,
      })).resolves.toEqual({
        schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
        status: 'terminal',
        mapSlug: currentCommand.mapSlug,
        opId: currentCommand.opId,
        result: accepted,
      })

      expect((await harness.readMap())!.revision).toBe(revisionAfterCommand)
      expect(harness.operationRecordCount()).toBe(operationCount)
      expect(harness.publishedEvents).toHaveLength(eventCount)
      expect((harness.database.connection.prepare('SELECT total_changes() AS count').get() as { count: number }).count).toBe(totalChanges)
    } finally {
      harness.dispose()
    }
  })

  it('does not call mutation-style dependencies when checking status', async () => {
    const mutationSpy = vi.fn()

    await expect(getLivePlayOperationStatusUseCase({
      role: 'gm',
      command: command(),
    }, {
      mapRepository: {
        getBySlug: () => mapFixture(),
        applyLivePlayUpdate: mutationSpy,
      } as never,
      operationStore: createInMemoryLivePlayOpStore(),
    })).resolves.toMatchObject({ status: 'unknown' })
    expect(mutationSpy).not.toHaveBeenCalled()
  })
})
