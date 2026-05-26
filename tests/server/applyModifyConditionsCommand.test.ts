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
  MODIFY_CONDITIONS_COMMAND_TYPE,
  createModifyConditionsSheetCommandScope,
  createModifyConditionsTokenCommandScope,
  type ModifyConditionsCommand,
} from '#shared/sessionTableActionCommands'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMapV2 } from '~/types/map'
import {
  ApplyModifyConditionsCommandUseCaseError,
  MODIFY_CONDITIONS_PATCH_EVENT_TYPE,
  applyModifyConditionsCommandUseCase,
  type ModifyConditionsSheetReader,
  type ModifyConditionsSheetWriter,
} from '~~/server/useCases/applyModifyConditionsCommand'
import { createInMemorySessionOperationTracker } from '~~/server/utils/sessionOperationTracker'
import {
  createPersistedSessionSnapshot,
  type WriteSessionSnapshotResult,
} from '~~/server/utils/sessionSnapshots'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'

const enabledEnv = { ROTOM_ENABLE_SESSION_HOST: '1' } as const
const sessionId = parseSessionId('session_modifyconduc1')
const joinCode = parseJoinCode('MCNABC')
const gmKey = parseGmKey('gmkey_modifyconditions000000001x')
const gmClientId = parseClientId('client_mcnucgm1')
const playerClientId = parseClientId('client_mcnucpl1')
const playerId = parsePlayerId('player_mcnuc001')
const displayName = sanitizeSessionDisplayName('Condition Player')
const createdAt = '2026-05-26T19:00:00.000Z'
const processedAt = '2026-05-26T19:00:05.000Z'

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

const createCommand = (overrides: Partial<ModifyConditionsCommand> = {}): ModifyConditionsCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: playerActor,
  type: MODIFY_CONDITIONS_COMMAND_TYPE,
  opId: parseOpId('op_modifyconduc01'),
  baseRevision: parseSessionRevision(0),
  scopes: [
    createModifyConditionsTokenCommandScope(tokenResource),
    createModifyConditionsSheetCommandScope(sheetResource),
  ],
  payload: {
    tokenId: 'token-pikachu',
    action: 'replace',
    conditions: ['Burned', 'Disabled: Thunderbolt'],
  },
  metadata: {
    traceId: 'trace-modify-conditions-use-case',
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
  const readSheet: ModifyConditionsSheetReader = (kind, slug) => {
    if (kind !== 'pokemon' || slug !== 'pikachu') return null
    return {
      path: '/tmp/pikachu.json',
      sheet: JSON.parse(JSON.stringify(currentSheet)) as CharacterSheet,
    }
  }
  const writeSheet: ModifyConditionsSheetWriter = (_path, sheet) => {
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

describe('applyModifyConditionsCommandUseCase', () => {
  it('replaces placed sheet conditions, increments session/map revisions, writes a snapshot, and returns a small patch', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const sheetIo = createSheetIo(createPokemonSheet({
      combat: { currentHp: 30, injuries: 0, conditions: ['Poisoned'] },
    }))

    const result = applyModifyConditionsCommandUseCase({ command: createCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('expected accepted modifyConditions')
    expect(result.session.revision).toBe(parseSessionRevision(1))
    expect(result.patchEvent).toMatchObject({
      eventType: MODIFY_CONDITIONS_PATCH_EVENT_TYPE,
      revision: parseSessionRevision(1),
      payload: {
        tokenId: 'token-pikachu',
        mapSlug: 'arena-map',
        sheetKind: 'pokemon',
        sheetSlug: 'pikachu',
        previous: ['Poisoned'],
        current: ['Burned', 'Disabled: Thunderbolt'],
      },
    })
    expect(result.result).toMatchObject({
      status: 'accepted',
      commandType: MODIFY_CONDITIONS_COMMAND_TYPE,
      currentRevision: parseSessionRevision(1),
      metadata: {
        serverProcessedAt: processedAt,
        traceId: 'trace-modify-conditions-use-case',
      },
    })
    expect(result.previousConditions.conditions).toEqual(['Poisoned'])
    expect(result.conditions.conditions).toEqual(['Burned', 'Disabled: Thunderbolt'])
    expect(sheetIo.writes).toHaveLength(1)
    expect(sheetIo.currentSheet.combat?.conditions).toEqual(['Burned', 'Disabled: Thunderbolt'])
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

  it('applies add and remove condition actions against the current authoritative sheet state', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const sheetIo = createSheetIo(createPokemonSheet({
      combat: { currentHp: 30, injuries: 0, conditions: ['Burned'] },
    }))

    const added = applyModifyConditionsCommandUseCase({
      command: createCommand({
        opId: parseOpId('op_modifyconduc02'),
        payload: { tokenId: 'token-pikachu', action: 'add', conditions: ['Poisoned'] },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter([]),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })

    expect(added.status).toBe('accepted')
    if (added.status !== 'accepted') throw new Error('expected add to be accepted')
    expect(added.conditions.conditions).toEqual(['Burned', 'Poisoned'])

    const removed = applyModifyConditionsCommandUseCase({
      command: createCommand({
        opId: parseOpId('op_modifyconduc03'),
        baseRevision: parseSessionRevision(1),
        payload: { tokenId: 'token-pikachu', action: 'remove', conditions: ['Burned'] },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => '2026-05-26T19:00:06.000Z',
      writeSnapshot: createSnapshotWriter([]),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })

    expect(removed.status).toBe('accepted')
    if (removed.status !== 'accepted') throw new Error('expected remove to be accepted')
    expect(removed.previousConditions.conditions).toEqual(['Burned', 'Poisoned'])
    expect(removed.conditions.conditions).toEqual(['Poisoned'])
    expect(sheetIo.currentSheet.combat?.conditions).toEqual(['Poisoned'])
    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(2))
  })

  it('rejects unauthorized player condition changes without reading sheets or writing snapshots', () => {
    const initialState = createState([])
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    let readCount = 0

    const result = applyModifyConditionsCommandUseCase({ command: createCommand() }, {
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

  it('rejects stale same-token condition changes with current authoritative condition state', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const sheetIo = createSheetIo()

    const first = applyModifyConditionsCommandUseCase({ command: createCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter([]),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })
    expect(first.status).toBe('accepted')

    const stale = applyModifyConditionsCommandUseCase({
      command: createCommand({
        opId: parseOpId('op_modifyconduc04'),
        baseRevision: parseSessionRevision(0),
        payload: { tokenId: 'token-pikachu', action: 'replace', conditions: ['Poisoned'] },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => '2026-05-26T19:00:07.000Z',
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
        conditions: ['Burned', 'Disabled: Thunderbolt'],
      },
    })
    expect(sheetIo.writes).toHaveLength(1)
    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(1))
  })

  it('rolls back the sheet and authoritative state if snapshot persistence fails', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const sheetIo = createSheetIo()

    expect(() => applyModifyConditionsCommandUseCase({ command: createCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: () => {
        throw new Error('disk full')
      },
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })).toThrow(ApplyModifyConditionsCommandUseCaseError)

    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(0))
    expect(store.get(sessionId)?.state).toEqual(initialState)
    expect(sheetIo.writes).toHaveLength(2)
    expect(sheetIo.currentSheet.combat?.conditions).toEqual([])
  })
})
