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
  PlayerAssignmentRecord,
  PlayerSessionActor,
  SessionSheetResourceRef,
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
  USE_MOVE_COMMAND_TYPE,
  createUseMoveSheetCommandScope,
  createUseMoveTokenCommandScope,
  type UseMoveCommand,
} from '#shared/sessionTableActionCommands'
import type { TabletopMapV2 } from '~/types/map'
import {
  ApplyUseMoveCommandUseCaseError,
  USE_MOVE_PATCH_EVENT_TYPE,
  applyUseMoveCommandUseCase,
  type UseMoveSheetReader,
  type UseMoveSheetWriter,
} from '~~/server/useCases/applyUseMoveCommand'
import { createInMemorySessionOperationTracker } from '~~/server/utils/sessionOperationTracker'
import {
  createPersistedSessionSnapshot,
  type WriteSessionSnapshotResult,
} from '~~/server/utils/sessionSnapshots'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'

const enabledEnv = { ROTOM_ENABLE_SESSION_HOST: '1' } as const
const sessionId = parseSessionId('session_usemoveuc001')
const joinCode = parseJoinCode('UMV234')
const gmKey = parseGmKey('gmkey_usemoveusecase000000001x')
const gmClientId = parseClientId('client_umvucgm1')
const playerClientId = parseClientId('client_umvucpl1')
const playerId = parsePlayerId('player_umvuc001')
const displayName = sanitizeSessionDisplayName('Move Player')
const createdAt = '2026-05-26T18:00:00.000Z'
const processedAt = '2026-05-26T18:00:05.000Z'

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

const sheetResource = {
  kind: 'sheet',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
} as const satisfies SessionSheetResourceRef

const assignment = {
  playerId,
  displayName,
  controllableResources: [tokenResource],
  visibleResources: [{ kind: 'map', mapSlug: 'arena-map' }, tokenResource, sheetResource],
  updatedAt: createdAt,
  updatedByClientId: gmClientId,
} as const satisfies PlayerAssignmentRecord

const createMap = (): TabletopMapV2 => ({
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
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  moveUsage: { byPlacementId: {} },
  metadata: {},
  createdAt: 1_000,
  updatedAt: 1_000,
})

const createState = (
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
      document: createMap(),
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

const createSheet = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  slug: 'pikachu',
  nickname: 'Pikachu',
  species: '',
  level: 20,
  player: true,
  movelist: [
    { name: 'Thunderbolt' },
    { name: 'Protect' },
    { name: 'Hyper Beam' },
    { name: 'Tackle' },
  ],
  ...overrides,
})

const createCommand = (overrides: Partial<UseMoveCommand> = {}): UseMoveCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: playerActor,
  type: USE_MOVE_COMMAND_TYPE,
  opId: parseOpId('op_usemoveuc001'),
  baseRevision: parseSessionRevision(0),
  scopes: [
    createUseMoveTokenCommandScope(tokenResource),
    createUseMoveSheetCommandScope(sheetResource),
  ],
  payload: {
    tokenId: 'token-pikachu',
    moveName: 'Thunderbolt',
  },
  metadata: {
    traceId: 'trace-use-move-use-case',
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

const createSheetIo = (initialSheet = createSheet()) => {
  let currentSheet = JSON.parse(JSON.stringify(initialSheet)) as Record<string, unknown>
  const writes: Record<string, unknown>[] = []
  const readSheet: UseMoveSheetReader = (kind, slug) => {
    if (kind !== 'pokemon' || slug !== 'pikachu') return null
    return {
      path: '/tmp/pikachu.json',
      sheet: JSON.parse(JSON.stringify(currentSheet)) as Record<string, unknown>,
    }
  }
  const writeSheet: UseMoveSheetWriter = (_path, sheet) => {
    writes.push(JSON.parse(JSON.stringify(sheet)) as Record<string, unknown>)
    currentSheet = JSON.parse(JSON.stringify(sheet)) as Record<string, unknown>
  }
  return {
    readSheet,
    writeSheet,
    writes,
    get currentSheet() {
      return currentSheet
    },
  }
}

describe('applyUseMoveCommandUseCase', () => {
  it('records EOT move usage on authoritative map state, increments revisions, writes a snapshot, and returns a small patch', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const sheetIo = createSheetIo()

    const result = applyUseMoveCommandUseCase({ command: createCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('expected accepted useMove')
    expect(result.session.revision).toBe(parseSessionRevision(1))
    expect(result.patchEvent).toMatchObject({
      eventType: USE_MOVE_PATCH_EVENT_TYPE,
      revision: parseSessionRevision(1),
      payload: {
        tokenId: 'token-pikachu',
        mapSlug: 'arena-map',
        moveName: 'Thunderbolt',
        moveKey: 'thunderbolt',
        frequencyKind: 'eot',
        tracking: 'map',
        previousUsage: { uses: 0, available: true },
        usage: { uses: 1, lastUsedRound: 1, nextAvailableRound: 3, available: false },
      },
    })
    expect(result.result).toMatchObject({
      status: 'accepted',
      commandType: USE_MOVE_COMMAND_TYPE,
      currentRevision: parseSessionRevision(1),
      metadata: {
        serverProcessedAt: processedAt,
        traceId: 'trace-use-move-use-case',
      },
    })
    expect(sheetIo.writes).toHaveLength(0)
    expect(snapshotCalls).toHaveLength(1)
    const stored = store.get(sessionId)
    expect(stored?.revision).toBe(parseSessionRevision(1))
    const storedMap = getSessionMapState(stored?.state ?? initialState, 'arena-map')
    expect(storedMap?.revision).toBe(parseMapRevision(1))
    expect(storedMap?.document.moveUsage?.byPlacementId['token-pikachu']?.thunderbolt).toMatchObject({
      moveName: 'Thunderbolt',
      frequency: 'eot',
      uses: 1,
      lastUsedRound: 1,
    })
    expect(tracker.recordCount).toBe(1)
  })

  it('records Daily move usage on the sheet and current map Scene', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const sheetIo = createSheetIo()

    const result = applyUseMoveCommandUseCase({
      command: createCommand({
        opId: parseOpId('op_usemoveuc002'),
        payload: { tokenId: 'token-pikachu', moveName: 'Hyper Beam' },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('expected accepted daily useMove')
    expect(result.patchEvent.payload).toMatchObject({
      moveName: 'Hyper Beam',
      moveKey: 'hyper-beam',
      frequencyKind: 'daily',
      tracking: 'sheet',
      usage: {
        uses: 1,
        maxUses: 2,
        remainingUses: 1,
        sceneUses: 1,
        sceneMaxUses: 1,
        sceneRemainingUses: 0,
        available: false,
      },
    })
    expect(sheetIo.writes).toHaveLength(1)
    expect(sheetIo.currentSheet.moveUsage).toEqual({
      daily: {
        'hyper-beam': {
          moveName: 'Hyper Beam',
          uses: 1,
          updatedAt: Date.parse(processedAt),
        },
      },
    })
    const storedMap = getSessionMapState(result.state, 'arena-map')
    expect(storedMap?.revision).toBe(parseMapRevision(1))
    expect(storedMap?.document.moveUsage?.byPlacementId['token-pikachu']?.['hyper-beam']).toMatchObject({
      moveName: 'Hyper Beam',
      frequency: 'daily',
      uses: 1,
      lastUsedRound: 1,
    })
    expect(snapshotCalls).toHaveLength(1)
  })

  it('rejects unavailable EOT usage without mutating state or writing snapshots', () => {
    const map = createMap()
    map.moveUsage = {
      byPlacementId: {
        'token-pikachu': {
          thunderbolt: {
            moveName: 'Thunderbolt',
            frequency: 'eot',
            uses: 1,
            lastUsedRound: 1,
          },
        },
      },
    }
    const initialState = createAuthoritativeSessionState<TabletopMapV2>({
      ...createState(),
      maps: [createAuthoritativeSessionMapState({
        mapSlug: 'arena-map',
        revision: parseMapRevision(0),
        document: map,
      })],
    })
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const sheetIo = createSheetIo()

    const result = applyUseMoveCommandUseCase({
      command: createCommand({ opId: parseOpId('op_usemoveuc003') }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      readSheet: sheetIo.readSheet,
    })

    expect(result.status).toBe('rejected')
    if (result.status !== 'rejected') throw new Error('expected rejected unavailable useMove')
    expect(result.result).toMatchObject({
      reason: 'conflict',
      currentRevision: parseSessionRevision(0),
      currentState: {
        tokenId: 'token-pikachu',
        usage: { uses: 1, nextAvailableRound: 3, available: false },
      },
    })
    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(0))
    expect(snapshotCalls).toHaveLength(0)
    expect(sheetIo.writes).toHaveLength(0)
    expect(tracker.recordCount).toBe(1)
  })

  it('rejects unauthorized players without reading sheets or writing snapshots', () => {
    const initialState = createState([])
    const store = createStoreWithState(initialState)
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    let readCount = 0

    const result = applyUseMoveCommandUseCase({ command: createCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      readSheet: () => {
        readCount += 1
        return null
      },
    })

    expect(result.status).toBe('rejected')
    if (result.status !== 'rejected') throw new Error('expected unauthorized useMove')
    expect(result.result.reason).toBe('unauthorized')
    expect(readCount).toBe(0)
    expect(snapshotCalls).toHaveLength(0)
    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(0))
  })

  it('returns idempotent duplicate results and rejects stale same-token move usage', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const sheetIo = createSheetIo()

    const accepted = applyUseMoveCommandUseCase({ command: createCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })
    expect(accepted.status).toBe('accepted')

    const duplicate = applyUseMoveCommandUseCase({ command: createCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => '2026-05-26T18:00:06.000Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })
    expect(duplicate.status).toBe('duplicate')
    if (duplicate.status !== 'duplicate') throw new Error('expected duplicate useMove')
    expect(duplicate.result).toMatchObject({
      status: 'duplicate',
      original: { status: 'accepted', revision: parseSessionRevision(1) },
      currentRevision: parseSessionRevision(1),
    })

    const stale = applyUseMoveCommandUseCase({
      command: createCommand({
        opId: parseOpId('op_usemoveuc004'),
        payload: { tokenId: 'token-pikachu', moveName: 'Protect' },
        baseRevision: parseSessionRevision(0),
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => '2026-05-26T18:00:07.000Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })
    expect(stale.status).toBe('rejected')
    if (stale.status !== 'rejected') throw new Error('expected stale useMove')
    expect(stale.result).toMatchObject({
      reason: 'stale',
      baseRevision: parseSessionRevision(0),
      currentRevision: parseSessionRevision(1),
      currentState: { tokenId: 'token-pikachu', usage: { moveName: 'Protect' } },
    })
    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(1))
  })

  it('rolls back daily sheet writes when snapshot persistence fails', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const sheetIo = createSheetIo()

    expect(() => applyUseMoveCommandUseCase({
      command: createCommand({
        opId: parseOpId('op_usemoveuc005'),
        payload: { tokenId: 'token-pikachu', moveName: 'Hyper Beam' },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: () => {
        throw new Error('disk full')
      },
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })).toThrow(ApplyUseMoveCommandUseCaseError)

    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(0))
    expect(sheetIo.writes).toHaveLength(2)
    expect(sheetIo.currentSheet.moveUsage).toBeUndefined()
  })
})
