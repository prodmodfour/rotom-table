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
import type { CharacterSheet } from '~/types/characterSheet'
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
  MODIFY_HP_COMMAND_TYPE,
  createModifyHpSheetCommandScope,
  createModifyHpTokenCommandScope,
  type ModifyHpCommand,
} from '#shared/sessionTableActionCommands'
import type { TabletopMapV2 } from '~/types/map'
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

const SESSION_ID = parseSessionId('session_socketmhp001')
const OTHER_SESSION_ID = parseSessionId('session_socketmhp002')
const JOIN_CODE = parseJoinCode('MHP234')
const OTHER_JOIN_CODE = parseJoinCode('MHP235')
const GM_KEY = parseGmKey('gmkey_socketmodifyhp000000001xxx')
const OTHER_GM_KEY = parseGmKey('gmkey_socketmodifyhp000000002xxx')
const GM_CLIENT_ID = parseClientId('client_socketmhpgm')
const OTHER_GM_CLIENT_ID = parseClientId('client_socketmhpog')
const PLAYER_ID = parsePlayerId('player_socketmhp')
const PLAYER_CLIENT_ID = parseClientId('client_socketmhppl')
const PLAYER_DISPLAY_NAME = parseSessionDisplayName('Brock')
const OP_ID = parseOpId('op_socketmhp001')
const CREATED_AT = '2026-05-26T17:00:00.000Z'
const MODIFIED_AT = '2026-05-26T17:00:10.000Z'

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

const tokenResource = {
  kind: 'token' as const,
  tokenId: 'token-pikachu',
  mapSlug: 'arena-map',
  sheetKind: 'pokemon' as const,
  sheetSlug: 'pikachu',
}

const sheetResource = {
  kind: 'sheet' as const,
  sheetKind: 'pokemon' as const,
  sheetSlug: 'pikachu',
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
      controllableResources: [tokenResource],
      visibleResources: [{ kind: 'map', mapSlug: 'arena-map' }, tokenResource, sheetResource],
      updatedAt: CREATED_AT,
      updatedByClientId: GM_CLIENT_ID,
    },
  ],
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
})

const createPokemonSheet = (): CharacterSheet => ({
  slug: 'pikachu',
  nickname: 'Pikachu',
  species: '',
  level: 20,
  stats: { hp: { added: 5 } },
  combat: { currentHp: 30, injuries: 0, conditions: [] },
  player: true,
})

const gmHello = (
  sessionId = SESSION_ID,
  gmKey = GM_KEY,
  clientId = GM_CLIENT_ID,
): SessionClientHelloMessage => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'hello',
  direction: 'client',
  sessionId,
  identity: {
    role: 'gm',
    clientId,
    gmKey,
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

const modifyHpCommandMessage = (): SessionCommandMessage<ModifyHpCommand> => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'command',
  direction: 'client',
  sessionId: SESSION_ID,
  command: {
    schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
    sessionId: SESSION_ID,
    actor: gmActor,
    type: MODIFY_HP_COMMAND_TYPE,
    opId: OP_ID,
    baseRevision: INITIAL_SESSION_REVISION,
    scopes: [
      createModifyHpTokenCommandScope(tokenResource),
      createModifyHpSheetCommandScope(sheetResource),
    ],
    payload: {
      tokenId: 'token-pikachu',
      currentHp: 8,
      injuries: 1,
    },
    metadata: {
      traceId: 'trace-websocket-modify-hp',
    },
  },
})

describe('modifyHp WebSocket dispatch', () => {
  it('acks the sender and broadcasts a small hpModified patch to same-session clients only', () => {
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
    const otherState = createAuthoritativeSessionState<TabletopMapV2>({
      sessionId: OTHER_SESSION_ID,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })
    store.create({
      sessionId: OTHER_SESSION_ID,
      joinCode: OTHER_JOIN_CODE,
      gmKey: OTHER_GM_KEY,
      revision: otherState.revision,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      state: otherState,
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
    let sheet = createPokemonSheet()
    const sheetWrites: Record<string, unknown>[] = []

    const gmPeer = makePeer('peer-mhp-gm')
    const playerPeer = makePeer('peer-mhp-player')
    const otherPeer = makePeer('peer-mhp-other')
    const dependencies = {
      env: enabledEnv,
      registry,
      peers,
      store,
      modifyHpCommandDependencies: {
        operationTracker: false as const,
        writeSnapshot,
        readSheet: () => ({
          path: '/tmp/pikachu.json',
          sheet: JSON.parse(JSON.stringify(sheet)) as CharacterSheet,
        }),
        writeSheet: (_path: string, nextSheet: Record<string, unknown>) => {
          sheetWrites.push(JSON.parse(JSON.stringify(nextSheet)) as Record<string, unknown>)
          sheet = JSON.parse(JSON.stringify(nextSheet)) as CharacterSheet
        },
      },
    }

    handleSessionSocketOpen(gmPeer, { ...dependencies, clock: () => '2026-05-26T17:00:00.000Z' })
    handleSessionSocketMessage(gmPeer, { text: () => JSON.stringify(gmHello()) }, {
      ...dependencies,
      clock: () => '2026-05-26T17:00:01.000Z',
    })
    handleSessionSocketOpen(playerPeer, { ...dependencies, clock: () => '2026-05-26T17:00:02.000Z' })
    handleSessionSocketMessage(playerPeer, { text: () => JSON.stringify(playerHello()) }, {
      ...dependencies,
      clock: () => '2026-05-26T17:00:03.000Z',
    })
    handleSessionSocketOpen(otherPeer, { ...dependencies, clock: () => '2026-05-26T17:00:04.000Z' })
    handleSessionSocketMessage(otherPeer, {
      text: () => JSON.stringify(gmHello(OTHER_SESSION_ID, OTHER_GM_KEY, OTHER_GM_CLIENT_ID)),
    }, {
      ...dependencies,
      clock: () => '2026-05-26T17:00:05.000Z',
    })

    gmPeer.sent.length = 0
    playerPeer.sent.length = 0
    otherPeer.sent.length = 0

    handleSessionSocketMessage(gmPeer, { text: () => JSON.stringify(modifyHpCommandMessage()) }, {
      ...dependencies,
      clock: () => MODIFIED_AT,
    })

    expect(gmPeer.closed).toEqual([])
    expect(playerPeer.closed).toEqual([])
    expect(otherPeer.closed).toEqual([])
    expect(gmPeer.sent).toHaveLength(2)
    expect(playerPeer.sent).toHaveLength(1)
    expect(otherPeer.sent).toEqual([])

    expect(parseSentJson(gmPeer, 0)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'commandAck',
      direction: 'server',
      sessionId: SESSION_ID,
      result: {
        status: 'accepted',
        accepted: true,
        commandType: MODIFY_HP_COMMAND_TYPE,
        currentRevision: parseSessionRevision(1),
        opId: OP_ID,
        event: {
          eventType: 'hpModified',
          revision: parseSessionRevision(1),
          payload: {
            tokenId: 'token-pikachu',
            mapSlug: 'arena-map',
            previous: { currentHp: 30, injuries: 0 },
            current: { currentHp: 8, injuries: 1 },
          },
        },
        metadata: {
          serverProcessedAt: MODIFIED_AT,
          traceId: 'trace-websocket-modify-hp',
        },
      },
    })

    const gmPatch = parseSentJson(gmPeer, 1)
    const playerPatch = parseSentJson(playerPeer, 0)
    expect(gmPatch).toEqual(playerPatch)
    expect(playerPatch).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'patch',
      direction: 'server',
      sessionId: SESSION_ID,
      event: {
        eventType: 'hpModified',
        commandType: MODIFY_HP_COMMAND_TYPE,
        opId: OP_ID,
        actor: gmActor,
        revision: parseSessionRevision(1),
        payload: {
          tokenId: 'token-pikachu',
          mapSlug: 'arena-map',
          sheetKind: 'pokemon',
          sheetSlug: 'pikachu',
          previous: { currentHp: 30, injuries: 0 },
          current: { currentHp: 8, injuries: 1 },
        },
      },
    })
    expect(JSON.stringify(playerPatch)).not.toContain('placements')
    expect(JSON.stringify(playerPatch)).not.toContain('fieldEffects')

    expect(sheetWrites).toHaveLength(1)
    expect(sheet.combat).toMatchObject({ currentHp: 8, injuries: 1 })
    expect(snapshotCalls).toHaveLength(1)
    expect(snapshotCalls[0]?.revision).toBe(parseSessionRevision(1))
    const storedState = store.get(SESSION_ID)?.state
    expect(storedState).toBeDefined()
    const storedMap = getSessionMapState(storedState!, 'arena-map')
    expect(storedMap?.revision).toBe(parseMapRevision(1))
    expect(storedMap?.document.placements.find((placement) => placement.id === 'token-pikachu'))
      .toMatchObject({ sheetSlug: 'pikachu', position: { x: 1, y: 0, z: 1 } })
    expect(registry.get('peer-mhp-gm')).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      currentRevision: parseSessionRevision(1),
    })
    expect(registry.get('peer-mhp-player')).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      currentRevision: parseSessionRevision(1),
    })
  })
})
