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
import type { GmSessionActor, PlayerSessionActor, SessionTokenResourceRef } from '#shared/sessionPermissions'
import { parseMapRevision, parseSessionRevision } from '#shared/sessionRevisions'
import {
  createAuthoritativeSessionMapState,
  createAuthoritativeSessionState,
  getSessionMapState,
  type AuthoritativeSessionState,
} from '#shared/sessionState'
import {
  SEND_OUT_POKEMON_COMMAND_TYPE,
  createSendOutPokemonSpawnCommandScope,
  createSendOutPokemonTrainerCommandScope,
  type SendOutPokemonCommand,
} from '#shared/sessionTokenCommands'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMapV2 } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  SEND_OUT_POKEMON_PATCH_EVENT_TYPE,
  applySendOutPokemonCommandUseCase,
  type SendOutPokemonFootprintResolver,
} from '~~/server/useCases/applySendOutPokemonCommand'
import {
  createPersistedSessionSnapshot,
  type WriteSessionSnapshotResult,
} from '~~/server/utils/sessionSnapshots'
import { createInMemorySessionOperationTracker } from '~~/server/utils/sessionOperationTracker'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'

const enabledEnv = { ROTOM_ENABLE_SESSION_HOST: '1' } as const
const sessionId = parseSessionId('session_sendoutuc001')
const joinCode = parseJoinCode('SND234')
const gmKey = parseGmKey('gmkey_sendoutpokemon000000000001')
const gmClientId = parseClientId('client_sendoutgm')
const playerClientId = parseClientId('client_sendoutpl')
const playerId = parsePlayerId('player_sendout01')
const displayName = sanitizeSessionDisplayName('Ash')
const createdAt = '2026-05-26T12:30:00.000Z'
const processedAt = '2026-05-26T12:30:05.000Z'

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

const trainerResource = {
  kind: 'token',
  tokenId: 'token-ash',
  mapSlug: 'arena-map',
  sheetKind: 'trainer',
  sheetSlug: 'ash',
} as const satisfies SessionTokenResourceRef

const pokemonResource = {
  kind: 'token',
  tokenId: 'token-pikachu-1',
  mapSlug: 'arena-map',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
} as const satisfies SessionTokenResourceRef

const trainerSheet: TrainerSheet = {
  slug: 'ash',
  name: 'Ash',
  level: 5,
  currentTeam: ['pikachu', 'bulbasaur'],
}

const pokemonSheet: CharacterSheet = {
  slug: 'pikachu',
  nickname: 'Pikachu',
  species: 'Pikachu',
  level: 5,
}

const createMap = (overrides: Partial<TabletopMapV2> = {}): TabletopMapV2 => ({
  schemaVersion: 2,
  slug: 'arena-map',
  name: 'Arena Map',
  dimensions: { x: 12, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    {
      id: 'token-ash',
      sheetKind: 'trainer',
      sheetSlug: 'ash',
      position: { x: 1, y: 0, z: 1 },
      sideId: 'heroes',
      facing: 'south-east',
    },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  moveUsage: { byPlacementId: {} },
  encounterState: {
    schemaVersion: 1,
    sides: { heroes: { id: 'heroes', label: 'Heroes', status: 'active' } },
    effects: [],
    counters: {},
    history: {},
    turnResources: {},
    zones: [],
    pendingResolutionSummaries: [],
  },
  metadata: {},
  createdAt: 1_000,
  updatedAt: 1_000,
  ...overrides,
})

const createState = (map: TabletopMapV2 = createMap()): AuthoritativeSessionState<TabletopMapV2> =>
  createAuthoritativeSessionState<TabletopMapV2>({
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
    assignments: [
      {
        playerId,
        displayName,
        controllableResources: [{ kind: 'token', tokenId: 'token-ash' }],
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

const createCommand = (
  overrides: Partial<SendOutPokemonCommand> = {},
): SendOutPokemonCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: playerActor,
  type: SEND_OUT_POKEMON_COMMAND_TYPE,
  opId: parseOpId('op_sendoutpoke1'),
  baseRevision: parseSessionRevision(0),
  scopes: [
    createSendOutPokemonTrainerCommandScope(trainerResource),
    createSendOutPokemonSpawnCommandScope(pokemonResource),
  ],
  payload: {
    trainerTokenId: 'token-ash',
    pokemonSlug: 'pikachu',
    tokenId: 'token-pikachu-1',
    position: { x: 3, y: 0, z: 1 },
    facing: 'north-east',
  },
  metadata: {
    clientIssuedAt: '2026-05-26T12:30:04.500Z',
    traceId: 'trace-send-out-pokemon-use-case',
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

const resolveSheets = () => ({ trainerSheet, pokemonSheet })

const resolveFootprint: SendOutPokemonFootprintResolver = ({ placement }) => ({
  id: placement.id,
  base: 1,
  clearance: 1,
})

describe('applySendOutPokemonCommandUseCase', () => {
  it('applies an assigned player sendOutPokemon command, increments revisions, and writes a small patch', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const command = createCommand()

    const result = applySendOutPokemonCommandUseCase({ command }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      resolveSheets,
      resolveFootprint,
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('expected accepted sendOutPokemon')
    expect(result.result).toMatchObject({
      status: 'accepted',
      commandType: 'sendOutPokemon',
      currentRevision: parseSessionRevision(1),
      metadata: {
        serverProcessedAt: processedAt,
        traceId: 'trace-send-out-pokemon-use-case',
      },
    })
    expect(result.patchEvent).toMatchObject({
      eventType: SEND_OUT_POKEMON_PATCH_EVENT_TYPE,
      revision: parseSessionRevision(1),
      payload: {
        trainerTokenId: 'token-ash',
        tokenId: 'token-pikachu-1',
        mapSlug: 'arena-map',
        trainerSheetSlug: 'ash',
        pokemonSlug: 'pikachu',
        position: { x: 3, y: 0, z: 1 },
        placement: {
          id: 'token-pikachu-1',
          sheetKind: 'pokemon',
          sheetSlug: 'pikachu',
          sideId: 'heroes',
          facing: 'north-east',
          turned: false,
        },
      },
    })
    expect(result.mapRevisionChanges).toEqual([
      expect.objectContaining({
        mapSlug: 'arena-map',
        previousRevision: parseMapRevision(0),
        currentRevision: parseMapRevision(1),
      }),
    ])
    expect(snapshotCalls).toHaveLength(1)
    expect(result.snapshot).toEqual({ writtenAt: processedAt, revision: parseSessionRevision(1) })
    expect(tracker.recordCount).toBe(1)

    const storedMap = getSessionMapState(store.get(sessionId)?.state ?? initialState, 'arena-map')
    expect(storedMap?.revision).toBe(parseMapRevision(1))
    expect(storedMap?.document.placements.map((placement) => placement.id)).toEqual([
      'token-ash',
      'token-pikachu-1',
    ])
    expect(storedMap?.document.placements[1]?.sideId).toBe('heroes')
    expect(storedMap?.document.updatedAt).toBe(Date.parse(processedAt))
  })

  it('allows GM send-out without inferring an unknown side, rejects unauthorized players, and rejects non-owned team Pokémon', () => {
    const gmStore = createStoreWithState(createState(createMap({
      placements: [{
        id: 'token-ash',
        sheetKind: 'trainer',
        sheetSlug: 'ash',
        position: { x: 1, y: 0, z: 1 },
        facing: 'south-east',
      }],
    })))
    const gmResult = applySendOutPokemonCommandUseCase({
      command: createCommand({ actor: gmActor, opId: parseOpId('op_sendoutgm001') }),
    }, {
      env: enabledEnv,
      store: gmStore,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter([]),
      resolveSheets,
      resolveFootprint,
    })
    expect(gmResult.status).toBe('accepted')
    if (gmResult.status !== 'accepted') throw new Error('expected accepted GM send-out')
    expect(gmResult.token.placement).not.toHaveProperty('sideId')

    const unauthorizedState = createState(createMap())
    const unauthorizedStore = createStoreWithState({
      ...unauthorizedState,
      assignments: [{
        playerId,
        displayName,
        controllableResources: [],
        visibleResources: [{ kind: 'map', mapSlug: 'arena-map' }],
        updatedAt: createdAt,
        updatedByClientId: gmClientId,
      }],
    })
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const unauthorizedResult = applySendOutPokemonCommandUseCase({
      command: createCommand({ opId: parseOpId('op_sendoutdeny1') }),
    }, {
      env: enabledEnv,
      store: unauthorizedStore,
      operationTracker: createInMemorySessionOperationTracker(),
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      resolveSheets,
      resolveFootprint,
    })

    const ownershipStore = createStoreWithState(createState())
    const ownershipResult = applySendOutPokemonCommandUseCase({
      command: createCommand({
        opId: parseOpId('op_sendoutowner'),
        payload: {
          trainerTokenId: 'token-ash',
          pokemonSlug: 'eevee',
          tokenId: 'token-eevee-1',
          position: { x: 3, y: 0, z: 1 },
        },
        scopes: [
          createSendOutPokemonTrainerCommandScope(trainerResource),
          createSendOutPokemonSpawnCommandScope({
            kind: 'token',
            tokenId: 'token-eevee-1',
            mapSlug: 'arena-map',
            sheetKind: 'pokemon',
            sheetSlug: 'eevee',
          }),
        ],
      }),
    }, {
      env: enabledEnv,
      store: ownershipStore,
      operationTracker: createInMemorySessionOperationTracker(),
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      resolveSheets: () => ({ trainerSheet, pokemonSheet: { ...pokemonSheet, slug: 'eevee', nickname: 'Eevee', species: 'Eevee' } }),
      resolveFootprint,
    })

    expect(unauthorizedResult.status).toBe('rejected')
    if (unauthorizedResult.status !== 'rejected') throw new Error('expected unauthorized rejection')
    expect(unauthorizedResult.result).toMatchObject({ reason: 'unauthorized', retryable: false })
    expect(ownershipResult.status).toBe('rejected')
    if (ownershipResult.status !== 'rejected') throw new Error('expected ownership conflict')
    expect(ownershipResult.result).toMatchObject({ reason: 'conflict', retryable: false })
    expect(snapshotCalls).toHaveLength(0)
    expect(unauthorizedStore.get(sessionId)?.revision).toBe(parseSessionRevision(0))
    expect(ownershipStore.get(sessionId)?.revision).toBe(parseSessionRevision(0))
  })

  it('rejects out-of-range destinations, tracks duplicate retries, and rolls back on snapshot failure', () => {
    const rangeStore = createStoreWithState(createState())
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const rangeResult = applySendOutPokemonCommandUseCase({
      command: createCommand({
        opId: parseOpId('op_sendoutrange'),
        payload: {
          trainerTokenId: 'token-ash',
          pokemonSlug: 'pikachu',
          tokenId: 'token-pikachu-1',
          position: { x: 10, y: 0, z: 1 },
        },
      }),
    }, {
      env: enabledEnv,
      store: rangeStore,
      operationTracker: createInMemorySessionOperationTracker(),
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
      resolveSheets,
      resolveFootprint,
    })

    expect(rangeResult.status).toBe('rejected')
    if (rangeResult.status !== 'rejected') throw new Error('expected range conflict')
    expect(rangeResult.result).toMatchObject({ reason: 'conflict', retryable: true })
    expect(rangeStore.get(sessionId)?.revision).toBe(parseSessionRevision(0))
    expect(snapshotCalls).toHaveLength(0)

    const duplicateStore = createStoreWithState(createState())
    const tracker = createInMemorySessionOperationTracker()
    const command = createCommand({ opId: parseOpId('op_sendoutdupe1') })
    const first = applySendOutPokemonCommandUseCase({ command }, {
      env: enabledEnv,
      store: duplicateStore,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter([]),
      resolveSheets,
      resolveFootprint,
    })
    const duplicate = applySendOutPokemonCommandUseCase({ command }, {
      env: enabledEnv,
      store: duplicateStore,
      operationTracker: tracker,
      clock: () => '2026-05-26T12:30:06.000Z',
      writeSnapshot: createSnapshotWriter([]),
      resolveSheets,
      resolveFootprint,
    })

    expect(first.status).toBe('accepted')
    expect(duplicate.status).toBe('duplicate')
    if (duplicate.status !== 'duplicate') throw new Error('expected duplicate sendOutPokemon')
    expect(duplicate.result).toMatchObject({
      duplicate: true,
      idempotent: true,
      original: { status: 'accepted', revision: parseSessionRevision(1) },
    })

    const rollbackStore = createStoreWithState(createState())
    expect(() => applySendOutPokemonCommandUseCase({
      command: createCommand({ opId: parseOpId('op_sendoutroll1') }),
    }, {
      env: enabledEnv,
      store: rollbackStore,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: () => {
        throw new Error('disk full')
      },
      resolveSheets,
      resolveFootprint,
    })).toThrow('Failed to write sendOutPokemon session snapshot: disk full')
    expect(rollbackStore.get(sessionId)?.revision).toBe(parseSessionRevision(0))
    expect(getSessionMapState(rollbackStore.get(sessionId)?.state ?? createState(), 'arena-map')?.document.placements)
      .toHaveLength(1)
  })

  it('requires the explicit session-host runtime flag', () => {
    const store = createStoreWithState(createState())

    expect(() => applySendOutPokemonCommandUseCase({ command: createCommand() }, {
      env: {},
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter([]),
      resolveSheets,
      resolveFootprint,
    })).toThrow('live session hosting is disabled')
  })
})
