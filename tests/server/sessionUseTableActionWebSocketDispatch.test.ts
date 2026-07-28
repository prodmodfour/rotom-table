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
import {
  INITIAL_SESSION_REVISION,
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
  USE_MANEUVER_COMMAND_TYPE,
  createUseManeuverSheetCommandScope,
  createUseManeuverTokenCommandScope,
  type UseManeuverCommand,
} from '#shared/sessionTableActionCommands'
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
import {
  createPersistedSessionSnapshot,
  type WriteSessionSnapshotOptions,
  type WriteSessionSnapshotResult,
} from '~~/server/utils/sessionSnapshots'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'

const enabledEnv = { [SESSION_HOST_ENABLE_ENV]: SESSION_HOST_ENABLE_VALUE }
const SESSION_ID = parseSessionId('session_socketact001')
const JOIN_CODE = parseJoinCode('UAC234')
const GM_KEY = parseGmKey('gmkey_socketaction000000001xxx')
const GM_CLIENT_ID = parseClientId('client_socketactgm')
const PLAYER_ID = parsePlayerId('player_socketact')
const PLAYER_CLIENT_ID = parseClientId('client_socketactpl')
const PLAYER_DISPLAY_NAME = parseSessionDisplayName('Brock')
const OP_ID = parseOpId('op_socketact001')
const CREATED_AT = '2026-05-26T20:30:00.000Z'
const USED_AT = '2026-05-26T20:30:10.000Z'

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

const playerActor: PlayerSessionActor = {
  role: 'player',
  playerId: PLAYER_ID,
  clientId: PLAYER_CLIENT_ID,
  displayName: PLAYER_DISPLAY_NAME,
}

const trainerTokenResource = {
  kind: 'token' as const,
  tokenId: 'token-brock',
  mapSlug: 'arena-map',
  sheetKind: 'trainer' as const,
  sheetSlug: 'brock',
}

const trainerSheetResource = {
  kind: 'sheet' as const,
  sheetKind: 'trainer' as const,
  sheetSlug: 'brock',
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
      id: 'token-brock',
      sheetKind: 'trainer',
      sheetSlug: 'brock',
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
      controllableResources: [trainerTokenResource],
      visibleResources: [{ kind: 'map', mapSlug: 'arena-map' }, trainerTokenResource, trainerSheetResource],
      updatedAt: CREATED_AT,
      updatedByClientId: GM_CLIENT_ID,
    },
  ],
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
})

const createTrainerSheet = (): TrainerSheet => ({
  slug: 'brock',
  name: 'Brock',
  level: 20,
  player: true,
  abilities: [],
  maneuvers: [],
  orders: [],
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

const useManeuverCommandMessage = (): SessionCommandMessage<UseManeuverCommand> => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'command',
  direction: 'client',
  sessionId: SESSION_ID,
  command: {
    schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
    sessionId: SESSION_ID,
    actor: playerActor,
    type: USE_MANEUVER_COMMAND_TYPE,
    opId: OP_ID,
    baseRevision: INITIAL_SESSION_REVISION,
    scopes: [
      createUseManeuverTokenCommandScope(trainerTokenResource),
      createUseManeuverSheetCommandScope(trainerSheetResource),
    ],
    payload: {
      tokenId: 'token-brock',
      maneuverName: 'Trip',
    },
    metadata: {
      traceId: 'trace-websocket-use-maneuver',
    },
  },
})

describe('useManeuver/useOrder WebSocket dispatch boundary', () => {
  it('acks the sender and broadcasts a small maneuverUsed patch to same-session clients only', () => {
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
    const sheet = createTrainerSheet()

    const gmPeer = makePeer('peer-uac-gm')
    const playerPeer = makePeer('peer-uac-player')
    const dependencies = {
      env: enabledEnv,
      registry,
      peers,
      store,
      useTableActionCommandDependencies: {
        operationTracker: false as const,
        writeSnapshot,
        readSheet: () => ({
          path: '/tmp/brock.json',
          sheet: JSON.parse(JSON.stringify(sheet)) as TrainerSheet,
        }),
      },
    }

    handleSessionSocketOpen(gmPeer, { ...dependencies, clock: () => '2026-05-26T20:30:00.000Z' })
    handleSessionSocketMessage(gmPeer, { text: () => JSON.stringify(gmHello()) }, {
      ...dependencies,
      clock: () => '2026-05-26T20:30:01.000Z',
    })
    handleSessionSocketOpen(playerPeer, { ...dependencies, clock: () => '2026-05-26T20:30:02.000Z' })
    handleSessionSocketMessage(playerPeer, { text: () => JSON.stringify(playerHello()) }, {
      ...dependencies,
      clock: () => '2026-05-26T20:30:03.000Z',
    })

    gmPeer.sent.length = 0
    playerPeer.sent.length = 0

    handleSessionSocketMessage(playerPeer, { text: () => JSON.stringify(useManeuverCommandMessage()) }, {
      ...dependencies,
      clock: () => USED_AT,
    })

    expect(gmPeer.closed).toEqual([])
    expect(playerPeer.closed).toEqual([])
    expect(playerPeer.sent).toHaveLength(2)
    expect(gmPeer.sent).toHaveLength(1)

    expect(parseSentJson(playerPeer, 0)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'commandAck',
      direction: 'server',
      sessionId: SESSION_ID,
      result: {
        status: 'accepted',
        accepted: true,
        commandType: USE_MANEUVER_COMMAND_TYPE,
        currentRevision: parseSessionRevision(1),
        opId: OP_ID,
        event: {
          eventType: 'maneuverUsed',
          revision: parseSessionRevision(1),
          payload: {
            tokenId: 'token-brock',
            mapSlug: 'arena-map',
            sheetKind: 'trainer',
            sheetSlug: 'brock',
            maneuverName: 'Trip',
            logLines: expect.arrayContaining(['Brock used Trip.']),
          },
        },
        metadata: {
          serverProcessedAt: USED_AT,
          traceId: 'trace-websocket-use-maneuver',
        },
      },
    })

    const playerPatch = parseSentJson(playerPeer, 1)
    const gmPatch = parseSentJson(gmPeer, 0)
    expect(playerPatch).toEqual(gmPatch)
    expect(gmPatch).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'patch',
      direction: 'server',
      sessionId: SESSION_ID,
      event: {
        eventType: 'maneuverUsed',
        commandType: USE_MANEUVER_COMMAND_TYPE,
        opId: OP_ID,
        actor: playerActor,
        revision: parseSessionRevision(1),
        payload: {
          tokenId: 'token-brock',
          mapSlug: 'arena-map',
          maneuverName: 'Trip',
        },
      },
    })
    expect(JSON.stringify(gmPatch)).not.toContain('placements')
    expect(JSON.stringify(gmPatch)).not.toContain('voxels')

    expect(snapshotCalls).toHaveLength(1)
    const storedState = store.get(SESSION_ID)?.state
    expect(storedState).toBeDefined()
    const storedMap = getSessionMapState(storedState!, 'arena-map')
    expect(storedMap?.revision).toBe(parseMapRevision(1))
    expect(storedMap?.document.metadata?.maneuverLog).toEqual([
      expect.objectContaining({ userId: 'token-brock', maneuverName: 'Trip' }),
    ])
    expect(registry.get('peer-uac-player')).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      currentRevision: parseSessionRevision(1),
    })
    expect(registry.get('peer-uac-gm')).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      currentRevision: parseSessionRevision(1),
    })
  })
})
