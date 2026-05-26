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
  USE_ABILITY_COMMAND_TYPE,
  USE_MANEUVER_COMMAND_TYPE,
  USE_ORDER_COMMAND_TYPE,
  createUseAbilitySheetCommandScope,
  createUseAbilityTokenCommandScope,
  createUseManeuverSheetCommandScope,
  createUseManeuverTokenCommandScope,
  createUseOrderSheetCommandScope,
  createUseOrderTokenCommandScope,
  type UseAbilityCommand,
  type UseManeuverCommand,
  type UseOrderCommand,
} from '#shared/sessionTableActionCommands'
import type { TabletopMapV2 } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  USE_ABILITY_PATCH_EVENT_TYPE,
  USE_MANEUVER_PATCH_EVENT_TYPE,
  USE_ORDER_PATCH_EVENT_TYPE,
  applyUseTableActionCommandUseCase,
  type UseTableActionSheetReader,
  type UseTableActionSheetWriter,
} from '~~/server/useCases/applyUseTableActionCommand'
import { createInMemorySessionOperationTracker } from '~~/server/utils/sessionOperationTracker'
import {
  createPersistedSessionSnapshot,
  type WriteSessionSnapshotResult,
} from '~~/server/utils/sessionSnapshots'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'

const enabledEnv = { ROTOM_ENABLE_SESSION_HOST: '1' } as const
const sessionId = parseSessionId('session_useactuc0001')
const joinCode = parseJoinCode('UAC234')
const gmKey = parseGmKey('gmkey_useactionusecase00000001x')
const gmClientId = parseClientId('client_uacucgm01')
const playerClientId = parseClientId('client_uacucpl01')
const playerId = parsePlayerId('player_uacuc001')
const displayName = sanitizeSessionDisplayName('Action Player')
const createdAt = '2026-05-26T20:00:00.000Z'
const processedAt = '2026-05-26T20:00:05.000Z'

const playerActor: PlayerSessionActor = {
  role: 'player',
  playerId,
  clientId: playerClientId,
  displayName,
}

const trainerTokenResource = {
  kind: 'token',
  tokenId: 'token-brock',
  mapSlug: 'arena-map',
  sheetKind: 'trainer',
  sheetSlug: 'brock',
} as const satisfies SessionTokenResourceRef

const trainerSheetResource = {
  kind: 'sheet',
  sheetKind: 'trainer',
  sheetSlug: 'brock',
} as const satisfies SessionSheetResourceRef

const assignment = {
  playerId,
  displayName,
  controllableResources: [trainerTokenResource],
  visibleResources: [{ kind: 'map', mapSlug: 'arena-map' }, trainerTokenResource, trainerSheetResource],
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
      id: 'token-brock',
      sheetKind: 'trainer',
      sheetSlug: 'brock',
      position: { x: 1, y: 0, z: 1 },
      facing: 'south-east',
    },
  ],
  lights: [],
  initiative: { activeId: 'token-brock', round: 2 },
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

const createTrainerSheet = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'brock',
  name: 'Brock',
  level: 20,
  player: true,
  abilities: [{ name: 'Sand Veil' }],
  maneuvers: [],
  orders: [
    {
      name: 'Rallying Cry',
      tags: ['Orders'],
      effect: 'All allies gain courage until the end of your next turn.',
    },
  ],
  stats: {},
  combatStages: {},
  conditions: [],
  ...overrides,
})

const createSheetIo = (initialTrainer = createTrainerSheet()) => {
  let trainerSheet = JSON.parse(JSON.stringify(initialTrainer)) as TrainerSheet
  const writes: TrainerSheet[] = []
  const readSheet: UseTableActionSheetReader = (kind, slug) => {
    if (kind !== 'trainer' || slug !== 'brock') return null
    return {
      path: '/tmp/brock.json',
      sheet: JSON.parse(JSON.stringify(trainerSheet)) as TrainerSheet,
    }
  }
  const writeSheet: UseTableActionSheetWriter = (_path, sheet) => {
    writes.push(JSON.parse(JSON.stringify(sheet)) as TrainerSheet)
    trainerSheet = JSON.parse(JSON.stringify(sheet)) as TrainerSheet
  }
  return {
    readSheet,
    writeSheet,
    writes,
    get trainerSheet() {
      return trainerSheet
    },
  }
}

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

const createUseManeuverCommand = (overrides: Partial<UseManeuverCommand> = {}): UseManeuverCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: playerActor,
  type: USE_MANEUVER_COMMAND_TYPE,
  opId: parseOpId('op_useactman001'),
  baseRevision: parseSessionRevision(0),
  scopes: [
    createUseManeuverTokenCommandScope(trainerTokenResource),
    createUseManeuverSheetCommandScope(trainerSheetResource),
  ],
  payload: {
    tokenId: 'token-brock',
    maneuverName: 'Trip',
  },
  ...overrides,
})

const createUseAbilityCommand = (overrides: Partial<UseAbilityCommand> = {}): UseAbilityCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: playerActor,
  type: USE_ABILITY_COMMAND_TYPE,
  opId: parseOpId('op_useactabl001'),
  baseRevision: parseSessionRevision(0),
  scopes: [
    createUseAbilityTokenCommandScope(trainerTokenResource),
    createUseAbilitySheetCommandScope(trainerSheetResource),
  ],
  payload: {
    tokenId: 'token-brock',
    abilityName: 'Sand Veil',
  },
  ...overrides,
})

const createUseOrderCommand = (overrides: Partial<UseOrderCommand> = {}): UseOrderCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: playerActor,
  type: USE_ORDER_COMMAND_TYPE,
  opId: parseOpId('op_useactord001'),
  baseRevision: parseSessionRevision(0),
  scopes: [
    createUseOrderTokenCommandScope(trainerTokenResource),
    createUseOrderSheetCommandScope(trainerSheetResource),
  ],
  payload: {
    tokenId: 'token-brock',
    orderName: 'Rallying Cry',
  },
  ...overrides,
})

describe('applyUseTableActionCommandUseCase', () => {
  it('records a maneuver use as authoritative map metadata and broadcasts a small patch', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const sheetIo = createSheetIo()

    const result = applyUseTableActionCommandUseCase({ command: createUseManeuverCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('expected accepted maneuver')
    expect(result.session.revision).toBe(parseSessionRevision(1))
    expect(result.patchEvent).toMatchObject({
      eventType: USE_MANEUVER_PATCH_EVENT_TYPE,
      revision: parseSessionRevision(1),
      payload: {
        tokenId: 'token-brock',
        mapSlug: 'arena-map',
        maneuverName: 'Trip',
        logLines: expect.arrayContaining(['Brock used Trip.']),
      },
    })
    expect(sheetIo.writes).toHaveLength(0)
    expect(snapshotCalls).toHaveLength(1)
    const storedMap = getSessionMapState(result.state, 'arena-map')
    expect(storedMap?.revision).toBe(parseMapRevision(1))
    expect(storedMap?.document.metadata?.maneuverLog).toEqual([
      expect.objectContaining({ userId: 'token-brock', maneuverName: 'Trip' }),
    ])
    expect(tracker.recordCount).toBe(1)
  })

  it('activates sheet abilities through the command boundary with sheet rollback-safe persistence', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const sheetIo = createSheetIo()

    const result = applyUseTableActionCommandUseCase({ command: createUseAbilityCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('expected accepted ability')
    expect(result.patchEvent).toMatchObject({
      eventType: USE_ABILITY_PATCH_EVENT_TYPE,
      payload: {
        tokenId: 'token-brock',
        abilityName: 'Sand Veil',
        category: 'sheet',
        activated: true,
        logLines: ['Brock activated Sand Veil.'],
      },
    })
    expect(sheetIo.writes).toHaveLength(1)
    expect(sheetIo.trainerSheet.abilities?.[0]).toMatchObject({ name: 'Sand Veil', activated: true })
    const storedMap = getSessionMapState(result.state, 'arena-map')
    expect(storedMap?.document.metadata?.abilityLog).toEqual([
      expect.objectContaining({ userId: 'token-brock', abilityName: 'Sand Veil', category: 'sheet' }),
    ])
    expect(snapshotCalls).toHaveLength(1)
  })

  it('records trainer orders and authoritative active-order effects', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const sheetIo = createSheetIo()

    const result = applyUseTableActionCommandUseCase({ command: createUseOrderCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('expected accepted order')
    expect(result.patchEvent).toMatchObject({
      eventType: USE_ORDER_PATCH_EVENT_TYPE,
      payload: {
        tokenId: 'token-brock',
        orderName: 'Rallying Cry',
        activeEffect: expect.objectContaining({
          id: 'ord-op_useactord001',
          orderName: 'Rallying Cry',
          userId: 'token-brock',
        }),
      },
    })
    const storedMap = getSessionMapState(result.state, 'arena-map')
    expect(storedMap?.document.metadata?.orderLog).toEqual([
      expect.objectContaining({ userId: 'token-brock', orderName: 'Rallying Cry' }),
    ])
    expect(storedMap?.document.metadata?.activeOrderEffects).toEqual([
      expect.objectContaining({ id: 'ord-op_useactord001', orderName: 'Rallying Cry' }),
    ])
    expect(snapshotCalls).toHaveLength(1)
  })

  it('rejects unassigned player table actions without mutating state or writing snapshots', () => {
    const initialState = createState([])
    const store = createStoreWithState(initialState)
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const sheetIo = createSheetIo()

    const result = applyUseTableActionCommandUseCase({ command: createUseManeuverCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })

    expect(result.status).toBe('rejected')
    if (result.status !== 'rejected') throw new Error('expected rejected maneuver')
    expect(result.result).toMatchObject({
      reason: 'unauthorized',
      commandType: USE_MANEUVER_COMMAND_TYPE,
      currentRevision: parseSessionRevision(0),
    })
    expect(snapshotCalls).toHaveLength(0)
    expect(sheetIo.writes).toHaveLength(0)
    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(0))
  })

  it('returns duplicate command results idempotently for repeated opIds', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const sheetIo = createSheetIo()
    const command = createUseManeuverCommand()

    const first = applyUseTableActionCommandUseCase({ command }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })
    const second = applyUseTableActionCommandUseCase({ command }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => '2026-05-26T20:00:06.000Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })

    expect(first.status).toBe('accepted')
    expect(second.status).toBe('duplicate')
    if (second.status !== 'duplicate') throw new Error('expected duplicate')
    expect(second.result).toMatchObject({
      status: 'duplicate',
      idempotent: true,
      currentRevision: parseSessionRevision(1),
      original: {
        status: 'accepted',
        revision: parseSessionRevision(1),
      },
    })
    expect(snapshotCalls).toHaveLength(1)
  })
})
