import { describe, expect, it } from 'vitest'
import {
  SESSION_COMMAND_ENVELOPE_VERSION,
  parseOpId,
} from '#shared/sessionCommands'
import {
  parseClientId,
  parseGmKey,
  parseJoinCode,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
} from '#shared/sessionIdentity'
import type { PlayerSessionActor } from '#shared/sessionPermissions'
import {
  parseMapRevision,
  parseSessionRevision,
} from '#shared/sessionRevisions'
import {
  createAuthoritativeSessionMapState,
  createAuthoritativeSessionState,
  getSessionMapState,
  type AuthoritativeSessionState,
} from '#shared/sessionState'
import {
  REMOVE_FIELD_EFFECT_COMMAND_TYPE,
  SET_FIELD_EFFECT_COMMAND_TYPE,
  TICK_FIELD_EFFECT_DURATIONS_COMMAND_TYPE,
  createFieldEffectCommandScope,
  type FieldEffectCommand,
  type RemoveFieldEffectCommand,
  type SetFieldEffectCommand,
  type TickFieldEffectDurationsCommand,
} from '#shared/sessionFieldEffectCommands'
import type { MapFieldEffects, TabletopMapV2 } from '~/types/map'
import {
  ApplyFieldEffectCommandUseCaseError,
  FIELD_EFFECTS_UPDATED_PATCH_EVENT_TYPE,
  applyFieldEffectCommandUseCase,
} from '~~/server/useCases/applyFieldEffectCommand'
import { createInMemorySessionOperationTracker } from '~~/server/utils/sessionOperationTracker'
import {
  createPersistedSessionSnapshot,
  type WriteSessionSnapshotResult,
} from '~~/server/utils/sessionSnapshots'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'

const enabledEnv = { ROTOM_ENABLE_SESSION_HOST: '1' } as const
const sessionId = parseSessionId('session_fieldeffectuc1')
const joinCode = parseJoinCode('ABC267')
const gmKey = parseGmKey('gmkey_fieldeffectusecase000001')
const gmClientId = parseClientId('client_fieldeffucgm')
const playerClientId = parseClientId('client_fieldeffucpl')
const playerId = parsePlayerId('player_fielduc01')
const displayName = parseSessionDisplayName('Field Player')
const createdAt = '2026-05-26T20:00:00.000Z'
const processedAt = '2026-05-26T20:00:05.000Z'

const gmActor = {
  role: 'gm' as const,
  clientId: gmClientId,
}

const playerActor: PlayerSessionActor = {
  role: 'player',
  playerId,
  clientId: playerClientId,
  displayName,
}

const emptyFieldEffects = (): Required<MapFieldEffects> => ({
  weather: [],
  terrains: [],
  rooms: [],
})

const createMap = (fieldEffects: MapFieldEffects = emptyFieldEffects()): TabletopMapV2 => ({
  schemaVersion: 2,
  slug: 'arena-map',
  name: 'Arena Map',
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects,
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
  moveUsage: { byPlacementId: {} },
  metadata: {},
  createdAt: 1_000,
  updatedAt: 1_000,
})

const createState = (
  revision = 0,
  fieldEffects: MapFieldEffects = emptyFieldEffects(),
): AuthoritativeSessionState<TabletopMapV2> => createAuthoritativeSessionState<TabletopMapV2>({
  sessionId,
  createdAt,
  updatedAt: createdAt,
  revision: parseSessionRevision(revision),
  selectedMapSlug: 'arena-map',
  maps: [
    createAuthoritativeSessionMapState<TabletopMapV2>({
      mapSlug: 'arena-map',
      revision: parseMapRevision(revision),
      document: createMap(fieldEffects),
    }),
  ],
  players: [
    {
      playerId,
      displayName,
      joinedAt: createdAt,
      updatedAt: createdAt,
    },
  ],
  assignments: [
    {
      playerId,
      displayName,
      controllableResources: [],
      visibleResources: [{ kind: 'map', mapSlug: 'arena-map' }],
      updatedAt: createdAt,
      updatedByClientId: gmClientId,
    },
  ],
})

const createStoreWithState = (state: AuthoritativeSessionState<TabletopMapV2>) => {
  const store = createInMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>()
  store.create({
    sessionId,
    joinCode,
    gmKey,
    revision: state.revision,
    createdAt,
    updatedAt: createdAt,
    state,
  })
  return store
}

const createSetCommand = (
  overrides: Partial<SetFieldEffectCommand> = {},
): SetFieldEffectCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: gmActor,
  type: SET_FIELD_EFFECT_COMMAND_TYPE,
  opId: parseOpId('op_setfielduc01'),
  baseRevision: parseSessionRevision(0),
  scopes: [createFieldEffectCommandScope('arena-map')],
  payload: {
    mapSlug: 'arena-map',
    category: 'weather',
    kind: 'sunny',
    rounds: 5,
    source: 'Sunny Day',
  },
  metadata: {
    traceId: 'trace-field-effect-use-case',
  },
  ...overrides,
})

const createRemoveCommand = (
  overrides: Partial<RemoveFieldEffectCommand> = {},
): RemoveFieldEffectCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: gmActor,
  type: REMOVE_FIELD_EFFECT_COMMAND_TYPE,
  opId: parseOpId('op_removefielduc'),
  baseRevision: parseSessionRevision(0),
  scopes: [createFieldEffectCommandScope('arena-map')],
  payload: {
    mapSlug: 'arena-map',
    category: 'weather',
    kind: 'sunny',
  },
  ...overrides,
})

const createTickCommand = (
  overrides: Partial<TickFieldEffectDurationsCommand> = {},
): TickFieldEffectDurationsCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: gmActor,
  type: TICK_FIELD_EFFECT_DURATIONS_COMMAND_TYPE,
  opId: parseOpId('op_tickfielduc1'),
  baseRevision: parseSessionRevision(0),
  scopes: [createFieldEffectCommandScope('arena-map')],
  payload: {
    mapSlug: 'arena-map',
    amount: 1,
  },
  ...overrides,
})

const createSnapshotWriter = (calls: AuthoritativeSessionState<TabletopMapV2>[]) => (
  state: AuthoritativeSessionState<TabletopMapV2>,
  options = {},
): WriteSessionSnapshotResult<TabletopMapV2> => {
  calls.push(state)
  const snapshot = createPersistedSessionSnapshot(state, options)
  return {
    directoryPath: '/tmp/session',
    filePath: '/tmp/session/snapshot.json',
    snapshot,
    bytesWritten: 1,
  }
}

describe('applyFieldEffectCommandUseCase', () => {
  it('sets a weather effect, increments revisions, writes a snapshot, and returns a small field-effects patch', () => {
    const store = createStoreWithState(createState())
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const result = applyFieldEffectCommandUseCase({ command: createSetCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('expected accepted setFieldEffect')
    expect(result.session.revision).toBe(parseSessionRevision(1))
    expect(result.patchEvent).toMatchObject({
      eventType: FIELD_EFFECTS_UPDATED_PATCH_EVENT_TYPE,
      commandType: SET_FIELD_EFFECT_COMMAND_TYPE,
      revision: parseSessionRevision(1),
      payload: {
        mapSlug: 'arena-map',
        command: SET_FIELD_EFFECT_COMMAND_TYPE,
        category: 'weather',
        kind: 'sunny',
        previous: { weather: [], terrains: [], rooms: [] },
        current: {
          weather: [{ kind: 'sunny', rounds: 5, source: 'Sunny Day' }],
          terrains: [],
          rooms: [],
        },
      },
    })
    expect(result.result).toMatchObject({
      status: 'accepted',
      accepted: true,
      commandType: SET_FIELD_EFFECT_COMMAND_TYPE,
      currentRevision: parseSessionRevision(1),
      metadata: {
        serverProcessedAt: processedAt,
        traceId: 'trace-field-effect-use-case',
      },
    })
    expect(result.previousFieldEffects.fieldEffects).toEqual({ weather: [], terrains: [], rooms: [] })
    expect(result.fieldEffects.fieldEffects).toEqual({
      weather: [{ kind: 'sunny', rounds: 5, source: 'Sunny Day' }],
      terrains: [],
      rooms: [],
    })
    expect(snapshotCalls).toHaveLength(1)
    expect(snapshotCalls[0]?.revision).toBe(parseSessionRevision(1))
    expect(result.snapshot).toEqual({ writtenAt: processedAt, revision: parseSessionRevision(1) })
    expect(tracker.recordCount).toBe(1)

    const storedMap = getSessionMapState(store.get(sessionId)!.state!, 'arena-map')
    expect(storedMap?.revision).toBe(parseMapRevision(1))
    expect(storedMap?.document.fieldEffects).toEqual({
      weather: [{ kind: 'sunny', rounds: 5, source: 'Sunny Day' }],
      terrains: [],
      rooms: [],
    })
    expect(JSON.stringify(result.patchEvent.payload)).not.toContain('voxels')
    expect(JSON.stringify(result.patchEvent.payload)).not.toContain('placements')
  })

  it('updates durations with set and tick commands across weather, terrain, and room effects', () => {
    const store = createStoreWithState(createState(0, {
      weather: [{ kind: 'sunny', rounds: 2 }],
      terrains: [{ kind: 'electric', rounds: null, scope: 'field' }],
      rooms: [{ kind: 'trick', rounds: 1, startsNextRound: true }],
    }))
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const updatedWeather = applyFieldEffectCommandUseCase({
      command: createSetCommand({
        opId: parseOpId('op_updatefield1'),
        payload: {
          mapSlug: 'arena-map',
          category: 'weather',
          kind: 'sunny',
          rounds: 4,
          source: 'Climate Control',
        },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(updatedWeather.status).toBe('accepted')
    if (updatedWeather.status !== 'accepted') throw new Error('expected duration update')
    expect(updatedWeather.patchEvent.payload.current.weather).toEqual([
      { kind: 'sunny', rounds: 4, source: 'Climate Control' },
    ])

    const ticked = applyFieldEffectCommandUseCase({
      command: createTickCommand({
        opId: parseOpId('op_tickfield002'),
        baseRevision: parseSessionRevision(1),
        payload: { mapSlug: 'arena-map', amount: 2 },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => '2026-05-26T20:00:06.000Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(ticked.status).toBe('accepted')
    if (ticked.status !== 'accepted') throw new Error('expected tick accepted')
    expect(ticked.patchEvent.payload).toMatchObject({
      command: TICK_FIELD_EFFECT_DURATIONS_COMMAND_TYPE,
      tickAmount: 2,
      previous: {
        weather: [{ kind: 'sunny', rounds: 4, source: 'Climate Control' }],
        terrains: [{ kind: 'electric', rounds: null, scope: 'field' }],
        rooms: [{ kind: 'trick', rounds: 1, startsNextRound: true }],
      },
      current: {
        weather: [{ kind: 'sunny', rounds: 2, source: 'Climate Control' }],
        terrains: [{ kind: 'electric', rounds: null, scope: 'field' }],
        rooms: [],
      },
    })
    expect(snapshotCalls).toHaveLength(2)
  })

  it('removes one kind or clears all field effects', () => {
    const store = createStoreWithState(createState(0, {
      weather: [{ kind: 'sunny', rounds: 5 }],
      terrains: [{ kind: 'electric', rounds: 5, scope: 'field' }],
      rooms: [{ kind: 'magic', rounds: 5 }],
    }))
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const removedWeather = applyFieldEffectCommandUseCase({ command: createRemoveCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(removedWeather.status).toBe('accepted')
    if (removedWeather.status !== 'accepted') throw new Error('expected remove accepted')
    expect(removedWeather.patchEvent.payload.current.weather).toEqual([])
    expect(removedWeather.patchEvent.payload.current.terrains).toEqual([{ kind: 'electric', rounds: 5, scope: 'field' }])

    const clearAll = applyFieldEffectCommandUseCase({
      command: createRemoveCommand({
        opId: parseOpId('op_clearfield001'),
        baseRevision: parseSessionRevision(1),
        payload: { mapSlug: 'arena-map', category: 'all' },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => '2026-05-26T20:00:06.000Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(clearAll.status).toBe('accepted')
    if (clearAll.status !== 'accepted') throw new Error('expected clear all accepted')
    expect(clearAll.patchEvent.payload.current).toEqual({ weather: [], terrains: [], rooms: [] })
  })

  it('rejects player and no-op field-effect changes without mutating authoritative state', () => {
    const store = createStoreWithState(createState())
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const playerResult = applyFieldEffectCommandUseCase({
      command: createSetCommand({ actor: playerActor }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(playerResult.status).toBe('rejected')
    if (playerResult.status !== 'rejected') throw new Error('expected player rejection')
    expect(playerResult.result).toMatchObject({
      reason: 'unauthorized',
      commandType: SET_FIELD_EFFECT_COMMAND_TYPE,
      currentRevision: parseSessionRevision(0),
      permission: { reason: 'gm-required' },
    })

    const noOpRemove = applyFieldEffectCommandUseCase({
      command: createRemoveCommand({ opId: parseOpId('op_noopfield001') }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(noOpRemove.status).toBe('rejected')
    if (noOpRemove.status !== 'rejected') throw new Error('expected no-op rejection')
    expect(noOpRemove.result).toMatchObject({ reason: 'conflict', currentRevision: parseSessionRevision(0) })
    expect(snapshotCalls).toEqual([])
    expect(store.get(sessionId)?.state?.revision).toBe(parseSessionRevision(0))
  })

  it('rejects stale field-effect changes when the lane changed after the command base revision', () => {
    const store = createStoreWithState(createState())
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const accepted = applyFieldEffectCommandUseCase({ command: createSetCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(accepted.status).toBe('accepted')

    const stale = applyFieldEffectCommandUseCase({
      command: createRemoveCommand({
        opId: parseOpId('op_stalefield01'),
        baseRevision: parseSessionRevision(0),
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => '2026-05-26T20:00:07.000Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(stale.status).toBe('rejected')
    if (stale.status !== 'rejected') throw new Error('expected stale rejection')
    expect(stale.result).toMatchObject({
      reason: 'stale',
      baseRevision: parseSessionRevision(0),
      currentRevision: parseSessionRevision(1),
      currentState: {
        mapSlug: 'arena-map',
        fieldEffects: {
          weather: [{ kind: 'sunny', rounds: 5, source: 'Sunny Day' }],
          terrains: [],
          rooms: [],
        },
      },
    })
    expect(snapshotCalls).toHaveLength(1)
  })

  it('returns idempotent duplicate results and rolls back store state if snapshot writing fails', () => {
    const store = createStoreWithState(createState())
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const command = createSetCommand({ opId: parseOpId('op_dupefield001') })

    const first = applyFieldEffectCommandUseCase({ command }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(first.status).toBe('accepted')

    const duplicate = applyFieldEffectCommandUseCase({ command }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => '2026-05-26T20:00:08.000Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(duplicate.status).toBe('duplicate')
    if (duplicate.status !== 'duplicate') throw new Error('expected duplicate')
    expect(duplicate.result).toMatchObject({
      status: 'duplicate',
      commandType: SET_FIELD_EFFECT_COMMAND_TYPE,
      currentRevision: parseSessionRevision(1),
      original: { status: 'accepted', revision: parseSessionRevision(1) },
    })
    expect(snapshotCalls).toHaveLength(1)

    expect(() => applyFieldEffectCommandUseCase({
      command: createRemoveCommand({
        opId: parseOpId('op_failfield001'),
        baseRevision: parseSessionRevision(1),
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => '2026-05-26T20:00:09.000Z',
      writeSnapshot: () => {
        throw new Error('disk full')
      },
    })).toThrow(ApplyFieldEffectCommandUseCaseError)

    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(1))
    expect(getSessionMapState(store.get(sessionId)!.state!, 'arena-map')?.document.fieldEffects)
      .toEqual({
        weather: [{ kind: 'sunny', rounds: 5, source: 'Sunny Day' }],
        terrains: [],
        rooms: [],
      })
  })

  it('fails closed when session hosting is disabled', () => {
    const store = createStoreWithState(createState())

    expect(() => applyFieldEffectCommandUseCase({ command: createSetCommand() }, {
      env: {},
      store,
    })).toThrow('Track 2 session hosting is disabled')
  })
})
