import { describe, expect, it } from 'vitest'
import {
  SESSION_COMMAND_ENVELOPE_VERSION,
  parseOpId,
} from '#shared/sessionCommands'
import {
  SESSION_MESSAGE_SCHEMA_VERSION,
  type SessionClientHelloMessage,
  type SessionCommandMessage,
} from '#shared/sessionMessages'
import {
  parseClientId,
  parseGmKey,
  parseJoinCode,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
} from '#shared/sessionIdentity'
import type { PlayerSessionActor } from '#shared/sessionPermissions'
import { INITIAL_SESSION_REVISION, parseMapRevision, parseSessionRevision } from '#shared/sessionRevisions'
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
import type { TabletopMapV2 } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  SESSION_HOST_ENABLE_ENV,
  SESSION_HOST_ENABLE_VALUE,
} from '~~/server/utils/sessionHosting'
import {
  SESSION_SOCKET_AUTHENTICATED_STATUS,
  createInMemorySessionSocketRegistry,
  handleSessionSocketMessage,
  handleSessionSocketOpen,
  type SessionSocketPeerLike,
} from '~~/server/utils/sessionWebSocketServer'
import { createInMemorySessionSocketPeerRegistry } from '~~/server/utils/sessionWebSocketFanout'
import type { SendOutPokemonFootprintResolver } from '~~/server/useCases/applySendOutPokemonCommand'
import {
  createPersistedSessionSnapshot,
  type WriteSessionSnapshotOptions,
  type WriteSessionSnapshotResult,
} from '~~/server/utils/sessionSnapshots'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'

const enabledEnv = { [SESSION_HOST_ENABLE_ENV]: SESSION_HOST_ENABLE_VALUE }
const SESSION_ID = parseSessionId('session_socketsend001')
const JOIN_CODE = parseJoinCode('SND234')
const GM_KEY = parseGmKey('gmkey_socketsendoutprimary0001')
const GM_CLIENT_ID = parseClientId('client_sendsockgm')
const PLAYER_ID = parsePlayerId('player_sendsock01')
const PLAYER_CLIENT_ID = parseClientId('client_sendsockpl')
const PLAYER_DISPLAY_NAME = parseSessionDisplayName('Ash')
const CREATED_AT = '2026-05-26T15:30:00.000Z'
const SENT_OUT_AT = '2026-05-26T15:30:10.000Z'

const gmActor = {
  role: 'gm' as const,
  clientId: GM_CLIENT_ID,
}

const playerActor: PlayerSessionActor = {
  role: 'player',
  playerId: PLAYER_ID,
  clientId: PLAYER_CLIENT_ID,
  displayName: PLAYER_DISPLAY_NAME,
}

const trainerResource = {
  kind: 'token' as const,
  tokenId: 'token-ash',
  mapSlug: 'arena-map',
  sheetKind: 'trainer' as const,
  sheetSlug: 'ash',
}

const pokemonResource = {
  kind: 'token' as const,
  tokenId: 'token-pikachu-1',
  mapSlug: 'arena-map',
  sheetKind: 'pokemon' as const,
  sheetSlug: 'pikachu',
}

const trainerSheet: TrainerSheet = {
  slug: 'ash',
  name: 'Ash',
  level: 5,
  currentTeam: ['pikachu'],
}

const pokemonSheet: CharacterSheet = {
  slug: 'pikachu',
  nickname: 'Pikachu',
  species: 'Pikachu',
  level: 5,
}

type FakePeer = SessionSocketPeerLike & {
  readonly sent: string[]
  readonly closed: { readonly code?: number, readonly reason?: string }[]
}

const makePeer = (id: string): FakePeer => {
  const sent: string[] = []
  const closed: { code?: number, reason?: string }[] = []

  return {
    id,
    sent,
    closed,
    send(data: unknown) {
      sent.push(String(data))
      return undefined
    },
    close(code?: number, reason?: string) {
      closed.push({ code, reason })
      return undefined
    },
  }
}

const parseSentJson = (peer: FakePeer, index = 0): unknown => JSON.parse(peer.sent[index] ?? 'null')

const createMap = (): TabletopMapV2 => ({
  schemaVersion: 2,
  slug: 'arena-map',
  name: 'Arena Map',
  dimensions: { x: 8, y: 3, z: 8 },
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

const createState = (): AuthoritativeSessionState<TabletopMapV2> => createAuthoritativeSessionState<TabletopMapV2>({
  sessionId: SESSION_ID,
  revision: INITIAL_SESSION_REVISION,
  selectedMapSlug: 'arena-map',
  maps: [
    createAuthoritativeSessionMapState({
      mapSlug: 'arena-map',
      revision: parseMapRevision(0),
      document: createMap(),
    }),
  ],
  players: [
    {
      playerId: PLAYER_ID,
      displayName: PLAYER_DISPLAY_NAME,
      joinedAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
  ],
  assignments: [
    {
      playerId: PLAYER_ID,
      displayName: PLAYER_DISPLAY_NAME,
      controllableResources: [{ kind: 'token', tokenId: 'token-ash' }],
      visibleResources: [{ kind: 'map', mapSlug: 'arena-map' }, trainerResource],
      updatedAt: CREATED_AT,
      updatedByClientId: GM_CLIENT_ID,
    },
  ],
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
})

const gmHello = (): SessionClientHelloMessage => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'hello',
  direction: 'client',
  sessionId: SESSION_ID,
  identity: {
    role: 'gm',
    clientId: GM_CLIENT_ID,
    gmKey: GM_KEY,
  },
  reconnect: false,
})

const playerHello = (): SessionClientHelloMessage => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'hello',
  direction: 'client',
  sessionId: SESSION_ID,
  identity: {
    role: 'player',
    clientId: PLAYER_CLIENT_ID,
    playerId: PLAYER_ID,
    displayName: PLAYER_DISPLAY_NAME,
  },
  reconnect: false,
})

const sendOutPokemonCommandMessage = (): SessionCommandMessage<SendOutPokemonCommand> => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'command',
  direction: 'client',
  sessionId: SESSION_ID,
  command: {
    schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
    sessionId: SESSION_ID,
    actor: playerActor,
    type: SEND_OUT_POKEMON_COMMAND_TYPE,
    opId: parseOpId('op_socketsendout'),
    baseRevision: INITIAL_SESSION_REVISION,
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
      traceId: 'trace-websocket-send-out-pokemon',
    },
  },
})

describe('sendOutPokemon WebSocket dispatch', () => {
  it('acks the sender and broadcasts a small pokemonSentOut patch to same-session clients', () => {
    const registry = createInMemorySessionSocketRegistry()
    const peers = createInMemorySessionSocketPeerRegistry()
    const store = createInMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>()
    const state = createState()
    store.create({
      sessionId: SESSION_ID,
      joinCode: JOIN_CODE,
      gmKey: GM_KEY,
      revision: state.revision,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      state,
    })
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const writeSnapshot = (
      nextState: AuthoritativeSessionState<TabletopMapV2>,
      options?: WriteSessionSnapshotOptions<TabletopMapV2>,
    ): WriteSessionSnapshotResult<TabletopMapV2> => {
      snapshotCalls.push(nextState)
      return {
        directoryPath: '/tmp/rotom-session',
        filePath: '/tmp/rotom-session/snapshot.json',
        snapshot: createPersistedSessionSnapshot(nextState, options),
        bytesWritten: 1,
      }
    }

    const playerPeer = makePeer('peer-sendout-player')
    const gmPeer = makePeer('peer-sendout-gm')
    const dependencies = {
      env: enabledEnv,
      registry,
      peers,
      store,
      sendOutPokemonCommandDependencies: {
        operationTracker: false as const,
        writeSnapshot,
        resolveSheets: () => ({ trainerSheet, pokemonSheet }),
        resolveFootprint: (({ placement }) => ({
          id: placement.id,
          base: 1,
          clearance: 1,
        })) satisfies SendOutPokemonFootprintResolver,
      },
    }

    handleSessionSocketOpen(playerPeer, { ...dependencies, clock: () => '2026-05-26T15:30:00.000Z' })
    handleSessionSocketMessage(playerPeer, { text: () => JSON.stringify(playerHello()) }, {
      ...dependencies,
      clock: () => '2026-05-26T15:30:01.000Z',
    })
    handleSessionSocketOpen(gmPeer, { ...dependencies, clock: () => '2026-05-26T15:30:02.000Z' })
    handleSessionSocketMessage(gmPeer, { text: () => JSON.stringify(gmHello()) }, {
      ...dependencies,
      clock: () => '2026-05-26T15:30:03.000Z',
    })

    playerPeer.sent.length = 0
    gmPeer.sent.length = 0

    handleSessionSocketMessage(playerPeer, { text: () => JSON.stringify(sendOutPokemonCommandMessage()) }, {
      ...dependencies,
      clock: () => SENT_OUT_AT,
    })

    expect(playerPeer.closed).toEqual([])
    expect(gmPeer.closed).toEqual([])
    expect(playerPeer.sent).toHaveLength(2)
    expect(gmPeer.sent).toHaveLength(1)
    expect(parseSentJson(playerPeer, 0)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'commandAck',
      direction: 'server',
      sessionId: SESSION_ID,
      result: {
        status: 'accepted',
        commandType: SEND_OUT_POKEMON_COMMAND_TYPE,
        currentRevision: parseSessionRevision(1),
        event: {
          eventType: 'pokemonSentOut',
          payload: {
            trainerTokenId: 'token-ash',
            tokenId: 'token-pikachu-1',
            mapSlug: 'arena-map',
            placement: {
              id: 'token-pikachu-1',
              sheetKind: 'pokemon',
              sheetSlug: 'pikachu',
              position: { x: 3, y: 0, z: 1 },
            },
          },
        },
        metadata: {
          serverProcessedAt: SENT_OUT_AT,
          traceId: 'trace-websocket-send-out-pokemon',
        },
      },
    })
    const patch = parseSentJson(gmPeer, 0)
    expect(patch).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'patch',
      direction: 'server',
      sessionId: SESSION_ID,
      event: {
        eventType: 'pokemonSentOut',
        commandType: SEND_OUT_POKEMON_COMMAND_TYPE,
        revision: parseSessionRevision(1),
        actor: playerActor,
        payload: {
          trainerTokenId: 'token-ash',
          tokenId: 'token-pikachu-1',
          mapSlug: 'arena-map',
          pokemonSlug: 'pikachu',
          position: { x: 3, y: 0, z: 1 },
        },
      },
    })
    expect(JSON.stringify(patch)).not.toContain('fieldEffects')
    expect(snapshotCalls.map((entry) => entry.revision)).toEqual([parseSessionRevision(1)])

    const storedState = store.get(SESSION_ID)?.state
    expect(storedState).toBeDefined()
    const storedMap = getSessionMapState(storedState!, 'arena-map')
    expect(storedMap?.revision).toBe(parseMapRevision(1))
    expect(storedMap?.document.placements.map((placement) => placement.id)).toEqual([
      'token-ash',
      'token-pikachu-1',
    ])
    expect(registry.get('peer-sendout-player')).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      currentRevision: parseSessionRevision(1),
    })
    expect(registry.get('peer-sendout-gm')).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      currentRevision: parseSessionRevision(1),
    })
  })
})
