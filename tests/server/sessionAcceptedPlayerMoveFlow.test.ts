import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as joinPath } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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
  type ClientId,
  type GmKey,
  type JoinCode,
  type PlayerId,
  type SessionId,
} from '#shared/sessionIdentity'
import type {
  PlayerSessionActor,
  SessionControllableResourceRef,
} from '#shared/sessionPermissions'
import {
  INITIAL_MAP_REVISION,
  parseMapRevision,
  parseSessionRevision,
} from '#shared/sessionRevisions'
import {
  getSessionMapState,
  type AuthoritativeSessionState,
} from '#shared/sessionState'
import {
  MOVE_TOKEN_COMMAND_TYPE,
  createMoveTokenCommandScope,
  type MoveTokenCommand,
} from '#shared/sessionTokenCommands'
import type { TabletopMapV2 } from '~/types/map'
import {
  SESSION_HOST_ENABLE_ENV,
  SESSION_HOST_ENABLE_VALUE,
} from '~~/server/utils/sessionHosting'
import { readMapFile } from '~~/server/utils/mapStorage'
import {
  SESSION_SNAPSHOT_TEMP_FILE_PREFIX,
  writeSessionSnapshot,
  type WriteSessionSnapshotOptions,
  type WriteSessionSnapshotResult,
} from '~~/server/utils/sessionSnapshots'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'
import {
  SESSION_SOCKET_AUTHENTICATED_STATUS,
  createInMemorySessionSocketRegistry,
  handleSessionSocketMessage,
  handleSessionSocketOpen,
  type SessionSocketPeerLike,
} from '~~/server/utils/sessionWebSocketServer'
import { createInMemorySessionSocketPeerRegistry } from '~~/server/utils/sessionWebSocketFanout'
import { attachSessionMapUseCase } from '~~/server/useCases/attachSessionMap'
import { joinPlayerSessionUseCase } from '~~/server/useCases/joinPlayerSession'
import { startGmSessionUseCase } from '~~/server/useCases/startGmSession'
import { updatePlayerAssignmentUseCase } from '~~/server/useCases/updatePlayerAssignment'

const enabledEnv = { [SESSION_HOST_ENABLE_ENV]: SESSION_HOST_ENABLE_VALUE }

const sessionId = parseSessionId('session_realmove0001')
const otherSessionId = parseSessionId('session_realmove0002')
const joinCode = parseJoinCode('FLW234')
const otherJoinCode = parseJoinCode('FLW235')
const gmKey = parseGmKey('gmkey_realmoveprimaryabcdefghijkl')
const otherGmKey = parseGmKey('gmkey_realmmovesecondaryabcdefghi')
const gmClientId = parseClientId('client_realmovegm')
const otherGmClientId = parseClientId('client_realmoveothergm')
const playerId = parsePlayerId('player_realmove1')
const playerClientId = parseClientId('client_realmoveplayer')
const playerDisplayName = parseSessionDisplayName('Leaf')
const moveOpId = parseOpId('op_realmove001')
const mapSlug = 'accepted-player-move-map'
const tokenId = 'token-eevee'

const startedAt = '2026-05-26T17:00:00.000Z'
const attachedAt = '2026-05-26T17:01:00.000Z'
const joinedAt = '2026-05-26T17:02:00.000Z'
const assignedAt = '2026-05-26T17:03:00.000Z'
const otherStartedAt = '2026-05-26T17:04:00.000Z'
const movedAt = '2026-05-26T17:05:00.000Z'

const revisionAfterAttach = parseSessionRevision(1)
const revisionAfterJoin = parseSessionRevision(2)
const revisionAfterAssignment = parseSessionRevision(3)
const revisionAfterMove = parseSessionRevision(4)

const tokenResource = {
  kind: 'token',
  tokenId,
  mapSlug,
  sheetKind: 'pokemon',
  sheetSlug: 'eevee',
} satisfies SessionControllableResourceRef

type FakePeer = SessionSocketPeerLike & {
  readonly sent: string[]
  readonly closed: { readonly code?: number, readonly reason?: string }[]
}

type SnapshotWriter = (
  state: AuthoritativeSessionState<TabletopMapV2>,
  options?: WriteSessionSnapshotOptions<TabletopMapV2>,
) => WriteSessionSnapshotResult<TabletopMapV2>

let tempRoots: string[] = []

const tempRoot = (): string => {
  const root = mkdtempSync(joinPath(tmpdir(), 'rotom-accepted-player-move-'))
  tempRoots.push(root)
  return root
}

const constantFactory = <TValue>(value: TValue) => () => value

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

const createPersistedMap = (): TabletopMapV2 => ({
  schemaVersion: 2,
  slug: mapSlug,
  name: 'Accepted Player Move Map',
  dimensions: { x: 8, y: 2, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    {
      id: tokenId,
      sheetKind: 'pokemon',
      sheetSlug: 'eevee',
      position: { x: 1, y: 0, z: 1 },
      facing: 'south-east',
    },
    {
      id: 'token-pikachu',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
      position: { x: 5, y: 0, z: 1 },
      facing: 'south-west',
    },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  moveUsage: { byPlacementId: {} },
  metadata: {},
  createdAt: 1_000,
  updatedAt: 1_000,
})

const createSnapshotWriter = (
  snapshotRoot: string,
  writes: AuthoritativeSessionState<TabletopMapV2>[] = [],
): SnapshotWriter => {
  let writeIndex = 0

  return (state, options) => {
    writeIndex += 1
    writes.push(state)
    return writeSessionSnapshot(state, {
      ...options,
      rootDir: snapshotRoot,
      tempFileName: () => `${SESSION_SNAPSHOT_TEMP_FILE_PREFIX}accepted-move-${writeIndex}`,
      flushToDisk: false,
    })
  }
}

const gmHello = (
  activeSessionId: SessionId = sessionId,
  activeGmKey: GmKey = gmKey,
  clientId: ClientId = gmClientId,
): SessionClientHelloMessage => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'hello',
  direction: 'client',
  sessionId: activeSessionId,
  identity: {
    role: 'gm',
    clientId,
    gmKey: activeGmKey,
  },
  reconnect: false,
})

const playerHello = (): SessionClientHelloMessage => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'hello',
  direction: 'client',
  sessionId,
  identity: {
    role: 'player',
    clientId: playerClientId,
    playerId,
    displayName: playerDisplayName,
  },
  reconnect: false,
})

const playerMoveCommandMessage = (actor: PlayerSessionActor): SessionCommandMessage<MoveTokenCommand> => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'command',
  direction: 'client',
  sessionId,
  command: {
    schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
    sessionId,
    actor,
    type: MOVE_TOKEN_COMMAND_TYPE,
    opId: moveOpId,
    baseRevision: revisionAfterAssignment,
    scopes: [createMoveTokenCommandScope(tokenResource)],
    payload: {
      tokenId,
      to: { x: 2, y: 0, z: 2 },
    },
    metadata: {
      traceId: 'trace-accepted-player-move',
    },
  },
})

const openSocketAt = (
  peer: FakePeer,
  dependencies: Parameters<typeof handleSessionSocketOpen>[1],
  at: string,
): void => {
  handleSessionSocketOpen(peer, { ...dependencies, clock: () => at })
}

const sendSocketMessageAt = (
  peer: FakePeer,
  message: unknown,
  dependencies: Parameters<typeof handleSessionSocketMessage>[2],
  at: string,
): void => {
  handleSessionSocketMessage(peer, { text: () => JSON.stringify(message) }, {
    ...dependencies,
    clock: () => at,
  })
}

afterEach(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true })
  tempRoots = []
})

describe('accepted player move live session flow', () => {
  it('starts a hosted session, attaches a persisted map, assigns a token, and fans out an accepted player move only within that session', () => {
    const mapRoot = tempRoot()
    const snapshotRoot = joinPath(tempRoot(), 'sessions')
    const mapPath = joinPath(mapRoot, `${mapSlug}.json`)
    writeFileSync(mapPath, JSON.stringify(createPersistedMap(), null, 2), 'utf8')

    const store = createInMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>()
    const snapshotWrites: AuthoritativeSessionState<TabletopMapV2>[] = []
    const writeSnapshot = createSnapshotWriter(snapshotRoot, snapshotWrites)

    const start = startGmSessionUseCase<TabletopMapV2>({}, {
      env: enabledEnv,
      store,
      clock: () => startedAt,
      generateSessionId: constantFactory<SessionId>(sessionId),
      generateJoinCode: constantFactory<JoinCode>(joinCode),
      generateGmKey: constantFactory<GmKey>(gmKey),
      generateClientId: constantFactory<ClientId>(gmClientId),
      writeSnapshot,
    })
    expect(start.session.revision).toBe(0)

    const attach = attachSessionMapUseCase<TabletopMapV2>({
      sessionId,
      gmKey,
      gmClientId,
      mapSlug,
    }, {
      env: enabledEnv,
      store,
      clock: () => attachedAt,
      findMapPath: (requestedSlug) => requestedSlug === mapSlug ? mapPath : null,
      readMap: readMapFile,
      writeSnapshot,
    })
    expect(attach.session.revision).toBe(revisionAfterAttach)
    expect(attach.map).toEqual({
      mapSlug,
      revision: INITIAL_MAP_REVISION,
      selected: true,
    })
    expect(attach.visibility).toMatchObject({
      grantsJoinedPlayers: true,
      grantsFuturePlayers: true,
      visiblePlayerIds: [],
    })

    const join = joinPlayerSessionUseCase<TabletopMapV2>({ joinCode, displayName: playerDisplayName }, {
      env: enabledEnv,
      store,
      clock: () => joinedAt,
      generatePlayerId: constantFactory<PlayerId>(playerId),
      generateClientId: constantFactory<ClientId>(playerClientId),
      writeSnapshot,
    })
    expect(join.session.revision).toBe(revisionAfterJoin)
    expect(join.state.assignments).toEqual([
      {
        playerId,
        displayName: playerDisplayName,
        controllableResources: [],
        visibleResources: [{ kind: 'map', mapSlug }],
        updatedAt: joinedAt,
      },
    ])

    const assignment = updatePlayerAssignmentUseCase<TabletopMapV2>({
      sessionId,
      gmKey,
      gmClientId,
      playerId,
      action: 'assign',
      resources: [tokenResource],
    }, {
      env: enabledEnv,
      store,
      clock: () => assignedAt,
      writeSnapshot,
    })
    expect(assignment.session.revision).toBe(revisionAfterAssignment)
    expect(assignment.assignment).toMatchObject({
      playerId,
      displayName: playerDisplayName,
      controllableResources: [tokenResource],
      visibleResources: [{ kind: 'map', mapSlug }, tokenResource],
    })

    startGmSessionUseCase<TabletopMapV2>({}, {
      env: enabledEnv,
      store,
      clock: () => otherStartedAt,
      generateSessionId: constantFactory<SessionId>(otherSessionId),
      generateJoinCode: constantFactory<JoinCode>(otherJoinCode),
      generateGmKey: constantFactory<GmKey>(otherGmKey),
      generateClientId: constantFactory<ClientId>(otherGmClientId),
      writeSnapshot,
    })

    const registry = createInMemorySessionSocketRegistry()
    const peers = createInMemorySessionSocketPeerRegistry()
    const socketDependencies = {
      env: enabledEnv,
      registry,
      peers,
      store,
      moveTokenCommandDependencies: {
        operationTracker: false as const,
        writeSnapshot,
      },
    }
    const gmPeer = makePeer('peer-accepted-move-gm')
    const playerPeer = makePeer('peer-accepted-move-player')
    const otherPeer = makePeer('peer-accepted-move-other')

    openSocketAt(gmPeer, socketDependencies, '2026-05-26T17:04:10.000Z')
    sendSocketMessageAt(gmPeer, gmHello(), socketDependencies, '2026-05-26T17:04:11.000Z')
    openSocketAt(playerPeer, socketDependencies, '2026-05-26T17:04:12.000Z')
    sendSocketMessageAt(playerPeer, playerHello(), socketDependencies, '2026-05-26T17:04:13.000Z')
    openSocketAt(otherPeer, socketDependencies, '2026-05-26T17:04:14.000Z')
    sendSocketMessageAt(
      otherPeer,
      gmHello(otherSessionId, otherGmKey, otherGmClientId),
      socketDependencies,
      '2026-05-26T17:04:15.000Z',
    )

    expect(registry.get(gmPeer.id)).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      sessionId,
      currentRevision: revisionAfterAssignment,
    })
    expect(registry.get(playerPeer.id)).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      sessionId,
      currentRevision: revisionAfterAssignment,
    })
    expect(registry.get(otherPeer.id)).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      sessionId: otherSessionId,
      currentRevision: 0,
    })

    gmPeer.sent.length = 0
    playerPeer.sent.length = 0
    otherPeer.sent.length = 0

    sendSocketMessageAt(
      playerPeer,
      playerMoveCommandMessage(join.player.actor),
      socketDependencies,
      movedAt,
    )

    expect(gmPeer.closed).toEqual([])
    expect(playerPeer.closed).toEqual([])
    expect(otherPeer.closed).toEqual([])
    expect(playerPeer.sent).toHaveLength(2)
    expect(gmPeer.sent).toHaveLength(1)
    expect(otherPeer.sent).toEqual([])

    expect(parseSentJson(playerPeer, 0)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'commandAck',
      direction: 'server',
      sessionId,
      result: {
        status: 'accepted',
        accepted: true,
        commandType: MOVE_TOKEN_COMMAND_TYPE,
        actor: join.player.actor,
        currentRevision: revisionAfterMove,
        opId: moveOpId,
        event: {
          eventType: 'tokenMoved',
          revision: revisionAfterMove,
          payload: {
            tokenId,
            mapSlug,
            from: { x: 1, y: 0, z: 1 },
            to: { x: 2, y: 0, z: 2 },
          },
        },
        metadata: {
          serverProcessedAt: movedAt,
          traceId: 'trace-accepted-player-move',
        },
      },
    })

    const playerPatch = parseSentJson(playerPeer, 1)
    const gmPatch = parseSentJson(gmPeer, 0)
    expect(gmPatch).toEqual(playerPatch)
    expect(gmPatch).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'patch',
      direction: 'server',
      sessionId,
      event: {
        eventType: 'tokenMoved',
        commandType: MOVE_TOKEN_COMMAND_TYPE,
        opId: moveOpId,
        actor: join.player.actor,
        revision: revisionAfterMove,
        payload: {
          tokenId,
          mapSlug,
          from: { x: 1, y: 0, z: 1 },
          to: { x: 2, y: 0, z: 2 },
          sheetKind: 'pokemon',
          sheetSlug: 'eevee',
        },
      },
    })
    expect(JSON.stringify(gmPatch)).not.toContain('placements')

    const stored = store.get(sessionId)
    const storedMap = stored?.state === undefined ? undefined : getSessionMapState(stored.state, mapSlug)
    expect(stored?.revision).toBe(revisionAfterMove)
    expect(storedMap?.revision).toBe(parseMapRevision(1))
    expect(storedMap?.document.placements.find((placement) => placement.id === tokenId)?.position)
      .toEqual({ x: 2, y: 0, z: 2 })

    expect(registry.get(gmPeer.id)).toMatchObject({ currentRevision: revisionAfterMove })
    expect(registry.get(playerPeer.id)).toMatchObject({ currentRevision: revisionAfterMove })
    expect(registry.get(otherPeer.id)).toMatchObject({
      sessionId: otherSessionId,
      currentRevision: 0,
    })
    expect(store.get(otherSessionId)?.state).toMatchObject({
      sessionId: otherSessionId,
      revision: 0,
      selectedMapSlug: null,
      maps: [],
    })
    expect(snapshotWrites.at(-1)).toMatchObject({
      sessionId,
      revision: revisionAfterMove,
    })
  })
})
