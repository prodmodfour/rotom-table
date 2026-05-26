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
  MODIFY_COMBAT_STAGES_COMMAND_TYPE,
  createModifyCombatStagesSheetCommandScope,
  createModifyCombatStagesTokenCommandScope,
  type ModifyCombatStagesCommand,
} from '#shared/sessionTableActionCommands'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMapV2 } from '~/types/map'
import {
  ApplyModifyCombatStagesCommandUseCaseError,
  MODIFY_COMBAT_STAGES_PATCH_EVENT_TYPE,
  applyModifyCombatStagesCommandUseCase,
  type ModifyCombatStagesSheetReader,
  type ModifyCombatStagesSheetWriter,
} from '~~/server/useCases/applyModifyCombatStagesCommand'
import { createInMemorySessionOperationTracker } from '~~/server/utils/sessionOperationTracker'
import {
  createPersistedSessionSnapshot,
  type WriteSessionSnapshotResult,
} from '~~/server/utils/sessionSnapshots'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'

const enabledEnv = { ROTOM_ENABLE_SESSION_HOST: '1' } as const
const sessionId = parseSessionId('session_modifycsuc01')
const joinCode = parseJoinCode('MCSABC')
const gmKey = parseGmKey('gmkey_modifycsusecase000000001x')
const gmClientId = parseClientId('client_mcsucgm1')
const playerClientId = parseClientId('client_mcsucpl1')
const playerId = parsePlayerId('player_mcsuc001')
const displayName = sanitizeSessionDisplayName('Stages Player')
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

const createPokemonSheet = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'pikachu',
  nickname: 'Pikachu',
  species: '',
  level: 20,
  stats: {
    hp: { added: 5 },
    atk: { added: 10, stage: 0 },
    def: { added: 8, stage: 0 },
    satk: { added: 9, stage: 0 },
    sdef: { added: 7, stage: 0 },
    spd: { added: 11, stage: 0 },
  },
  combat: { currentHp: 30, injuries: 0, conditions: [] },
  combatStages: { acc: 0 },
  player: true,
  ...overrides,
})

const requestedStages = { atk: 2, def: -1, satk: 0, sdef: 1, spd: -2, acc: 3 } as const

const createCommand = (overrides: Partial<ModifyCombatStagesCommand> = {}): ModifyCombatStagesCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: playerActor,
  type: MODIFY_COMBAT_STAGES_COMMAND_TYPE,
  opId: parseOpId('op_modifycsuc001'),
  baseRevision: parseSessionRevision(0),
  scopes: [
    createModifyCombatStagesTokenCommandScope(tokenResource),
    createModifyCombatStagesSheetCommandScope(sheetResource),
  ],
  payload: {
    tokenId: 'token-pikachu',
    stages: requestedStages,
  },
  metadata: {
    traceId: 'trace-modify-combat-stages-use-case',
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

const createSheetIo = (initialSheet = createPokemonSheet()) => {
  let currentSheet: CharacterSheet = JSON.parse(JSON.stringify(initialSheet)) as CharacterSheet
  const writes: Record<string, unknown>[] = []
  const readSheet: ModifyCombatStagesSheetReader = (kind, slug) => {
    if (kind !== 'pokemon' || slug !== 'pikachu') return null
    return {
      path: '/tmp/pikachu.json',
      sheet: JSON.parse(JSON.stringify(currentSheet)) as CharacterSheet,
    }
  }
  const writeSheet: ModifyCombatStagesSheetWriter = (_path, sheet) => {
    writes.push(JSON.parse(JSON.stringify(sheet)) as Record<string, unknown>)
    currentSheet = JSON.parse(JSON.stringify(sheet)) as CharacterSheet
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

describe('applyModifyCombatStagesCommandUseCase', () => {
  it('updates the placed sheet combat stages, increments session/map revisions, writes a snapshot, and returns a small patch', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const sheetIo = createSheetIo()

    const result = applyModifyCombatStagesCommandUseCase({ command: createCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('expected accepted modifyCombatStages')
    expect(result.session.revision).toBe(parseSessionRevision(1))
    expect(result.patchEvent).toMatchObject({
      eventType: MODIFY_COMBAT_STAGES_PATCH_EVENT_TYPE,
      revision: parseSessionRevision(1),
      payload: {
        tokenId: 'token-pikachu',
        mapSlug: 'arena-map',
        sheetKind: 'pokemon',
        sheetSlug: 'pikachu',
        previous: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
        current: requestedStages,
      },
    })
    expect(result.result).toMatchObject({
      status: 'accepted',
      commandType: MODIFY_COMBAT_STAGES_COMMAND_TYPE,
      currentRevision: parseSessionRevision(1),
      metadata: {
        serverProcessedAt: processedAt,
        traceId: 'trace-modify-combat-stages-use-case',
      },
    })
    expect(result.previousCombatStages.combatStages).toEqual({ atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 })
    expect(result.combatStages.combatStages).toEqual(requestedStages)
    expect(sheetIo.writes).toHaveLength(1)
    expect(sheetIo.currentSheet.stats?.atk?.stage).toBe(2)
    expect(sheetIo.currentSheet.stats?.def?.stage).toBe(-1)
    expect(sheetIo.currentSheet.stats?.spd?.stage).toBe(-2)
    expect(sheetIo.currentSheet.combatStages?.acc).toBe(3)
    expect(snapshotCalls).toHaveLength(1)
    expect(snapshotCalls[0]?.revision).toBe(parseSessionRevision(1))
    expect(result.snapshot).toEqual({ writtenAt: processedAt, revision: parseSessionRevision(1) })
    expect(tracker.recordCount).toBe(1)

    const stored = store.get(sessionId)
    expect(stored?.revision).toBe(parseSessionRevision(1))
    const storedMap = getSessionMapState(stored?.state ?? initialState, 'arena-map')
    expect(storedMap?.revision).toBe(parseMapRevision(1))
    expect(storedMap?.document.placements).toEqual(createMap().placements)
  })

  it('rejects unauthorized player combat-stage changes without reading sheets or writing snapshots', () => {
    const initialState = createState([])
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    let readCount = 0

    const result = applyModifyCombatStagesCommandUseCase({ command: createCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      readSheet: () => {
        readCount += 1
        return null
      },
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
    expect(readCount).toBe(0)
    expect(snapshotCalls).toEqual([])
    expect(store.get(sessionId)?.state).toEqual(initialState)
    expect(tracker.recordCount).toBe(1)
  })

  it('rejects stale same-token combat-stage changes with current authoritative stage state', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const sheetIo = createSheetIo()

    const first = applyModifyCombatStagesCommandUseCase({ command: createCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter([]),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })
    expect(first.status).toBe('accepted')

    const stale = applyModifyCombatStagesCommandUseCase({
      command: createCommand({
        opId: parseOpId('op_modifycsuc002'),
        baseRevision: parseSessionRevision(0),
        payload: { tokenId: 'token-pikachu', stages: { atk: 3, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 } },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => '2026-05-26T18:00:06.000Z',
      writeSnapshot: createSnapshotWriter([]),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })

    expect(stale.status).toBe('rejected')
    if (stale.status !== 'rejected') throw new Error('expected stale rejection')
    expect(stale.result).toMatchObject({
      reason: 'stale',
      baseRevision: parseSessionRevision(0),
      currentRevision: parseSessionRevision(1),
      currentState: {
        tokenId: 'token-pikachu',
        combatStages: requestedStages,
      },
    })
    expect(sheetIo.writes).toHaveLength(1)
    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(1))
  })

  it('rolls back the sheet and authoritative state if snapshot persistence fails', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const sheetIo = createSheetIo()

    expect(() => applyModifyCombatStagesCommandUseCase({ command: createCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: () => {
        throw new Error('disk full')
      },
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })).toThrow(ApplyModifyCombatStagesCommandUseCaseError)

    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(0))
    expect(store.get(sessionId)?.state).toEqual(initialState)
    expect(sheetIo.writes).toHaveLength(2)
    expect(sheetIo.currentSheet.stats?.atk?.stage).toBe(0)
    expect(sheetIo.currentSheet.stats?.def?.stage).toBe(0)
    expect(sheetIo.currentSheet.combatStages?.acc).toBe(0)
  })
})
