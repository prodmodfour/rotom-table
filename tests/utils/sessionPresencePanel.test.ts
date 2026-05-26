import { describe, expect, it } from 'vitest'
import {
  SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  type SessionClientIdentity,
} from '#shared/sessionClientIdentity'
import {
  parseClientId,
  parseGmKey,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
} from '#shared/sessionIdentity'
import {
  parseSessionRevision,
  type SessionRevision,
} from '#shared/sessionRevisions'
import {
  createAuthoritativeSessionState,
  type AuthoritativeSessionState,
} from '#shared/sessionState'
import {
  SESSION_MESSAGE_SCHEMA_VERSION,
  type SessionPresenceMessage,
  type SessionSnapshotMessage,
} from '#shared/sessionMessages'
import { buildSessionPresencePanelModel } from '~/utils/sessionPresencePanel'

const SESSION_ID = parseSessionId('session_abcdefghijkl')
const OTHER_SESSION_ID = parseSessionId('session_bcdefghijklm')
const GM_CLIENT_ID = parseClientId('client_gmclient01')
const ALICE_CLIENT_ID = parseClientId('client_alice001')
const BOB_CLIENT_ID = parseClientId('client_bob00001')
const GM_KEY = parseGmKey('gmkey_abcdefghijklmnopqrstuvwx')
const ALICE_ID = parsePlayerId('player_alice000')
const BOB_ID = parsePlayerId('player_bob00000')
const ALICE = parseSessionDisplayName('Alice')
const BOB = parseSessionDisplayName('Bob')
const REVISION_1 = parseSessionRevision(1)
const REVISION_2 = parseSessionRevision(2)
const REVISION_3 = parseSessionRevision(3)

const NOW = '2026-05-26T12:00:00.000Z'

const gmIdentity = (): Extract<SessionClientIdentity, { role: 'gm' }> => ({
  schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  role: 'gm',
  sessionId: SESSION_ID,
  clientId: GM_CLIENT_ID,
  gmKey: GM_KEY,
  rememberedAt: NOW,
  lastSeenRevision: REVISION_1,
})

const aliceIdentity = (): Extract<SessionClientIdentity, { role: 'player' }> => ({
  schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  role: 'player',
  sessionId: SESSION_ID,
  clientId: ALICE_CLIENT_ID,
  playerId: ALICE_ID,
  displayName: ALICE,
  rememberedAt: NOW,
  lastSeenRevision: REVISION_1,
})

const fullSnapshotState = (): AuthoritativeSessionState => createAuthoritativeSessionState({
  sessionId: SESSION_ID,
  revision: REVISION_2,
  createdAt: NOW,
  updatedAt: NOW,
  players: [
    { playerId: ALICE_ID, displayName: ALICE, joinedAt: NOW, updatedAt: NOW },
    { playerId: BOB_ID, displayName: BOB, joinedAt: NOW, updatedAt: NOW },
  ],
  connectedClients: [
    {
      clientId: GM_CLIENT_ID,
      actor: { role: 'gm', clientId: GM_CLIENT_ID },
      status: 'connected',
      connectedAt: NOW,
      lastSeenAt: NOW,
      lastSeenRevision: REVISION_2,
    },
    {
      clientId: ALICE_CLIENT_ID,
      actor: { role: 'player', playerId: ALICE_ID, clientId: ALICE_CLIENT_ID, displayName: ALICE },
      status: 'disconnected',
      connectedAt: NOW,
      lastSeenAt: NOW,
      lastSeenRevision: REVISION_1,
    },
  ],
  assignments: [
    {
      playerId: ALICE_ID,
      displayName: ALICE,
      controllableResources: [
        { kind: 'token', tokenId: 'token-pikachu', mapSlug: 'arena-map' },
        { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu' },
      ],
      visibleResources: [
        { kind: 'map', mapSlug: 'arena-map' },
        { kind: 'token', tokenId: 'token-pikachu', mapSlug: 'arena-map' },
      ],
      updatedAt: NOW,
      updatedByClientId: GM_CLIENT_ID,
    },
    {
      playerId: BOB_ID,
      displayName: BOB,
      controllableResources: [],
      visibleResources: [{ kind: 'map', mapSlug: 'arena-map' }],
      updatedAt: NOW,
      updatedByClientId: GM_CLIENT_ID,
    },
  ],
})

const snapshotMessage = (
  snapshot: AuthoritativeSessionState,
  currentRevision: SessionRevision = REVISION_2,
): SessionSnapshotMessage<unknown, SessionRevision> => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'snapshot',
  direction: 'server',
  sessionId: SESSION_ID,
  reason: 'reconnect',
  currentRevision,
  snapshot,
  replayAvailable: false,
})

const presenceMessage = (): SessionPresenceMessage<SessionRevision> => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'presence',
  direction: 'server',
  sessionId: SESSION_ID,
  change: 'joined',
  currentRevision: REVISION_3,
  clients: [
    {
      actor: { role: 'gm', clientId: GM_CLIENT_ID },
      clientId: GM_CLIENT_ID,
      status: 'connected',
      connectedAt: NOW,
      lastSeenAt: NOW,
      lastSeenRevision: REVISION_3,
    },
    {
      actor: { role: 'player', playerId: ALICE_ID, clientId: ALICE_CLIENT_ID, displayName: ALICE },
      clientId: ALICE_CLIENT_ID,
      status: 'connected',
      connectedAt: NOW,
      lastSeenAt: NOW,
      lastSeenRevision: REVISION_3,
    },
    {
      actor: { role: 'player', playerId: BOB_ID, clientId: BOB_CLIENT_ID, displayName: BOB },
      clientId: BOB_CLIENT_ID,
      status: 'connected',
      connectedAt: NOW,
      lastSeenAt: NOW,
      lastSeenRevision: REVISION_3,
    },
  ],
})

describe('buildSessionPresencePanelModel', () => {
  it('summarizes GM-visible player presence and assigned controls', () => {
    const model = buildSessionPresencePanelModel({
      identity: gmIdentity(),
      snapshot: snapshotMessage(fullSnapshotState()),
      presence: presenceMessage(),
    })

    expect(model).not.toBeNull()
    expect(model?.actorRoleLabel).toBe('GM')
    expect(model?.connectedPlayerCount).toBe(2)
    expect(model?.connectedClientCount).toBe(3)
    expect(model?.currentRevision).toBe(REVISION_3)
    expect(model?.participants.map((participant) => participant.displayName)).toEqual(['GM', 'Alice', 'Bob'])
    expect(model?.participants.find((participant) => participant.displayName === 'Alice')).toMatchObject({
      role: 'player',
      status: 'connected',
      connectedClientCount: 1,
      controls: {
        tokenCount: 1,
        sheetCount: 1,
        visibleMapCount: 1,
        label: '1 token · 1 sheet',
      },
    })
    expect(model?.selfParticipant).toMatchObject({
      role: 'gm',
      displayName: 'GM',
      controls: { label: 'GM authority' },
    })
  })

  it('keeps player-filtered assignment data safe while still showing presence rows', () => {
    const fullState = fullSnapshotState()
    const playerSnapshot = createAuthoritativeSessionState({
      sessionId: SESSION_ID,
      revision: REVISION_2,
      createdAt: NOW,
      updatedAt: NOW,
      players: fullState.players.filter((player) => player.playerId === ALICE_ID),
      connectedClients: fullState.connectedClients.filter((client) => client.clientId === ALICE_CLIENT_ID),
      assignments: fullState.assignments.filter((assignment) => assignment.playerId === ALICE_ID),
    })

    const model = buildSessionPresencePanelModel({
      identity: aliceIdentity(),
      snapshot: snapshotMessage(playerSnapshot),
      presence: presenceMessage(),
    })

    expect(model?.actorRoleLabel).toBe('Player')
    expect(model?.selfParticipant).toMatchObject({
      displayName: 'Alice',
      isSelf: true,
      controls: { label: '1 token · 1 sheet' },
    })
    expect(model?.participants.find((participant) => participant.displayName === 'GM')).toMatchObject({
      role: 'gm',
      status: 'connected',
      controls: { label: 'GM authority' },
    })
    expect(model?.participants.find((participant) => participant.displayName === 'Bob')).toMatchObject({
      role: 'player',
      status: 'connected',
      controls: { label: 'Assignment hidden' },
    })
  })

  it('uses the latest presence frame to override older snapshot liveness', () => {
    const model = buildSessionPresencePanelModel({
      identity: gmIdentity(),
      snapshot: snapshotMessage(fullSnapshotState()),
      presence: presenceMessage(),
    })

    const alice = model?.participants.find((participant) => participant.displayName === 'Alice')
    expect(alice?.status).toBe('connected')
    expect(alice?.connectedClientCount).toBe(1)
  })

  it('returns only the remembered actor when session frames are missing or scoped elsewhere', () => {
    expect(buildSessionPresencePanelModel({ identity: null, snapshot: null, presence: null })).toBeNull()

    const mismatchedPresence: SessionPresenceMessage<SessionRevision> = {
      ...presenceMessage(),
      sessionId: OTHER_SESSION_ID,
    }
    const model = buildSessionPresencePanelModel({
      identity: aliceIdentity(),
      snapshot: null,
      presence: mismatchedPresence,
    })

    expect(model).toMatchObject({
      sessionId: SESSION_ID,
      connectedClientCount: 0,
      connectedPlayerCount: 0,
      participants: [
        {
          displayName: 'Alice',
          isSelf: true,
          status: 'disconnected',
          controls: { label: 'No controls assigned' },
        },
      ],
    })
  })
})
