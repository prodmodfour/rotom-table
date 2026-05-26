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
  parseSessionId,
  sanitizeSessionDisplayName,
} from '#shared/sessionIdentity'
import type {
  GmSessionActor,
  PlayerAssignmentRecord,
  PlayerSessionActor,
  SessionTokenResourceRef,
} from '#shared/sessionPermissions'
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
  createMoveTokenCommandScope,
  createTurnTokenCommandScope,
  MOVE_TOKEN_COMMAND_TYPE,
  TURN_TOKEN_COMMAND_TYPE,
  type MoveTokenCommand,
  type TurnTokenCommand,
} from '#shared/sessionTokenCommands'
import type { TabletopMapV2 } from '~/types/map'
import {
  applyMoveTokenCommandUseCase,
} from '~~/server/useCases/applyMoveTokenCommand'
import {
  applyTurnTokenCommandUseCase,
  TURN_TOKEN_PATCH_EVENT_TYPE,
} from '~~/server/useCases/applyTurnTokenCommand'
import {
  createPersistedSessionSnapshot,
  type WriteSessionSnapshotResult,
} from '~~/server/utils/sessionSnapshots'
import { createInMemorySessionOperationTracker } from '~~/server/utils/sessionOperationTracker'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'

const enabledEnv = { ROTOM_ENABLE_SESSION_HOST: '1' } as const
const sessionId = parseSessionId('session_turntokenuc001')
const joinCode = parseJoinCode('TRNAAA')
const gmKey = parseGmKey('gmkey_turntokenusecase0000000x')
const gmClientId = parseClientId('client_turnGM001')
const playerClientId = parseClientId('client_turnPL001')
const playerId = parsePlayerId('player_turnuc01')
const displayName = sanitizeSessionDisplayName('Turn Player')
const createdAt = '2026-05-26T11:00:00.000Z'
const processedAt = '2026-05-26T11:00:05.000Z'

const gmActor: GmSessionActor = {
  role: 'gm',
  clientId: gmClientId,
}

const playerActor: PlayerSessionActor = {
  role: 'player',
  playerId,
  clientId: playerClientId,
  displayName,
}

const tokenResource = {
  kind: 'token',
  tokenId: 'token-pikachu',
  mapSlug: 'arena-map',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
} as const satisfies SessionTokenResourceRef

const eeveeTokenResource = {
  kind: 'token',
  tokenId: 'token-eevee',
  mapSlug: 'arena-map',
  sheetKind: 'pokemon',
  sheetSlug: 'eevee',
} as const satisfies SessionTokenResourceRef

const assignment = {
  playerId,
  displayName,
  controllableResources: [tokenResource],
  visibleResources: [{ kind: 'map', mapSlug: 'arena-map' }, tokenResource],
  updatedAt: createdAt,
  updatedByClientId: gmClientId,
} as const satisfies PlayerAssignmentRecord

const createMap = (overrides: Partial<TabletopMapV2> = {}): TabletopMapV2 => ({
  schemaVersion: 2,
  slug: 'arena-map',
  name: 'Arena Map',
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    {
      id: 'token-pikachu',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
      position: { x: 1, y: 0, z: 1 },
      facing: 'south-east',
      turned: false,
    },
    {
      id: 'token-eevee',
      sheetKind: 'pokemon',
      sheetSlug: 'eevee',
      position: { x: 3, y: 0, z: 1 },
      facing: 'south-west',
      turned: false,
    },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  moveUsage: { byPlacementId: {} },
  metadata: {},
  createdAt: 1_000,
  updatedAt: 1_000,
  ...overrides,
})

const createState = (
  map: TabletopMapV2 = createMap(),
  assignments: readonly PlayerAssignmentRecord[] = [assignment],
): AuthoritativeSessionState<TabletopMapV2> => createAuthoritativeSessionState<TabletopMapV2>({
  sessionId,
  createdAt,
  updatedAt: createdAt,
  revision: parseSessionRevision(0),
  selectedMapSlug: 'arena-map',
  maps: [
    createAuthoritativeSessionMapState<TabletopMapV2>({
      mapSlug: 'arena-map',
      revision: parseMapRevision(0),
      document: map,
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
  assignments,
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

const createTurnCommand = (
  overrides: Partial<TurnTokenCommand> = {},
): TurnTokenCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: playerActor,
  type: TURN_TOKEN_COMMAND_TYPE,
  opId: parseOpId('op_turntokenuc001'),
  baseRevision: parseSessionRevision(0),
  scopes: [createTurnTokenCommandScope(tokenResource)],
  payload: {
    tokenId: 'token-pikachu',
    facing: 'north-west',
  },
  metadata: {
    clientIssuedAt: '2026-05-26T11:00:04.500Z',
    clientSequence: 1,
    traceId: 'trace-turn-token-use-case',
  },
  ...overrides,
})

const createMoveCommand = (
  overrides: Partial<MoveTokenCommand> = {},
): MoveTokenCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: gmActor,
  type: MOVE_TOKEN_COMMAND_TYPE,
  opId: parseOpId('op_turntokenmove01'),
  baseRevision: parseSessionRevision(0),
  scopes: [createMoveTokenCommandScope(eeveeTokenResource)],
  payload: {
    tokenId: 'token-eevee',
    to: { x: 4, y: 0, z: 2 },
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

describe('applyTurnTokenCommandUseCase', () => {
  it('applies an authorized turnToken command to authoritative state, increments revisions, and writes a snapshot', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const command = createTurnCommand()

    const result = applyTurnTokenCommandUseCase({ command }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('expected accepted turnToken')
    expect(result.session.revision).toBe(parseSessionRevision(1))
    expect(result.result).toMatchObject({
      status: 'accepted',
      commandType: 'turnToken',
      currentRevision: parseSessionRevision(1),
      metadata: {
        serverProcessedAt: processedAt,
        traceId: 'trace-turn-token-use-case',
      },
    })
    expect(result.patchEvent).toMatchObject({
      eventType: TURN_TOKEN_PATCH_EVENT_TYPE,
      revision: parseSessionRevision(1),
      payload: {
        tokenId: 'token-pikachu',
        mapSlug: 'arena-map',
        from: 'south-east',
        to: 'north-west',
        turned: true,
        sheetKind: 'pokemon',
        sheetSlug: 'pikachu',
      },
    })
    expect(result.previousToken).toMatchObject({ facing: 'south-east', turned: false })
    expect(result.token).toMatchObject({
      tokenId: 'token-pikachu',
      facing: 'north-west',
      turned: true,
      revision: parseSessionRevision(1),
      mapRevision: parseMapRevision(1),
    })
    expect(snapshotCalls).toHaveLength(1)
    expect(snapshotCalls[0]?.revision).toBe(parseSessionRevision(1))
    expect(result.snapshot).toEqual({
      writtenAt: processedAt,
      revision: parseSessionRevision(1),
    })

    const storedMap = getSessionMapState(store.get(sessionId)?.state ?? initialState, 'arena-map')
    expect(storedMap?.revision).toBe(parseMapRevision(1))
    expect(storedMap?.document.placements.find((placement) => placement.id === 'token-pikachu'))
      .toMatchObject({ facing: 'north-west', turned: true })
    expect(storedMap?.document.placements.find((placement) => placement.id === 'token-eevee'))
      .toMatchObject({ facing: 'south-west', turned: false })
    expect(tracker.recordCount).toBe(1)
  })

  it('rejects unauthorized player turns without mutating state or writing a snapshot', () => {
    const initialState = createState(createMap(), [])
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const result = applyTurnTokenCommandUseCase({ command: createTurnCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(result.status).toBe('rejected')
    if (result.status !== 'rejected') throw new Error('expected unauthorized rejection')
    expect(result.result).toMatchObject({
      status: 'rejected',
      reason: 'unauthorized',
      retryable: false,
      currentRevision: parseSessionRevision(0),
      permission: { allowed: false, reason: 'missing-player-identity' },
    })
    expect(store.get(sessionId)?.state).toEqual(initialState)
    expect(snapshotCalls).toEqual([])
    expect(tracker.recordCount).toBe(1)
  })

  it('rejects no-op facing as a conflict without revision increments', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const result = applyTurnTokenCommandUseCase({
      command: createTurnCommand({
        opId: parseOpId('op_turnnoop0001'),
        payload: { tokenId: 'token-pikachu', facing: 'south-east' },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(result.status).toBe('rejected')
    if (result.status !== 'rejected') throw new Error('expected no-op conflict')
    expect(result.result).toMatchObject({
      reason: 'conflict',
      retryable: false,
      currentRevision: parseSessionRevision(0),
      currentState: {
        tokenId: 'token-pikachu',
        mapSlug: 'arena-map',
        facing: 'south-east',
      },
    })
    expect(store.get(sessionId)?.state).toEqual(initialState)
    expect(snapshotCalls).toEqual([])
  })

  it('rejects stale same-token turnToken commands with current authoritative token facing', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const first = applyTurnTokenCommandUseCase({ command: createTurnCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(first.status).toBe('accepted')

    const staleCommand = createTurnCommand({
      opId: parseOpId('op_turnstale001'),
      baseRevision: parseSessionRevision(0),
      payload: { tokenId: 'token-pikachu', facing: 'south-west' },
      metadata: { traceId: 'trace-turn-token-stale' },
    })

    const result = applyTurnTokenCommandUseCase({ command: staleCommand }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => '2026-05-26T11:00:06.100Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(result.status).toBe('rejected')
    if (result.status !== 'rejected') throw new Error('expected stale rejection')
    expect(result.result).toMatchObject({
      status: 'rejected',
      reason: 'stale',
      retryable: true,
      currentRevision: parseSessionRevision(1),
      baseRevision: parseSessionRevision(0),
      message: 'Token token-pikachu facing changed after revision 0.',
      currentState: {
        tokenId: 'token-pikachu',
        mapSlug: 'arena-map',
        facing: 'north-west',
        turned: true,
        revision: parseSessionRevision(1),
        mapRevision: parseMapRevision(1),
      },
      metadata: {
        serverProcessedAt: '2026-05-26T11:00:06.100Z',
        traceId: 'trace-turn-token-stale',
      },
    })
    if (result.result.reason !== 'stale') throw new Error('expected stale result shape')
    expect(result.result.changedScopes).toEqual(createTurnCommand().scopes)
    expect(snapshotCalls).toHaveLength(1)
    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(1))
    expect(tracker.recordCount).toBe(2)
  })

  it('allows stale-base turnToken commands across a tracked unrelated token movement revision gap', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    expect(applyMoveTokenCommandUseCase({ command: createMoveCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    }).status).toBe('accepted')

    const turn = createTurnCommand({
      opId: parseOpId('op_turngap0001'),
      baseRevision: parseSessionRevision(0),
    })
    const result = applyTurnTokenCommandUseCase({ command: turn }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => '2026-05-26T11:00:06.000Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('expected unrelated stale gap to apply')
    expect(result.session.revision).toBe(parseSessionRevision(2))
    expect(result.previousToken.facing).toBe('south-east')
    expect(result.token.facing).toBe('north-west')
    expect(snapshotCalls).toHaveLength(2)
  })

  it('returns duplicate opId results without applying a turn twice', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const command = createTurnCommand()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const first = applyTurnTokenCommandUseCase({ command }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(first.status).toBe('accepted')

    const duplicate = applyTurnTokenCommandUseCase({
      command: createTurnCommand({
        metadata: { traceId: 'trace-turn-token-duplicate' },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => '2026-05-26T11:00:06.100Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(duplicate.status).toBe('duplicate')
    if (duplicate.status !== 'duplicate') throw new Error('expected duplicate result')
    expect(duplicate.result).toMatchObject({
      status: 'duplicate',
      idempotent: true,
      currentRevision: parseSessionRevision(1),
      original: { status: 'accepted', revision: parseSessionRevision(1) },
      metadata: {
        serverProcessedAt: '2026-05-26T11:00:06.100Z',
        traceId: 'trace-turn-token-duplicate',
      },
    })
    expect(snapshotCalls).toHaveLength(1)
    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(1))
  })

  it('rolls back store state and does not remember accepted operations when snapshot persistence fails', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()

    expect(() => applyTurnTokenCommandUseCase({ command: createTurnCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: () => {
        throw new Error('disk full')
      },
    })).toThrow('Failed to write turnToken session snapshot: disk full')

    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(0))
    expect(store.get(sessionId)?.updatedAt).toBe(createdAt)
    expect(store.get(sessionId)?.state).toEqual(initialState)
    expect(tracker.recordCount).toBe(0)
  })

  it('fails closed when session hosting is disabled', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)

    expect(() => applyTurnTokenCommandUseCase({ command: createTurnCommand() }, {
      env: {},
      store,
      operationTracker: false,
      writeSnapshot: createSnapshotWriter([]),
    })).toThrow('Track 2 session hosting is disabled')
  })
})
