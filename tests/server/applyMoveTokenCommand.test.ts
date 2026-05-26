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
  type SessionRevision,
} from '#shared/sessionRevisions'
import {
  createAuthoritativeSessionMapState,
  createAuthoritativeSessionState,
  getSessionMapState,
  type AuthoritativeSessionState,
} from '#shared/sessionState'
import {
  createMoveTokenCommandScope,
  MOVE_TOKEN_COMMAND_TYPE,
  type MoveTokenCommand,
} from '#shared/sessionTokenCommands'
import type { TabletopMapV2 } from '~/types/map'
import {
  applyMoveTokenCommandUseCase,
  MOVE_TOKEN_PATCH_EVENT_TYPE,
} from '~~/server/useCases/applyMoveTokenCommand'
import {
  createPersistedSessionSnapshot,
  type WriteSessionSnapshotResult,
} from '~~/server/utils/sessionSnapshots'
import { createInMemorySessionOperationTracker } from '~~/server/utils/sessionOperationTracker'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'

const enabledEnv = { ROTOM_ENABLE_SESSION_HOST: '1' } as const
const sessionId = parseSessionId('session_movetokenuc001')
const joinCode = parseJoinCode('MV5AAA')
const gmKey = parseGmKey('gmkey_movetokenusecase00000000')
const gmClientId = parseClientId('client_moveGM001')
const playerClientId = parseClientId('client_movePL001')
const playerId = parsePlayerId('player_moveuc01')
const displayName = sanitizeSessionDisplayName('Move Player')
const createdAt = '2026-05-26T10:00:00.000Z'
const processedAt = '2026-05-26T10:00:05.000Z'

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
    },
    {
      id: 'token-eevee',
      sheetKind: 'pokemon',
      sheetSlug: 'eevee',
      position: { x: 3, y: 0, z: 1 },
      facing: 'south-west',
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

const createCommand = (
  overrides: Partial<MoveTokenCommand> = {},
): MoveTokenCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: playerActor,
  type: MOVE_TOKEN_COMMAND_TYPE,
  opId: parseOpId('op_movetokenuc001'),
  baseRevision: parseSessionRevision(0),
  scopes: [createMoveTokenCommandScope(tokenResource)],
  payload: {
    tokenId: 'token-pikachu',
    to: { x: 2, y: 0, z: 2 },
  },
  metadata: {
    clientIssuedAt: '2026-05-26T10:00:04.500Z',
    clientSequence: 1,
    traceId: 'trace-move-token-use-case',
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

describe('applyMoveTokenCommandUseCase', () => {
  it('applies an authorized moveToken command to authoritative state, increments revisions, and writes a snapshot', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const command = createCommand()

    const result = applyMoveTokenCommandUseCase({ command }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('expected accepted moveToken')
    expect(result.session.revision).toBe(parseSessionRevision(1))
    expect(result.result).toMatchObject({
      status: 'accepted',
      commandType: 'moveToken',
      currentRevision: parseSessionRevision(1),
      metadata: {
        serverProcessedAt: processedAt,
        traceId: 'trace-move-token-use-case',
      },
    })
    expect(result.patchEvent).toMatchObject({
      eventType: MOVE_TOKEN_PATCH_EVENT_TYPE,
      revision: parseSessionRevision(1),
      payload: {
        tokenId: 'token-pikachu',
        mapSlug: 'arena-map',
        from: { x: 1, y: 0, z: 1 },
        to: { x: 2, y: 0, z: 2 },
        sheetKind: 'pokemon',
        sheetSlug: 'pikachu',
      },
    })
    expect(result.previousToken.position).toEqual({ x: 1, y: 0, z: 1 })
    expect(result.token).toMatchObject({
      tokenId: 'token-pikachu',
      position: { x: 2, y: 0, z: 2 },
      revision: parseSessionRevision(1),
      mapRevision: parseMapRevision(1),
    })
    expect(result.mapRevisionChanges).toEqual([
      expect.objectContaining({
        mapSlug: 'arena-map',
        previousRevision: parseMapRevision(0),
        currentRevision: parseMapRevision(1),
      }),
    ])
    expect(snapshotCalls).toHaveLength(1)
    expect(snapshotCalls[0]?.revision).toBe(parseSessionRevision(1))
    expect(result.snapshot).toEqual({
      writtenAt: processedAt,
      revision: parseSessionRevision(1),
    })
    expect(tracker.recordCount).toBe(1)

    const stored = store.get(sessionId)
    expect(stored?.revision).toBe(parseSessionRevision(1))
    const storedMap = getSessionMapState(stored?.state ?? initialState, 'arena-map')
    expect(storedMap?.revision).toBe(parseMapRevision(1))
    expect(storedMap?.document.placements.find((placement) => placement.id === 'token-pikachu')?.position)
      .toEqual({ x: 2, y: 0, z: 2 })
    expect(storedMap?.document.placements.find((placement) => placement.id === 'token-eevee')?.position)
      .toEqual({ x: 3, y: 0, z: 1 })
  })

  it('allows a GM actor to apply moveToken without player assignment records', () => {
    const initialState = createState(createMap(), [])
    const store = createStoreWithState(initialState)
    const command = createCommand({
      actor: gmActor,
      opId: parseOpId('op_movetokenucgm1'),
    })

    const result = applyMoveTokenCommandUseCase({ command }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter([]),
    })

    expect(result.status).toBe('accepted')
    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(1))
  })

  it('rejects unauthorized player movement without mutating state or writing a snapshot', () => {
    const initialState = createState(createMap(), [])
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const command = createCommand()

    const result = applyMoveTokenCommandUseCase({ command }, {
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
      permission: {
        allowed: false,
        reason: 'missing-player-identity',
      },
    })
    expect(store.get(sessionId)?.state).toEqual(initialState)
    expect(snapshotCalls).toEqual([])
    expect(tracker.recordCount).toBe(1)
  })

  it('rejects occupied or blocked destinations as conflicts without revision increments', () => {
    const blockedMap = createMap({
      voxels: [
        { x: 4, y: 0, z: 4, materialId: 'stone', blocksMovement: true },
      ],
    })

    for (const [label, to] of [
      ['occupied', { x: 3, y: 0, z: 1 }],
      ['blocked', { x: 4, y: 0, z: 4 }],
      ['out-of-bounds', { x: 6, y: 0, z: 1 }],
    ] as const) {
      const initialState = createState(blockedMap)
      const store = createStoreWithState(initialState)
      const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
      const command = createCommand({
        opId: parseOpId(`op_move${label.replace(/-/g, '')}001`),
        payload: { tokenId: 'token-pikachu', to },
      })

      const result = applyMoveTokenCommandUseCase({ command }, {
        env: enabledEnv,
        store,
        operationTracker: false,
        clock: () => processedAt,
        writeSnapshot: createSnapshotWriter(snapshotCalls),
      })

      expect(result.status, label).toBe('rejected')
      if (result.status !== 'rejected') throw new Error(`expected ${label} conflict`)
      expect(result.result).toMatchObject({
        reason: 'conflict',
        retryable: true,
        currentRevision: parseSessionRevision(0),
        currentState: {
          tokenId: 'token-pikachu',
          mapSlug: 'arena-map',
          position: { x: 1, y: 0, z: 1 },
        },
      })
      expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(0))
      expect(store.get(sessionId)?.state).toEqual(initialState)
      expect(snapshotCalls).toEqual([])
    }
  })

  it('rejects stale same-token moveToken commands with current authoritative token state', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const first = applyMoveTokenCommandUseCase({ command: createCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(first.status).toBe('accepted')

    const staleCommand = createCommand({
      opId: parseOpId('op_movetokenucstale001'),
      baseRevision: parseSessionRevision(0),
      payload: {
        tokenId: 'token-pikachu',
        to: { x: 4, y: 0, z: 2 },
      },
      metadata: {
        clientIssuedAt: '2026-05-26T10:00:06.000Z',
        clientSequence: 2,
        traceId: 'trace-move-token-stale',
      },
    })

    const result = applyMoveTokenCommandUseCase({ command: staleCommand }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => '2026-05-26T10:00:06.100Z',
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
      message: 'Token token-pikachu changed after revision 0.',
      currentState: {
        tokenId: 'token-pikachu',
        mapSlug: 'arena-map',
        position: { x: 2, y: 0, z: 2 },
        revision: parseSessionRevision(1),
        mapRevision: parseMapRevision(1),
        sheetKind: 'pokemon',
        sheetSlug: 'pikachu',
      },
      metadata: {
        serverProcessedAt: '2026-05-26T10:00:06.100Z',
        traceId: 'trace-move-token-stale',
      },
    })
    if (result.result.reason !== 'stale') throw new Error('expected stale result shape')
    expect(result.result.changedScopes).toEqual(createCommand().scopes)
    expect(snapshotCalls).toHaveLength(1)
    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(1))
    expect(getSessionMapState(store.get(sessionId)?.state ?? initialState, 'arena-map')?.document.placements
      .find((placement) => placement.id === 'token-pikachu')?.position)
      .toEqual({ x: 2, y: 0, z: 2 })
    expect(tracker.recordCount).toBe(2)
  })

  it('allows stale-base moveToken commands across a tracked unrelated token revision gap', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const eeveeMove = createCommand({
      actor: gmActor,
      opId: parseOpId('op_movetokenuceevee001'),
      scopes: [createMoveTokenCommandScope(eeveeTokenResource)],
      payload: {
        tokenId: 'token-eevee',
        to: { x: 4, y: 0, z: 2 },
      },
    })
    expect(applyMoveTokenCommandUseCase({ command: eeveeMove }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    }).status).toBe('accepted')

    const pikachuMove = createCommand({
      opId: parseOpId('op_movetokenucgap001'),
      baseRevision: parseSessionRevision(0),
      payload: {
        tokenId: 'token-pikachu',
        to: { x: 2, y: 0, z: 2 },
      },
    })
    const result = applyMoveTokenCommandUseCase({ command: pikachuMove }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => '2026-05-26T10:00:06.000Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('expected unrelated stale gap to apply')
    expect(result.session.revision).toBe(parseSessionRevision(2))
    expect(result.previousToken.position).toEqual({ x: 1, y: 0, z: 1 })
    expect(result.token.position).toEqual({ x: 2, y: 0, z: 2 })
    expect(snapshotCalls).toHaveLength(2)
    expect(getSessionMapState(store.get(sessionId)?.state ?? initialState, 'arena-map')?.document.placements)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'token-pikachu', position: { x: 2, y: 0, z: 2 } }),
        expect.objectContaining({ id: 'token-eevee', position: { x: 4, y: 0, z: 2 } }),
      ]))
  })

  it('returns duplicate opId results without applying a move twice', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const command = createCommand()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const first = applyMoveTokenCommandUseCase({ command }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(first.status).toBe('accepted')

    const duplicate = applyMoveTokenCommandUseCase({
      command: createCommand({
        metadata: {
          clientIssuedAt: '2026-05-26T10:00:06.000Z',
          clientSequence: 2,
          traceId: 'trace-move-token-duplicate',
        },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => '2026-05-26T10:00:06.100Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(duplicate.status).toBe('duplicate')
    if (duplicate.status !== 'duplicate') throw new Error('expected duplicate result')
    expect(duplicate.result).toMatchObject({
      status: 'duplicate',
      idempotent: true,
      currentRevision: parseSessionRevision(1),
      original: {
        status: 'accepted',
        revision: parseSessionRevision(1),
      },
      metadata: {
        serverProcessedAt: '2026-05-26T10:00:06.100Z',
        traceId: 'trace-move-token-duplicate',
      },
    })
    expect(snapshotCalls).toHaveLength(1)
    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(1))
    expect(getSessionMapState(store.get(sessionId)?.state ?? initialState, 'arena-map')?.document.placements
      .find((placement) => placement.id === 'token-pikachu')?.position)
      .toEqual({ x: 2, y: 0, z: 2 })
  })

  it('rolls back store state and does not remember accepted operations when snapshot persistence fails', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const command = createCommand()

    expect(() => applyMoveTokenCommandUseCase({ command }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: () => {
        throw new Error('disk full')
      },
    })).toThrow('Failed to write moveToken session snapshot: disk full')

    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(0))
    expect(store.get(sessionId)?.updatedAt).toBe(createdAt)
    expect(store.get(sessionId)?.state).toEqual(initialState)
    expect(tracker.recordCount).toBe(0)
  })

  it('fails closed when session hosting is disabled', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)

    expect(() => applyMoveTokenCommandUseCase({ command: createCommand() }, {
      env: {},
      store,
      operationTracker: false,
      writeSnapshot: createSnapshotWriter([]),
    })).toThrow('live session hosting is disabled')
  })
})
