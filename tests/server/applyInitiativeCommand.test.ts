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
  NEXT_INITIATIVE_COMMAND_TYPE,
  PREVIOUS_INITIATIVE_COMMAND_TYPE,
  SET_INITIATIVE_COMMAND_TYPE,
  createInitiativeCommandScope,
  type InitiativeCommand,
  type NextInitiativeCommand,
  type SetInitiativeCommand,
} from '#shared/sessionInitiativeCommands'
import type { TabletopMapV2 } from '~/types/map'
import {
  ApplyInitiativeCommandUseCaseError,
  INITIATIVE_PATCH_EVENT_TYPE,
  applyInitiativeCommandUseCase,
} from '~~/server/useCases/applyInitiativeCommand'
import { createInMemorySessionOperationTracker } from '~~/server/utils/sessionOperationTracker'
import {
  createPersistedSessionSnapshot,
  type WriteSessionSnapshotResult,
} from '~~/server/utils/sessionSnapshots'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'

const enabledEnv = { ROTOM_ENABLE_SESSION_HOST: '1' } as const
const sessionId = parseSessionId('session_initiativeuc001')
const joinCode = parseJoinCode('ABC263')
const gmKey = parseGmKey('gmkey_initiativeusecase0000001')
const gmClientId = parseClientId('client_initucgm1')
const playerClientId = parseClientId('client_initucpl1')
const playerId = parsePlayerId('player_inituc0001')
const displayName = parseSessionDisplayName('Initiative Player')
const createdAt = '2026-05-26T18:00:00.000Z'
const processedAt = '2026-05-26T18:00:05.000Z'

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
      initiative: 20,
    },
    {
      id: 'token-bulbasaur',
      sheetKind: 'pokemon',
      sheetSlug: 'bulbasaur',
      position: { x: 2, y: 0, z: 1 },
      facing: 'south-east',
      initiative: 12,
    },
  ],
  lights: [],
  initiative: { activeId: 'token-pikachu', round: 1 },
  moveUsage: { byPlacementId: {} },
  metadata: {},
  createdAt: 1_000,
  updatedAt: 1_000,
  ...overrides,
})

const createThreeCombatantMap = (overrides: Partial<TabletopMapV2> = {}): TabletopMapV2 => createMap({
  placements: [
    { id: 'token-a', sheetKind: 'pokemon', sheetSlug: 'a', position: { x: 1, y: 0, z: 1 }, initiative: 30 },
    { id: 'token-b', sheetKind: 'pokemon', sheetSlug: 'b', position: { x: 2, y: 0, z: 1 }, initiative: 20 },
    { id: 'token-c', sheetKind: 'pokemon', sheetSlug: 'c', position: { x: 3, y: 0, z: 1 }, initiative: 10 },
  ],
  initiative: { activeId: 'token-c', round: 1, manualOrderIds: ['token-c', 'token-a', 'token-b'] },
  ...overrides,
})

const createState = (
  revision = 0,
  document: TabletopMapV2 = createMap(),
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
      document,
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
      controllableResources: [
        {
          kind: 'token',
          tokenId: 'token-pikachu',
          mapSlug: 'arena-map',
          sheetKind: 'pokemon',
          sheetSlug: 'pikachu',
        },
      ],
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
  overrides: Partial<SetInitiativeCommand> = {},
): SetInitiativeCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: gmActor,
  type: SET_INITIATIVE_COMMAND_TYPE,
  opId: parseOpId('op_setinituc001'),
  baseRevision: parseSessionRevision(0),
  scopes: [createInitiativeCommandScope('arena-map')],
  payload: {
    mapSlug: 'arena-map',
    tokenId: 'token-bulbasaur',
    initiative: 22,
    activeId: 'token-bulbasaur',
    round: 2,
  },
  metadata: {
    traceId: 'trace-init-use-case',
  },
  ...overrides,
})

const createNextCommand = (
  overrides: Partial<NextInitiativeCommand> = {},
): NextInitiativeCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: gmActor,
  type: NEXT_INITIATIVE_COMMAND_TYPE,
  opId: parseOpId('op_nextinituc001'),
  baseRevision: parseSessionRevision(0),
  scopes: [createInitiativeCommandScope('arena-map')],
  payload: {
    mapSlug: 'arena-map',
    orderIds: ['token-pikachu', 'token-bulbasaur'],
    activeId: 'token-pikachu',
    round: 1,
  },
  ...overrides,
})

const pokemonInitiativeSheet = (
  slug: string,
  speed: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  slug,
  nickname: slug,
  species: '',
  level: 1,
  stats: { spd: { base: speed } },
  combat: { conditions: [] },
  ...overrides,
})

const readInitiativeSheet = (_kind: 'pokemon' | 'trainer', slug: string) => ({
  path: `/tmp/${slug}.json`,
  sheet: slug === 'bulbasaur'
    ? { slug, nickname: 'Bulby', species: 'Bulbasaur' }
    : { slug, species: 'Pikachu' },
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

describe('applyInitiativeCommandUseCase', () => {
  it('applies setInitiative, increments revisions, writes a snapshot, and returns a small initiative patch', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const result = applyInitiativeCommandUseCase({ command: createSetCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      readSheet: readInitiativeSheet,
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('expected accepted setInitiative')
    expect(result.session.revision).toBe(parseSessionRevision(1))
    expect(result.patchEvent).toMatchObject({
      eventType: INITIATIVE_PATCH_EVENT_TYPE,
      commandType: SET_INITIATIVE_COMMAND_TYPE,
      revision: parseSessionRevision(1),
      payload: {
        mapSlug: 'arena-map',
        command: SET_INITIATIVE_COMMAND_TYPE,
        previous: {
          activeId: 'token-pikachu',
          round: 1,
          entries: [
            { tokenId: 'token-pikachu', initiative: 20 },
            { tokenId: 'token-bulbasaur', initiative: 12 },
          ],
        },
        current: {
          activeId: 'token-bulbasaur',
          round: 2,
          entries: [
            { tokenId: 'token-pikachu', initiative: 20 },
            { tokenId: 'token-bulbasaur', initiative: 22 },
          ],
        },
        changedTokenIds: ['token-bulbasaur'],
      },
    })
    expect(result.result).toMatchObject({
      status: 'accepted',
      accepted: true,
      commandType: SET_INITIATIVE_COMMAND_TYPE,
      currentRevision: parseSessionRevision(1),
      metadata: {
        serverProcessedAt: processedAt,
        traceId: 'trace-init-use-case',
      },
    })
    expect(result.previousInitiative.initiative.activeId).toBe('token-pikachu')
    expect(result.initiative.initiative).toMatchObject({ activeId: 'token-bulbasaur', round: 2 })
    expect(snapshotCalls).toHaveLength(1)
    expect(snapshotCalls[0]?.revision).toBe(parseSessionRevision(1))
    expect(result.snapshot).toEqual({ writtenAt: processedAt, revision: parseSessionRevision(1) })
    expect(tracker.recordCount).toBe(1)

    const storedMap = getSessionMapState(store.get(sessionId)!.state!, 'arena-map')
    expect(storedMap?.revision).toBe(parseMapRevision(1))
    expect(storedMap?.document.initiative).toEqual({ activeId: 'token-bulbasaur', round: 2 })
    expect(storedMap?.document.placements.find((placement) => placement.id === 'token-bulbasaur')?.initiative)
      .toBe(22)
    expect(storedMap?.document.metadata?.initiativeLog).toEqual([
      {
        at: Date.parse(processedAt),
        userId: 'token-bulbasaur',
        userName: 'Bulby',
        actionName: 'Initiative',
        lines: ['Bulby has gained initiative!'],
      },
    ])
    expect(result.patchEvent.payload.logEntry).toEqual({
      at: Date.parse(processedAt),
      userId: 'token-bulbasaur',
      userName: 'Bulby',
      actionName: 'Initiative',
      lines: ['Bulby has gained initiative!'],
    })
    expect(JSON.stringify(result.patchEvent.payload)).not.toContain('voxels')
  })

  it('persists manual initiative order through setInitiative and includes it in patches', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const manualOrderIds = ['token-bulbasaur', 'token-pikachu']

    const result = applyInitiativeCommandUseCase({
      command: createSetCommand({
        opId: parseOpId('op_manualorduc1'),
        payload: {
          mapSlug: 'arena-map',
          manualOrderIds,
        },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('expected manual order accepted')
    expect(result.initiative.initiative).toEqual({
      activeId: 'token-pikachu',
      round: 1,
      entries: [
        { tokenId: 'token-pikachu', initiative: 20 },
        { tokenId: 'token-bulbasaur', initiative: 12 },
      ],
      manualOrderIds,
    })
    expect(result.patchEvent.payload).toMatchObject({
      command: SET_INITIATIVE_COMMAND_TYPE,
      previous: expect.not.objectContaining({ manualOrderIds: expect.anything() }),
      current: expect.objectContaining({ manualOrderIds }),
      changedTokenIds: [],
    })
    expect(getSessionMapState(store.get(sessionId)!.state!, 'arena-map')?.document.initiative)
      .toEqual({ activeId: 'token-pikachu', round: 1, manualOrderIds })
  })

  it('advances and reverses initiative using the authoritative placement order and round rules', () => {
    const store = createStoreWithState(createState())
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const next = applyInitiativeCommandUseCase({ command: createNextCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(next.status).toBe('accepted')
    if (next.status !== 'accepted') throw new Error('expected next accepted')
    expect(next.initiative.initiative).toMatchObject({ activeId: 'token-bulbasaur', round: 1 })

    const previousCommand = {
      ...createNextCommand(),
      type: PREVIOUS_INITIATIVE_COMMAND_TYPE,
      opId: parseOpId('op_previnituc001'),
      baseRevision: parseSessionRevision(1),
      payload: {
        mapSlug: 'arena-map',
        orderIds: ['token-pikachu', 'token-bulbasaur'],
        activeId: 'token-bulbasaur',
        round: 1,
      },
    } as InitiativeCommand
    const previous = applyInitiativeCommandUseCase({
      command: previousCommand,
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => '2026-05-26T18:00:06.000Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(previous.status).toBe('accepted')
    if (previous.status !== 'accepted') throw new Error('expected previous accepted')
    expect(previous.initiative.initiative).toMatchObject({ activeId: 'token-pikachu', round: 1 })
    expect(snapshotCalls).toHaveLength(2)
  })

  it('advances next and previous initiative according to manual order', () => {
    const manualOrderIds = ['token-c', 'token-a', 'token-b']
    const store = createStoreWithState(createState(0, createThreeCombatantMap({
      initiative: { activeId: 'token-c', round: 2, manualOrderIds },
    })))
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const next = applyInitiativeCommandUseCase({
      command: createNextCommand({
        opId: parseOpId('op_nextmanualuc'),
        payload: { mapSlug: 'arena-map', orderIds: manualOrderIds, activeId: 'token-c', round: 2 },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(next.status).toBe('accepted')
    if (next.status !== 'accepted') throw new Error('expected manual next accepted')
    expect(next.initiative.initiative).toMatchObject({ activeId: 'token-a', round: 2, manualOrderIds })
    expect(getSessionMapState(store.get(sessionId)!.state!, 'arena-map')?.document.initiative)
      .toEqual({ activeId: 'token-a', round: 2, manualOrderIds })

    const previous = applyInitiativeCommandUseCase({
      command: {
        ...createNextCommand(),
        type: PREVIOUS_INITIATIVE_COMMAND_TYPE,
        opId: parseOpId('op_prevmanualuc'),
        baseRevision: parseSessionRevision(1),
        payload: { mapSlug: 'arena-map', orderIds: manualOrderIds, activeId: 'token-a', round: 2 },
      } as InitiativeCommand,
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => '2026-05-26T18:00:06.000Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(previous.status).toBe('accepted')
    if (previous.status !== 'accepted') throw new Error('expected manual previous accepted')
    expect(previous.initiative.initiative).toMatchObject({ activeId: 'token-c', round: 2, manualOrderIds })
    expect(snapshotCalls).toHaveLength(2)
  })

  it('clears manual initiative order and returns advancement to calculated order', () => {
    const manualOrderIds = ['token-c', 'token-a', 'token-b']
    const store = createStoreWithState(createState(0, createThreeCombatantMap({
      initiative: { activeId: 'token-c', round: 1, manualOrderIds },
    })))
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const clear = applyInitiativeCommandUseCase({
      command: createSetCommand({
        opId: parseOpId('op_clearmanuc1'),
        payload: { mapSlug: 'arena-map', manualOrderIds: null },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(clear.status).toBe('accepted')
    if (clear.status !== 'accepted') throw new Error('expected manual clear accepted')
    expect(clear.patchEvent.payload).toMatchObject({
      command: SET_INITIATIVE_COMMAND_TYPE,
      previous: expect.objectContaining({ manualOrderIds }),
      current: expect.not.objectContaining({ manualOrderIds: expect.anything() }),
    })
    expect(getSessionMapState(store.get(sessionId)!.state!, 'arena-map')?.document.initiative)
      .toEqual({ activeId: 'token-c', round: 1 })

    const next = applyInitiativeCommandUseCase({
      command: createNextCommand({
        opId: parseOpId('op_nextcalcuc2'),
        baseRevision: parseSessionRevision(1),
        payload: { mapSlug: 'arena-map', orderIds: ['token-a', 'token-b', 'token-c'], activeId: 'token-c', round: 1 },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => '2026-05-26T18:00:06.000Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(next.status).toBe('accepted')
    if (next.status !== 'accepted') throw new Error('expected calculated next accepted')
    expect(next.initiative.initiative).toMatchObject({ activeId: 'token-a', round: 2 })
    expect(next.initiative.initiative.manualOrderIds).toBeUndefined()
  })

  it('rejects manual initiative orders that do not match map placements', () => {
    const store = createStoreWithState(createState(0, createThreeCombatantMap({
      initiative: { activeId: null, round: 1 },
    })))
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const partial = applyInitiativeCommandUseCase({
      command: createSetCommand({
        opId: parseOpId('op_badmanualuc1'),
        payload: { mapSlug: 'arena-map', manualOrderIds: ['token-c', 'token-a'] },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(partial.status).toBe('rejected')
    if (partial.status !== 'rejected') throw new Error('expected partial manual order rejection')
    expect(partial.result).toMatchObject({ reason: 'conflict', currentRevision: parseSessionRevision(0) })

    const unknown = applyInitiativeCommandUseCase({
      command: createSetCommand({
        opId: parseOpId('op_badmanualuc2'),
        payload: { mapSlug: 'arena-map', manualOrderIds: ['token-c', 'token-a', 'missing-token'] },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => '2026-05-26T18:00:06.000Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(unknown.status).toBe('rejected')
    if (unknown.status !== 'rejected') throw new Error('expected unknown manual order rejection')
    expect(unknown.result).toMatchObject({ reason: 'conflict', currentRevision: parseSessionRevision(0) })
    expect(getSessionMapState(store.get(sessionId)!.state!, 'arena-map')?.document.initiative)
      .toEqual({ activeId: null, round: 1 })
    expect(snapshotCalls).toEqual([])
  })

  it('rejects session-hosted advance commands when manual visible order precondition is stale', () => {
    const manualOrderIds = ['token-c', 'token-a', 'token-b']
    const store = createStoreWithState(createState(0, createThreeCombatantMap({
      initiative: { activeId: 'token-c', round: 1, manualOrderIds },
    })))
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const stale = applyInitiativeCommandUseCase({
      command: createNextCommand({
        opId: parseOpId('op_stalemanuc1'),
        payload: {
          mapSlug: 'arena-map',
          orderIds: ['token-a', 'token-b', 'token-c'],
          activeId: 'token-c',
          round: 1,
        },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(stale.status).toBe('rejected')
    if (stale.status !== 'rejected') throw new Error('expected stale manual order rejection')
    expect(stale.result).toMatchObject({
      reason: 'stale',
      currentRevision: parseSessionRevision(0),
      currentState: {
        mapSlug: 'arena-map',
        initiative: expect.objectContaining({ activeId: 'token-c', round: 1, manualOrderIds }),
      },
    })
    expect(getSessionMapState(store.get(sessionId)!.state!, 'arena-map')?.document.initiative)
      .toEqual({ activeId: 'token-c', round: 1, manualOrderIds })
    expect(snapshotCalls).toEqual([])
  })

  it('rejects session-hosted advance commands when their visible order precondition is stale', () => {
    const document = createMap({
      placements: [
        { id: 'token-a', sheetKind: 'pokemon', sheetSlug: 'a', position: { x: 1, y: 0, z: 1 }, facing: 'south-east' },
        { id: 'token-b', sheetKind: 'pokemon', sheetSlug: 'b', position: { x: 2, y: 0, z: 1 }, facing: 'south-east' },
        { id: 'token-c', sheetKind: 'pokemon', sheetSlug: 'c', position: { x: 3, y: 0, z: 1 }, facing: 'south-east' },
      ],
      initiative: { activeId: 'token-a', round: 1 },
    })
    const store = createStoreWithState(createState(0, document))
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const readSheet = (_kind: 'pokemon' | 'trainer', slug: string) => ({
      path: `/tmp/${slug}.json`,
      sheet: pokemonInitiativeSheet(slug, slug === 'a' ? 30 : slug === 'c' ? 20 : 10),
    })

    const stale = applyInitiativeCommandUseCase({
      command: createNextCommand({
        opId: parseOpId('op_staleorduc1'),
        payload: {
          mapSlug: 'arena-map',
          orderIds: ['token-a', 'token-b', 'token-c'],
          activeId: 'token-a',
          round: 1,
        },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      readSheet,
    })

    expect(stale.status).toBe('rejected')
    if (stale.status !== 'rejected') throw new Error('expected stale rejection')
    expect(stale.result).toMatchObject({
      reason: 'stale',
      currentRevision: parseSessionRevision(0),
      currentState: {
        mapSlug: 'arena-map',
        initiative: { activeId: 'token-a', round: 1 },
      },
    })
    expect(getSessionMapState(store.get(sessionId)!.state!, 'arena-map')?.document.initiative)
      .toEqual({ activeId: 'token-a', round: 1 })
    expect(snapshotCalls).toEqual([])
  })

  it('uses condition-adjusted Speed-derived effective order for session-hosted next and previous initiative', () => {
    const document = createMap({
      placements: [
        {
          id: 'token-alpha',
          sheetKind: 'pokemon',
          sheetSlug: 'alpha',
          position: { x: 1, y: 0, z: 1 },
          facing: 'south-east',
        },
        {
          id: 'token-bravo',
          sheetKind: 'pokemon',
          sheetSlug: 'bravo',
          position: { x: 2, y: 0, z: 1 },
          facing: 'south-east',
        },
        {
          id: 'token-zulu',
          sheetKind: 'pokemon',
          sheetSlug: 'zulu',
          position: { x: 3, y: 0, z: 1 },
          facing: 'south-east',
        },
      ],
      initiative: { activeId: 'token-alpha', round: 1 },
    })
    const store = createStoreWithState(createState(0, document))
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const readSheet = (_kind: 'pokemon' | 'trainer', slug: string) => ({
      path: `/tmp/${slug}.json`,
      sheet: slug === 'alpha'
        ? pokemonInitiativeSheet(slug, 30, { combat: { conditions: ['Paralysis'] } })
        : pokemonInitiativeSheet(slug, slug === 'bravo' ? 20 : 10),
    })

    const next = applyInitiativeCommandUseCase({
      command: createNextCommand({
        payload: {
          mapSlug: 'arena-map',
          orderIds: ['token-bravo', 'token-alpha', 'token-zulu'],
          activeId: 'token-alpha',
          round: 1,
        },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      readSheet,
    })

    expect(next.status).toBe('accepted')
    if (next.status !== 'accepted') throw new Error('expected next accepted')
    expect(next.initiative.initiative).toMatchObject({ activeId: 'token-zulu', round: 1 })

    const previousCommand = {
      ...createNextCommand(),
      type: PREVIOUS_INITIATIVE_COMMAND_TYPE,
      opId: parseOpId('op_effprevinit'),
      baseRevision: parseSessionRevision(1),
      payload: {
        mapSlug: 'arena-map',
        orderIds: ['token-bravo', 'token-alpha', 'token-zulu'],
        activeId: 'token-zulu',
        round: 1,
      },
    } as InitiativeCommand
    const previous = applyInitiativeCommandUseCase({ command: previousCommand }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => '2026-05-26T18:00:06.000Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      readSheet,
    })

    expect(previous.status).toBe('accepted')
    if (previous.status !== 'accepted') throw new Error('expected previous accepted')
    expect(previous.initiative.initiative).toMatchObject({ activeId: 'token-alpha', round: 1 })
    expect(snapshotCalls).toHaveLength(2)
  })

  it('rejects player initiative commands without mutating authoritative state', () => {
    const store = createStoreWithState(createState())
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const result = applyInitiativeCommandUseCase({
      command: createSetCommand({ actor: playerActor }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(result.status).toBe('rejected')
    if (result.status !== 'rejected') throw new Error('expected player rejection')
    expect(result.result).toMatchObject({
      status: 'rejected',
      reason: 'unauthorized',
      commandType: SET_INITIATIVE_COMMAND_TYPE,
      currentRevision: parseSessionRevision(0),
      permission: { reason: 'gm-required' },
    })
    expect(snapshotCalls).toEqual([])
    expect(store.get(sessionId)?.state?.revision).toBe(parseSessionRevision(0))
  })

  it('rejects stale initiative changes when the initiative lane changed after the command base revision', () => {
    const store = createStoreWithState(createState())
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const accepted = applyInitiativeCommandUseCase({ command: createNextCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(accepted.status).toBe('accepted')

    const stale = applyInitiativeCommandUseCase({
      command: createSetCommand({
        opId: parseOpId('op_staleinituc1'),
        baseRevision: parseSessionRevision(0),
        payload: {
          mapSlug: 'arena-map',
          tokenId: 'token-bulbasaur',
          initiative: 30,
        },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => '2026-05-26T18:00:07.000Z',
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
        initiative: { activeId: 'token-bulbasaur', round: 1 },
      },
    })
    expect(snapshotCalls).toHaveLength(1)
  })

  it('returns idempotent duplicate results and rolls back store state if snapshot writing fails', () => {
    const store = createStoreWithState(createState())
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const command = createSetCommand({ opId: parseOpId('op_dupeinituc1') })

    const first = applyInitiativeCommandUseCase({ command }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(first.status).toBe('accepted')

    const duplicate = applyInitiativeCommandUseCase({ command }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => '2026-05-26T18:00:08.000Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(duplicate.status).toBe('duplicate')
    if (duplicate.status !== 'duplicate') throw new Error('expected duplicate')
    expect(duplicate.result).toMatchObject({
      status: 'duplicate',
      commandType: SET_INITIATIVE_COMMAND_TYPE,
      currentRevision: parseSessionRevision(1),
      original: { status: 'accepted', revision: parseSessionRevision(1) },
    })
    expect(snapshotCalls).toHaveLength(1)

    expect(() => applyInitiativeCommandUseCase({
      command: createSetCommand({
        opId: parseOpId('op_failinituc1'),
        baseRevision: parseSessionRevision(1),
        payload: { mapSlug: 'arena-map', activeId: null },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => '2026-05-26T18:00:09.000Z',
      writeSnapshot: () => {
        throw new Error('disk full')
      },
    })).toThrow(ApplyInitiativeCommandUseCaseError)

    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(1))
    expect(getSessionMapState(store.get(sessionId)!.state!, 'arena-map')?.document.initiative)
      .toEqual({ activeId: 'token-bulbasaur', round: 2 })
  })
})
