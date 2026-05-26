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
import type {
  GmSessionActor,
  PlayerAssignmentRecord,
  PlayerSessionActor,
  SessionSheetResourceRef,
  SessionTokenResourceRef,
} from '#shared/sessionPermissions'
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
  NEXT_INITIATIVE_COMMAND_TYPE,
  createInitiativeCommandScope,
  type NextInitiativeCommand,
} from '#shared/sessionInitiativeCommands'
import type { SheetKind } from '#shared/sheets'
import {
  MODIFY_CONDITIONS_COMMAND_TYPE,
  MODIFY_HP_COMMAND_TYPE,
  createModifyConditionsSheetCommandScope,
  createModifyConditionsTokenCommandScope,
  createModifyHpSheetCommandScope,
  createModifyHpTokenCommandScope,
  type ModifyConditionsCommand,
  type ModifyHpCommand,
} from '#shared/sessionTableActionCommands'
import {
  MOVE_TOKEN_COMMAND_TYPE,
  TURN_TOKEN_COMMAND_TYPE,
  createMoveTokenCommandScope,
  createTurnTokenCommandScope,
  type MoveTokenCommand,
  type TurnTokenCommand,
} from '#shared/sessionTokenCommands'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMapV2 } from '~/types/map'
import {
  SESSION_HOST_ENABLE_ENV,
  SESSION_HOST_ENABLE_VALUE,
} from '~~/server/utils/sessionHosting'
import { createInMemorySessionOperationTracker } from '~~/server/utils/sessionOperationTracker'
import {
  createPersistedSessionSnapshot,
  type WriteSessionSnapshotOptions,
  type WriteSessionSnapshotResult,
} from '~~/server/utils/sessionSnapshots'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'
import { createInMemorySessionSocketPeerRegistry } from '~~/server/utils/sessionWebSocketFanout'
import {
  SESSION_SOCKET_AUTHENTICATED_STATUS,
  createInMemorySessionSocketRegistry,
  handleSessionSocketMessage,
  handleSessionSocketOpen,
  type SessionSocketHandlerDependencies,
  type SessionSocketPeerLike,
} from '~~/server/utils/sessionWebSocketServer'

const enabledEnv = { [SESSION_HOST_ENABLE_ENV]: SESSION_HOST_ENABLE_VALUE }

const SESSION_ID = parseSessionId('session_commandaudit001')
const OTHER_SESSION_ID = parseSessionId('session_commandaudit002')
const JOIN_CODE = parseJoinCode('AUD234')
const OTHER_JOIN_CODE = parseJoinCode('AUD235')
const GM_KEY = parseGmKey('gmkey_commandauditprimary000001')
const OTHER_GM_KEY = parseGmKey('gmkey_commandauditother000002xx')
const GM_CLIENT_ID = parseClientId('client_cmdauditgm')
const OTHER_GM_CLIENT_ID = parseClientId('client_cmdauditog')
const PLAYER_A_ID = parsePlayerId('player_cmdauditA')
const PLAYER_A_CLIENT_ID = parseClientId('client_cmdauditpa')
const PLAYER_A_DISPLAY_NAME = parseSessionDisplayName('Ash')
const PLAYER_B_ID = parsePlayerId('player_cmdauditB')
const PLAYER_B_CLIENT_ID = parseClientId('client_cmdauditpb')
const PLAYER_B_DISPLAY_NAME = parseSessionDisplayName('Misty')
const CREATED_AT = '2026-05-26T20:00:00.000Z'

const MOVE_OP_ID = parseOpId('op_auditmove001')
const TURN_OP_ID = parseOpId('op_auditturn001')
const HP_OP_ID = parseOpId('op_audithp001')
const CONDITIONS_OP_ID = parseOpId('op_auditconditions001')
const INITIATIVE_OP_ID = parseOpId('op_auditinitiative001')
const UNAUTHORIZED_OP_ID = parseOpId('op_auditunauth001')
const STALE_OP_ID = parseOpId('op_auditstale001')

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

const clearSent = (...peers: readonly FakePeer[]): void => {
  for (const peer of peers) peer.sent.length = 0
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const gmActor: GmSessionActor = {
  role: 'gm',
  clientId: GM_CLIENT_ID,
}

const playerAActor: PlayerSessionActor = {
  role: 'player',
  playerId: PLAYER_A_ID,
  clientId: PLAYER_A_CLIENT_ID,
  displayName: PLAYER_A_DISPLAY_NAME,
}

const playerBActor: PlayerSessionActor = {
  role: 'player',
  playerId: PLAYER_B_ID,
  clientId: PLAYER_B_CLIENT_ID,
  displayName: PLAYER_B_DISPLAY_NAME,
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

const createMap = (): TabletopMapV2 => ({
  schemaVersion: 2,
  slug: 'arena-map',
  name: 'Audit Arena',
  dimensions: { x: 8, y: 3, z: 8 },
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
      turned: false,
    },
    {
      id: 'token-bulbasaur',
      sheetKind: 'pokemon',
      sheetSlug: 'bulbasaur',
      position: { x: 4, y: 0, z: 1 },
      facing: 'south-west',
      initiative: 12,
      turned: false,
    },
  ],
  lights: [],
  initiative: { activeId: 'token-pikachu', round: 1 },
  moveUsage: { byPlacementId: {} },
  metadata: {},
  createdAt: 1_000,
  updatedAt: 1_000,
})

const createPokemonSheet = (): CharacterSheet => ({
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
  combat: { currentHp: 30, injuries: 0, conditions: ['Poisoned'] },
  combatStages: { acc: 0 },
  player: true,
})

const playerAAssignment = {
  playerId: PLAYER_A_ID,
  displayName: PLAYER_A_DISPLAY_NAME,
  controllableResources: [tokenResource, sheetResource],
  visibleResources: [{ kind: 'map', mapSlug: 'arena-map' }, tokenResource, sheetResource],
  updatedAt: CREATED_AT,
  updatedByClientId: GM_CLIENT_ID,
} as const satisfies PlayerAssignmentRecord

const playerBViewOnlyAssignment = {
  playerId: PLAYER_B_ID,
  displayName: PLAYER_B_DISPLAY_NAME,
  controllableResources: [],
  visibleResources: [{ kind: 'map', mapSlug: 'arena-map' }, tokenResource, sheetResource],
  updatedAt: CREATED_AT,
  updatedByClientId: GM_CLIENT_ID,
} as const satisfies PlayerAssignmentRecord

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
      playerId: PLAYER_A_ID,
      displayName: PLAYER_A_DISPLAY_NAME,
      joinedAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
    {
      playerId: PLAYER_B_ID,
      displayName: PLAYER_B_DISPLAY_NAME,
      joinedAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
  ],
  assignments: [playerAAssignment, playerBViewOnlyAssignment],
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
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

const playerAHello = (
  overrides: Partial<SessionClientHelloMessage> = {},
): SessionClientHelloMessage => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'hello',
  direction: 'client',
  sessionId: SESSION_ID,
  identity: {
    role: 'player',
    clientId: PLAYER_A_CLIENT_ID,
    playerId: PLAYER_A_ID,
    displayName: PLAYER_A_DISPLAY_NAME,
  },
  reconnect: false,
  ...overrides,
})

const playerBHello = (): SessionClientHelloMessage => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'hello',
  direction: 'client',
  sessionId: SESSION_ID,
  identity: {
    role: 'player',
    clientId: PLAYER_B_CLIENT_ID,
    playerId: PLAYER_B_ID,
    displayName: PLAYER_B_DISPLAY_NAME,
  },
  reconnect: false,
})

const moveCommandMessage = (
  opId = MOVE_OP_ID,
  baseRevision = INITIAL_SESSION_REVISION,
  to = { x: 2, y: 0, z: 2 },
  actor = playerAActor,
): SessionCommandMessage<MoveTokenCommand> => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'command',
  direction: 'client',
  sessionId: SESSION_ID,
  command: {
    schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
    sessionId: SESSION_ID,
    actor,
    type: MOVE_TOKEN_COMMAND_TYPE,
    opId,
    baseRevision,
    scopes: [createMoveTokenCommandScope(tokenResource)],
    payload: {
      tokenId: 'token-pikachu',
      to,
    },
    metadata: {
      traceId: `trace-${opId}`,
    },
  },
})

const turnCommandMessage = (): SessionCommandMessage<TurnTokenCommand> => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'command',
  direction: 'client',
  sessionId: SESSION_ID,
  command: {
    schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
    sessionId: SESSION_ID,
    actor: gmActor,
    type: TURN_TOKEN_COMMAND_TYPE,
    opId: TURN_OP_ID,
    baseRevision: parseSessionRevision(1),
    scopes: [createTurnTokenCommandScope(tokenResource)],
    payload: {
      tokenId: 'token-pikachu',
      facing: 'north-west',
    },
    metadata: {
      traceId: 'trace-audit-turn',
    },
  },
})

const modifyHpCommandMessage = (): SessionCommandMessage<ModifyHpCommand> => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'command',
  direction: 'client',
  sessionId: SESSION_ID,
  command: {
    schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
    sessionId: SESSION_ID,
    actor: playerAActor,
    type: MODIFY_HP_COMMAND_TYPE,
    opId: HP_OP_ID,
    baseRevision: parseSessionRevision(2),
    scopes: [
      createModifyHpTokenCommandScope(tokenResource),
      createModifyHpSheetCommandScope(sheetResource),
    ],
    payload: {
      tokenId: 'token-pikachu',
      currentHp: 18,
      injuries: 1,
    },
    metadata: {
      traceId: 'trace-audit-hp',
    },
  },
})

const modifyConditionsCommandMessage = (): SessionCommandMessage<ModifyConditionsCommand> => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'command',
  direction: 'client',
  sessionId: SESSION_ID,
  command: {
    schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
    sessionId: SESSION_ID,
    actor: playerAActor,
    type: MODIFY_CONDITIONS_COMMAND_TYPE,
    opId: CONDITIONS_OP_ID,
    baseRevision: parseSessionRevision(3),
    scopes: [
      createModifyConditionsTokenCommandScope(tokenResource),
      createModifyConditionsSheetCommandScope(sheetResource),
    ],
    payload: {
      tokenId: 'token-pikachu',
      action: 'replace',
      conditions: ['Burned'],
    },
    metadata: {
      traceId: 'trace-audit-conditions',
    },
  },
})

const nextInitiativeCommandMessage = (): SessionCommandMessage<NextInitiativeCommand> => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'command',
  direction: 'client',
  sessionId: SESSION_ID,
  command: {
    schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
    sessionId: SESSION_ID,
    actor: gmActor,
    type: NEXT_INITIATIVE_COMMAND_TYPE,
    opId: INITIATIVE_OP_ID,
    baseRevision: parseSessionRevision(4),
    scopes: [createInitiativeCommandScope('arena-map')],
    payload: { mapSlug: 'arena-map' },
    metadata: {
      traceId: 'trace-audit-initiative',
    },
  },
})

const expectAcceptedFanout = (input: {
  readonly sender: FakePeer
  readonly recipients: readonly FakePeer[]
  readonly otherSessionPeer: FakePeer
  readonly expectedRevision: number
  readonly expectedCommandType: string
  readonly expectedEventType: string
}): { readonly ack: unknown, readonly patch: unknown } => {
  expect(input.sender.closed).toEqual([])
  for (const recipient of input.recipients) expect(recipient.closed).toEqual([])
  expect(input.otherSessionPeer.closed).toEqual([])
  expect(input.sender.sent).toHaveLength(2)
  for (const recipient of input.recipients) expect(recipient.sent).toHaveLength(1)
  expect(input.otherSessionPeer.sent).toEqual([])

  const ack = parseSentJson(input.sender, 0)
  expect(ack).toMatchObject({
    schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
    type: 'commandAck',
    direction: 'server',
    sessionId: SESSION_ID,
    result: {
      status: 'accepted',
      accepted: true,
      commandType: input.expectedCommandType,
      currentRevision: parseSessionRevision(input.expectedRevision),
      event: {
        eventType: input.expectedEventType,
        revision: parseSessionRevision(input.expectedRevision),
      },
    },
  })

  const patch = parseSentJson(input.sender, 1)
  for (const recipient of input.recipients) {
    expect(parseSentJson(recipient, 0)).toEqual(patch)
  }
  expect(patch).toMatchObject({
    schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
    type: 'patch',
    direction: 'server',
    sessionId: SESSION_ID,
    event: {
      eventType: input.expectedEventType,
      commandType: input.expectedCommandType,
      revision: parseSessionRevision(input.expectedRevision),
    },
  })
  const patchText = JSON.stringify(patch)
  expect(patchText).not.toContain('placements')
  expect(patchText).not.toContain('voxels')
  expect(patchText).not.toContain('fieldEffects')

  return { ack, patch }
}

describe('integrated multi-client command flow', () => {
  it('audits accepted commands, reconnect snapshot fallback, permission denial, and stale conflict handling', () => {
    const registry = createInMemorySessionSocketRegistry()
    const peers = createInMemorySessionSocketPeerRegistry()
    const store = createInMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>()
    const operationTracker = createInMemorySessionOperationTracker()
    const initialState = createState()
    store.create({
      sessionId: SESSION_ID,
      joinCode: JOIN_CODE,
      gmKey: GM_KEY,
      revision: initialState.revision,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      state: initialState,
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
        directoryPath: '/tmp/rotom-session-audit',
        filePath: '/tmp/rotom-session-audit/snapshot.json',
        snapshot: createPersistedSessionSnapshot(nextState, options),
        bytesWritten: 1,
      }
    }
    let sheet = createPokemonSheet()
    const sheetWrites: Record<string, unknown>[] = []
    const readSheet = (kind: SheetKind, slug: string) => {
      if (kind !== 'pokemon' || slug !== 'pikachu') return null
      return {
        path: '/tmp/pikachu.json',
        sheet: clone(sheet),
      }
    }
    const writeSheet = (_path: string, nextSheet: Record<string, unknown>) => {
      sheetWrites.push(clone(nextSheet))
      sheet = clone(nextSheet) as unknown as CharacterSheet
    }

    const dependencies: SessionSocketHandlerDependencies<TabletopMapV2> = {
      env: enabledEnv,
      registry,
      peers,
      store,
      moveTokenCommandDependencies: { operationTracker, writeSnapshot },
      turnTokenCommandDependencies: { operationTracker, writeSnapshot },
      modifyHpCommandDependencies: { operationTracker, writeSnapshot, readSheet, writeSheet },
      modifyConditionsCommandDependencies: { operationTracker, writeSnapshot, readSheet, writeSheet },
      initiativeCommandDependencies: { operationTracker, writeSnapshot },
    }

    const gmPeer = makePeer('peer-audit-gm')
    const playerAPeer = makePeer('peer-audit-player-a')
    const playerBPeer = makePeer('peer-audit-player-b')
    const otherPeer = makePeer('peer-audit-other-session')

    handleSessionSocketOpen(gmPeer, { ...dependencies, clock: () => '2026-05-26T20:00:01.000Z' })
    handleSessionSocketMessage(gmPeer, { text: () => JSON.stringify(gmHello()) }, {
      ...dependencies,
      clock: () => '2026-05-26T20:00:02.000Z',
    })
    handleSessionSocketOpen(playerAPeer, { ...dependencies, clock: () => '2026-05-26T20:00:03.000Z' })
    handleSessionSocketMessage(playerAPeer, { text: () => JSON.stringify(playerAHello()) }, {
      ...dependencies,
      clock: () => '2026-05-26T20:00:04.000Z',
    })
    handleSessionSocketOpen(playerBPeer, { ...dependencies, clock: () => '2026-05-26T20:00:05.000Z' })
    handleSessionSocketMessage(playerBPeer, { text: () => JSON.stringify(playerBHello()) }, {
      ...dependencies,
      clock: () => '2026-05-26T20:00:06.000Z',
    })
    handleSessionSocketOpen(otherPeer, { ...dependencies, clock: () => '2026-05-26T20:00:07.000Z' })
    handleSessionSocketMessage(otherPeer, {
      text: () => JSON.stringify(gmHello(OTHER_SESSION_ID, OTHER_GM_KEY, OTHER_GM_CLIENT_ID)),
    }, {
      ...dependencies,
      clock: () => '2026-05-26T20:00:08.000Z',
    })
    clearSent(gmPeer, playerAPeer, playerBPeer, otherPeer)

    handleSessionSocketMessage(playerAPeer, { text: () => JSON.stringify(moveCommandMessage()) }, {
      ...dependencies,
      clock: () => '2026-05-26T20:00:10.000Z',
    })
    const moveResult = expectAcceptedFanout({
      sender: playerAPeer,
      recipients: [gmPeer, playerBPeer],
      otherSessionPeer: otherPeer,
      expectedRevision: 1,
      expectedCommandType: MOVE_TOKEN_COMMAND_TYPE,
      expectedEventType: 'tokenMoved',
    })
    expect(moveResult.patch).toMatchObject({
      event: {
        payload: {
          tokenId: 'token-pikachu',
          from: { x: 1, y: 0, z: 1 },
          to: { x: 2, y: 0, z: 2 },
        },
      },
    })
    clearSent(gmPeer, playerAPeer, playerBPeer, otherPeer)

    handleSessionSocketMessage(gmPeer, { text: () => JSON.stringify(turnCommandMessage()) }, {
      ...dependencies,
      clock: () => '2026-05-26T20:00:20.000Z',
    })
    const turnResult = expectAcceptedFanout({
      sender: gmPeer,
      recipients: [playerAPeer, playerBPeer],
      otherSessionPeer: otherPeer,
      expectedRevision: 2,
      expectedCommandType: TURN_TOKEN_COMMAND_TYPE,
      expectedEventType: 'tokenTurned',
    })
    expect(turnResult.patch).toMatchObject({
      event: {
        payload: {
          tokenId: 'token-pikachu',
          from: 'south-east',
          to: 'north-west',
          turned: true,
        },
      },
    })
    clearSent(gmPeer, playerAPeer, playerBPeer, otherPeer)

    handleSessionSocketMessage(playerAPeer, { text: () => JSON.stringify(modifyHpCommandMessage()) }, {
      ...dependencies,
      clock: () => '2026-05-26T20:00:30.000Z',
    })
    const hpResult = expectAcceptedFanout({
      sender: playerAPeer,
      recipients: [gmPeer, playerBPeer],
      otherSessionPeer: otherPeer,
      expectedRevision: 3,
      expectedCommandType: MODIFY_HP_COMMAND_TYPE,
      expectedEventType: 'hpModified',
    })
    expect(hpResult.patch).toMatchObject({
      event: {
        payload: {
          tokenId: 'token-pikachu',
          previous: { currentHp: 30, injuries: 0 },
          current: { currentHp: 18, injuries: 1 },
        },
      },
    })
    clearSent(gmPeer, playerAPeer, playerBPeer, otherPeer)

    handleSessionSocketMessage(playerAPeer, { text: () => JSON.stringify(modifyConditionsCommandMessage()) }, {
      ...dependencies,
      clock: () => '2026-05-26T20:00:40.000Z',
    })
    const conditionsResult = expectAcceptedFanout({
      sender: playerAPeer,
      recipients: [gmPeer, playerBPeer],
      otherSessionPeer: otherPeer,
      expectedRevision: 4,
      expectedCommandType: MODIFY_CONDITIONS_COMMAND_TYPE,
      expectedEventType: 'conditionsModified',
    })
    expect(conditionsResult.patch).toMatchObject({
      event: {
        payload: {
          tokenId: 'token-pikachu',
          previous: ['Poisoned'],
          current: ['Burned'],
        },
      },
    })
    clearSent(gmPeer, playerAPeer, playerBPeer, otherPeer)

    handleSessionSocketMessage(gmPeer, { text: () => JSON.stringify(nextInitiativeCommandMessage()) }, {
      ...dependencies,
      clock: () => '2026-05-26T20:00:50.000Z',
    })
    const initiativeResult = expectAcceptedFanout({
      sender: gmPeer,
      recipients: [playerAPeer, playerBPeer],
      otherSessionPeer: otherPeer,
      expectedRevision: 5,
      expectedCommandType: NEXT_INITIATIVE_COMMAND_TYPE,
      expectedEventType: 'initiativeUpdated',
    })
    expect(initiativeResult.patch).toMatchObject({
      event: {
        payload: {
          previous: { activeId: 'token-pikachu', round: 1 },
          current: { activeId: 'token-bulbasaur', round: 1 },
        },
      },
    })
    clearSent(gmPeer, playerAPeer, playerBPeer, otherPeer)

    handleSessionSocketMessage(playerBPeer, {
      text: () => JSON.stringify(moveCommandMessage(
        UNAUTHORIZED_OP_ID,
        parseSessionRevision(5),
        { x: 3, y: 0, z: 2 },
        playerBActor,
      )),
    }, {
      ...dependencies,
      clock: () => '2026-05-26T20:01:00.000Z',
    })
    expect(playerBPeer.sent).toHaveLength(1)
    expect(parseSentJson(playerBPeer)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'commandReject',
      direction: 'server',
      sessionId: SESSION_ID,
      result: {
        status: 'rejected',
        reason: 'unauthorized',
        commandType: MOVE_TOKEN_COMMAND_TYPE,
        currentRevision: parseSessionRevision(5),
      },
    })
    expect(gmPeer.sent).toEqual([])
    expect(playerAPeer.sent).toEqual([])
    expect(otherPeer.sent).toEqual([])
    clearSent(gmPeer, playerAPeer, playerBPeer, otherPeer)

    handleSessionSocketMessage(playerAPeer, {
      text: () => JSON.stringify(moveCommandMessage(
        STALE_OP_ID,
        INITIAL_SESSION_REVISION,
        { x: 5, y: 0, z: 2 },
        playerAActor,
      )),
    }, {
      ...dependencies,
      clock: () => '2026-05-26T20:01:10.000Z',
    })
    expect(playerAPeer.sent).toHaveLength(1)
    expect(parseSentJson(playerAPeer)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'commandReject',
      direction: 'server',
      sessionId: SESSION_ID,
      result: {
        status: 'rejected',
        reason: 'stale',
        commandType: MOVE_TOKEN_COMMAND_TYPE,
        currentRevision: parseSessionRevision(5),
        baseRevision: INITIAL_SESSION_REVISION,
        currentState: {
          tokenId: 'token-pikachu',
          mapSlug: 'arena-map',
          position: { x: 2, y: 0, z: 2 },
        },
      },
    })
    expect(gmPeer.sent).toEqual([])
    expect(playerBPeer.sent).toEqual([])
    expect(otherPeer.sent).toEqual([])

    expect(snapshotCalls.map((entry) => entry.revision)).toEqual([
      parseSessionRevision(1),
      parseSessionRevision(2),
      parseSessionRevision(3),
      parseSessionRevision(4),
      parseSessionRevision(5),
    ])
    expect(sheetWrites).toHaveLength(2)
    expect(sheet.combat).toMatchObject({
      currentHp: 18,
      injuries: 1,
      conditions: ['Burned'],
    })

    const storedState = store.get(SESSION_ID)?.state
    expect(storedState).toBeDefined()
    expect(storedState?.revision).toBe(parseSessionRevision(5))
    const storedMap = getSessionMapState(storedState!, 'arena-map')
    expect(storedMap?.revision).toBe(parseMapRevision(5))
    expect(storedMap?.document.placements.find((placement) => placement.id === 'token-pikachu'))
      .toMatchObject({
        position: { x: 2, y: 0, z: 2 },
        facing: 'north-west',
        turned: true,
      })
    expect(storedMap?.document.initiative).toEqual({ activeId: 'token-bulbasaur', round: 1 })
    expect(store.get(OTHER_SESSION_ID)?.revision).toBe(INITIAL_SESSION_REVISION)
    expect(registry.get('peer-audit-gm')).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      currentRevision: parseSessionRevision(5),
    })
    expect(registry.get('peer-audit-player-a')).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      currentRevision: parseSessionRevision(5),
    })
    expect(registry.get('peer-audit-player-b')).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      currentRevision: parseSessionRevision(5),
    })
    expect(registry.get('peer-audit-other-session')).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      currentRevision: INITIAL_SESSION_REVISION,
    })

    clearSent(gmPeer, playerAPeer, playerBPeer, otherPeer)
    const reconnectPeer = makePeer('peer-audit-player-a-reconnect')
    handleSessionSocketOpen(reconnectPeer, {
      env: enabledEnv,
      registry,
      store,
      clock: () => '2026-05-26T20:01:20.000Z',
    })
    handleSessionSocketMessage(reconnectPeer, {
      text: () => JSON.stringify(playerAHello({
        reconnect: true,
        lastSeenRevision: INITIAL_SESSION_REVISION,
      })),
    }, {
      env: enabledEnv,
      registry,
      store,
      clock: () => '2026-05-26T20:01:21.000Z',
    })

    expect(reconnectPeer.closed).toEqual([])
    expect(parseSentJson(reconnectPeer, 0)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'hello',
      direction: 'server',
      sessionId: SESSION_ID,
      currentRevision: parseSessionRevision(5),
      resumed: true,
      snapshotRequired: true,
    })
    expect(parseSentJson(reconnectPeer, 1)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'snapshot',
      direction: 'server',
      sessionId: SESSION_ID,
      reason: 'reconnect',
      currentRevision: parseSessionRevision(5),
      replayAvailable: false,
      snapshot: {
        sessionId: SESSION_ID,
        revision: parseSessionRevision(5),
        selectedMapSlug: 'arena-map',
        maps: [
          {
            mapSlug: 'arena-map',
            revision: parseMapRevision(5),
            document: {
              slug: 'arena-map',
              initiative: { activeId: 'token-bulbasaur', round: 1 },
            },
          },
        ],
        players: [
          {
            playerId: PLAYER_A_ID,
            displayName: PLAYER_A_DISPLAY_NAME,
          },
        ],
        assignments: [
          {
            playerId: PLAYER_A_ID,
            displayName: PLAYER_A_DISPLAY_NAME,
          },
        ],
      },
    })
    const snapshotText = JSON.stringify(parseSentJson(reconnectPeer, 1))
    expect(snapshotText).not.toContain(String(GM_KEY))
    expect(snapshotText).not.toContain(String(JOIN_CODE))
    expect(snapshotText).not.toContain(String(PLAYER_B_ID))
    expect(snapshotText).not.toContain('Misty')
    expect(gmPeer.sent).toEqual([])
    expect(playerAPeer.sent).toEqual([])
    expect(playerBPeer.sent).toEqual([])
    expect(otherPeer.sent).toEqual([])
  })
})
