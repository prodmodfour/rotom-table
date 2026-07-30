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
  MODIFY_HP_COMMAND_TYPE,
  createModifyHpSheetCommandScope,
  createModifyHpTokenCommandScope,
  type ModifyHpCommand,
} from '#shared/sessionTableActionCommands'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMapV2 } from '~/types/map'
import {
  ApplyModifyHpCommandUseCaseError,
  MODIFY_HP_PATCH_EVENT_TYPE,
  applyModifyHpCommandUseCase,
  type ModifyHpSheetReader,
  type ModifyHpSheetWriter,
} from '~~/server/useCases/applyModifyHpCommand'
import { createInMemorySessionOperationTracker } from '~~/server/utils/sessionOperationTracker'
import {
  createPersistedSessionSnapshot,
  type WriteSessionSnapshotResult,
} from '~~/server/utils/sessionSnapshots'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'

const enabledEnv = { ROTOM_ENABLE_SESSION_HOST: '1' } as const
const sessionId = parseSessionId('session_modifyhpuc001')
const joinCode = parseJoinCode('MHPABC')
const gmKey = parseGmKey('gmkey_modifyhpusecase000000001x')
const gmClientId = parseClientId('client_mhpucgm1')
const playerClientId = parseClientId('client_mhpucpl1')
const playerId = parsePlayerId('player_mhpuc001')
const displayName = sanitizeSessionDisplayName('HP Player')
const createdAt = '2026-05-26T16:00:00.000Z'
const processedAt = '2026-05-26T16:00:05.000Z'

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
  map: TabletopMapV2 = createMap(),
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

const createPokemonSheet = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'pikachu',
  nickname: 'Pikachu',
  species: '',
  level: 20,
  stats: { hp: { added: 5 } },
  combat: { currentHp: 30, injuries: 0, conditions: [] },
  player: true,
  ...overrides,
})

const createCommand = (overrides: Partial<ModifyHpCommand> = {}): ModifyHpCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: playerActor,
  type: MODIFY_HP_COMMAND_TYPE,
  opId: parseOpId('op_modifyhpuc001'),
  baseRevision: parseSessionRevision(0),
  scopes: [
    createModifyHpTokenCommandScope(tokenResource),
    createModifyHpSheetCommandScope(sheetResource),
  ],
  payload: {
    tokenId: 'token-pikachu',
    currentHp: 12,
    injuries: 2,
  },
  metadata: {
    traceId: 'trace-modify-hp-use-case',
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
  const readSheet: ModifyHpSheetReader = (kind, slug) => {
    if (kind !== 'pokemon' || slug !== 'pikachu') return null
    return {
      path: '/tmp/pikachu.json',
      sheet: JSON.parse(JSON.stringify(currentSheet)) as CharacterSheet,
    }
  }
  const writeSheet: ModifyHpSheetWriter = (_path, sheet) => {
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

describe('applyModifyHpCommandUseCase', () => {
  it('updates the placed sheet HP, increments session/map revisions, writes a snapshot, and returns a small patch', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const sheetIo = createSheetIo()

    const result = applyModifyHpCommandUseCase({ command: createCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('expected accepted modifyHp')
    expect(result.session.revision).toBe(parseSessionRevision(1))
    expect(result.patchEvent).toMatchObject({
      eventType: MODIFY_HP_PATCH_EVENT_TYPE,
      revision: parseSessionRevision(1),
      payload: {
        tokenId: 'token-pikachu',
        mapSlug: 'arena-map',
        sheetKind: 'pokemon',
        sheetSlug: 'pikachu',
        previous: { currentHp: 30, injuries: 0 },
        current: { currentHp: 12, injuries: 2 },
      },
    })
    expect(result.result).toMatchObject({
      status: 'accepted',
      commandType: MODIFY_HP_COMMAND_TYPE,
      currentRevision: parseSessionRevision(1),
      metadata: {
        serverProcessedAt: processedAt,
        traceId: 'trace-modify-hp-use-case',
      },
    })
    expect(result.previousHp.hp).toMatchObject({ currentHp: 30, injuries: 0 })
    expect(result.hp.hp).toMatchObject({ currentHp: 12, injuries: 2 })
    expect(sheetIo.writes).toHaveLength(1)
    expect(sheetIo.currentSheet.combat).toMatchObject({ currentHp: 12, injuries: 2 })
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

  it('enforces effective Soulless HP and Injury authority', () => {
    const store = createStoreWithState(createState())
    const sheetIo = createSheetIo(createPokemonSheet({
      capabilities: { other: ['Soulless'] },
      combat: { currentHp: 8, injuries: 3, conditions: [] },
    }))

    const result = applyModifyHpCommandUseCase({ command: createCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter([]),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('expected accepted modifyHp')
    expect(result.hp.hp).toMatchObject({ currentHp: 1, injuries: 0 })
    expect(sheetIo.currentSheet.combat).toMatchObject({ currentHp: 1, injuries: 0 })
  })

  it('uses ordinary HP rules while Soulless is suppressed', () => {
    const encounter = createEmptyEncounterState()
    const suppression = parseEncounterEffect({
      id: 'suppress-soulless',
      kind: 'capability',
      source: { operationId: 'suppress-operation', moveId: 'test.suppression', placementId: 'token-pikachu' },
      affected: { placementIds: ['token-pikachu'], sideIds: [], cells: [] },
      createdRound: 1,
      createdTurn: 0,
      duration: { kind: 'scene', remaining: null },
      stacks: 1,
      charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['capability-suppression'],
      payload: { capabilityId: 'soulless', action: 'suppress' },
      dispel: { policy: 'none', tags: [] },
      transferPolicy: 'expire',
      suppression: { sources: [] },
    })
    const map = { ...createMap(), encounterState: { ...encounter, effects: [suppression] } }
    const store = createStoreWithState(createState([assignment], map))
    const sheetIo = createSheetIo(createPokemonSheet({ capabilities: { other: ['Soulless'] } }))

    const result = applyModifyHpCommandUseCase({ command: createCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter([]),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })

    expect(result.status).toBe('accepted')
    expect(sheetIo.currentSheet.combat).toMatchObject({ currentHp: 12, injuries: 2 })
  })

  it('fails closed instead of applying a non-atomic As One HP change', () => {
    const encounter = createEmptyEncounterState()
    const baseMap = createMap()
    const map: TabletopMapV2 = {
      ...baseMap,
      placements: [
        ...baseMap.placements,
        {
          ...baseMap.placements[0]!,
          id: 'token-pikachu-alias',
          position: { x: 2, y: 0, z: 1 },
        },
      ],
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          links: [{
            id: 'as-one-link',
            kind: 'as-one-mount',
            ownerPlacementId: 'token-pikachu-alias',
            participantPlacementIds: ['token-mount'],
            capabilityInstanceId: 'capability-instance',
            canonicalId: 'As One',
            establishedAt: 1,
            configurationId: null,
            sourceOperationId: 'as-one-operation',
          }],
        },
      },
    }
    const store = createStoreWithState(createState([assignment], map))
    const sheetIo = createSheetIo()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const result = applyModifyHpCommandUseCase({ command: createCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })

    expect(result.status).toBe('rejected')
    if (result.status !== 'rejected') throw new Error('expected As One rejection')
    expect(result.result).toMatchObject({ reason: 'conflict', retryable: false })
    expect(result.result.message).toContain('cannot atomically reconcile As One')
    expect(sheetIo.writes).toHaveLength(0)
    expect(snapshotCalls).toHaveLength(0)
  })

  it('fails closed instead of fainting a Crowned Forme without ending its mode', () => {
    const encounter = createEmptyEncounterState()
    const map: TabletopMapV2 = {
      ...createMap(),
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          modes: [{
            id: 'crowned-mode',
            actorPlacementId: 'token-pikachu',
            capabilityInstanceId: 'weapon-bond-instance',
            canonicalId: 'Weapon Bond',
            mode: 'crowned',
            description: null,
            configurationId: null,
            activatedAt: 1,
            expiresAt: null,
            sourceOperationId: 'crowned-operation',
          }],
        },
      },
    }
    const store = createStoreWithState(createState([assignment], map))
    const sheetIo = createSheetIo()

    const result = applyModifyHpCommandUseCase({
      command: createCommand({ payload: { tokenId: 'token-pikachu', currentHp: 0 } }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter([]),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })

    expect(result.status).toBe('rejected')
    if (result.status !== 'rejected') throw new Error('expected Crowned rejection')
    expect(result.result.message).toContain('cannot atomically terminate Crowned Forme')
    expect(sheetIo.writes).toHaveLength(0)
  })

  it('fails closed instead of fainting a Physical Power carrier without detaching its load', () => {
    const map: TabletopMapV2 = {
      ...createMap(),
      metadata: {
        capabilityObjects: [{
          id: 'crate', pounds: 20, position: { x: 1, y: 0, z: 1 },
          attachedToPlacementId: 'token-pikachu',
          attachedCapabilityInstanceId: 'capability:token-pikachu:Power:value-4',
          attachedCapabilityCanonicalId: 'Power', attachmentKind: 'physical-power-load',
          physicalLoadOperationId: 'operation:load', physicalLoadLastMovedRound: null,
          physicalLoadLastCheckRound: null,
        }],
      },
    }
    const store = createStoreWithState(createState([assignment], map))
    const sheetIo = createSheetIo()
    const result = applyModifyHpCommandUseCase({
      command: createCommand({ payload: { tokenId: 'token-pikachu', currentHp: 0 } }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter([]),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })

    expect(result.status).toBe('rejected')
    if (result.status !== 'rejected') throw new Error('expected Physical Power rejection')
    expect(result.result.message).toContain('cannot atomically detach Physical Power loads')
    expect(sheetIo.writes).toHaveLength(0)
  })

  it('rejects unauthorized player HP changes without reading sheets or writing snapshots', () => {
    const initialState = createState([])
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    let readCount = 0

    const result = applyModifyHpCommandUseCase({ command: createCommand() }, {
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

  it('rejects stale same-token HP changes with current authoritative HP state', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const sheetIo = createSheetIo()

    const first = applyModifyHpCommandUseCase({ command: createCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter([]),
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })
    expect(first.status).toBe('accepted')

    const stale = applyModifyHpCommandUseCase({
      command: createCommand({
        opId: parseOpId('op_modifyhpuc002'),
        baseRevision: parseSessionRevision(0),
        payload: { tokenId: 'token-pikachu', currentHp: 10 },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => '2026-05-26T16:00:06.000Z',
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
        hp: { currentHp: 12, injuries: 2 },
      },
    })
    expect(sheetIo.writes).toHaveLength(1)
    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(1))
  })

  it('rolls back the sheet and authoritative state if snapshot persistence fails', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const sheetIo = createSheetIo()

    expect(() => applyModifyHpCommandUseCase({ command: createCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: () => {
        throw new Error('disk full')
      },
      readSheet: sheetIo.readSheet,
      writeSheet: sheetIo.writeSheet,
    })).toThrow(ApplyModifyHpCommandUseCaseError)

    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(0))
    expect(store.get(sessionId)?.state).toEqual(initialState)
    expect(sheetIo.writes).toHaveLength(2)
    expect(sheetIo.currentSheet.combat).toMatchObject({ currentHp: 30, injuries: 0 })
  })
})
