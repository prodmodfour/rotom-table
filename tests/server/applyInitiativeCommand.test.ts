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
})

const createState = (revision = 0): AuthoritativeSessionState<TabletopMapV2> => createAuthoritativeSessionState<TabletopMapV2>({
  sessionId,
  createdAt,
  updatedAt: createdAt,
  revision: parseSessionRevision(revision),
  selectedMapSlug: 'arena-map',
  maps: [
    createAuthoritativeSessionMapState<TabletopMapV2>({
      mapSlug: 'arena-map',
      revision: parseMapRevision(revision),
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
  payload: { mapSlug: 'arena-map' },
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
    expect(JSON.stringify(result.patchEvent.payload)).not.toContain('voxels')
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
