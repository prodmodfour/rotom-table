import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  INITIAL_SESSION_REVISION,
  parseMapRevision,
  parseSessionRevision,
  type MapRevision,
} from '#shared/sessionRevisions'
import {
  parseClientId,
  parsePlayerId,
  parseSessionId,
  sanitizeSessionDisplayName,
} from '#shared/sessionIdentity'
import type {
  GmSessionActor,
  PlayerAssignmentRecord,
  PlayerSessionActor,
} from '#shared/sessionPermissions'
import {
  SESSION_STATE_SCHEMA_VERSION,
  createAuthoritativeSessionMapState,
  createAuthoritativeSessionState,
  findSessionConnectedClient,
  findSessionPlayerRecord,
  getSelectedSessionMapState,
  getSessionMapState,
  setSelectedSessionMapSlug,
  toSessionPresenceEntries,
  upsertSessionConnectedClient,
  upsertSessionMapState,
  upsertSessionPlayerAssignment,
  upsertSessionPlayerRecord,
  type AuthoritativeSessionMapState,
  type AuthoritativeSessionState,
  type SessionConnectedClientRecord,
  type SessionPlayerRecord,
} from '#shared/sessionState'

interface MapDocumentFixture {
  readonly slug: string
  readonly name: string
  readonly tokens: readonly string[]
}

const sessionId = parseSessionId('session_state0000001')
const playerId = parsePlayerId('player_state0001')
const otherPlayerId = parsePlayerId('player_state0002')
const gmClientId = parseClientId('client_stateGM01')
const playerClientId = parseClientId('client_statePL01')
const otherClientId = parseClientId('client_statePL02')
const displayName = sanitizeSessionDisplayName('State Player')
const otherDisplayName = sanitizeSessionDisplayName('Other State Player')
const createdAt = '2026-05-25T02:00:00.000Z'
const updatedAt = '2026-05-25T02:05:00.000Z'

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

const viridianMap = createAuthoritativeSessionMapState<MapDocumentFixture>({
  mapSlug: 'viridian-gym',
  revision: parseMapRevision(2),
  document: {
    slug: 'viridian-gym',
    name: 'Viridian Gym',
    tokens: ['token-pikachu'],
  },
})

const pewterMap = createAuthoritativeSessionMapState<MapDocumentFixture>({
  mapSlug: 'pewter-gym',
  document: {
    slug: 'pewter-gym',
    name: 'Pewter Gym',
    tokens: [],
  },
})

const playerRecord: SessionPlayerRecord = {
  playerId,
  displayName,
  joinedAt: '2026-05-25T02:01:00.000Z',
  updatedAt: '2026-05-25T02:01:00.000Z',
}

const otherPlayerRecord: SessionPlayerRecord = {
  playerId: otherPlayerId,
  displayName: otherDisplayName,
  joinedAt: '2026-05-25T02:02:00.000Z',
  updatedAt: '2026-05-25T02:02:00.000Z',
}

const gmClient: SessionConnectedClientRecord = {
  clientId: gmClientId,
  actor: gmActor,
  status: 'connected',
  connectedAt: '2026-05-25T02:00:30.000Z',
  lastSeenRevision: parseSessionRevision(0),
}

const playerClient: SessionConnectedClientRecord = {
  clientId: playerClientId,
  actor: playerActor,
  status: 'connected',
  connectedAt: '2026-05-25T02:01:30.000Z',
  lastSeenAt: '2026-05-25T02:02:30.000Z',
  lastSeenRevision: parseSessionRevision(1),
}

const assignment: PlayerAssignmentRecord = {
  playerId,
  displayName,
  controllableResources: [
    {
      kind: 'token',
      tokenId: 'token-pikachu',
      mapSlug: 'viridian-gym',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
    },
  ],
  visibleResources: [
    { kind: 'map', mapSlug: 'viridian-gym' },
    {
      kind: 'token',
      tokenId: 'token-pikachu',
      mapSlug: 'viridian-gym',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
    },
  ],
  updatedAt: '2026-05-25T02:03:00.000Z',
  updatedByClientId: gmClientId,
}

const createState = (
  overrides: Partial<Parameters<typeof createAuthoritativeSessionState<MapDocumentFixture>>[0]> = {},
): AuthoritativeSessionState<MapDocumentFixture> =>
  createAuthoritativeSessionState<MapDocumentFixture>({
    sessionId,
    createdAt,
    ...overrides,
  })

describe('authoritative session state model', () => {
  it('models selected maps, revisions, clients, players, and assignments in one session state', () => {
    const state = createState({
      selectedMapSlug: 'viridian-gym',
      maps: [viridianMap, pewterMap],
      connectedClients: [playerClient, gmClient],
      players: [playerRecord],
      assignments: [assignment],
    })

    expect(state).toMatchObject({
      schemaVersion: SESSION_STATE_SCHEMA_VERSION,
      sessionId,
      revision: INITIAL_SESSION_REVISION,
      selectedMapSlug: 'viridian-gym',
      createdAt,
      updatedAt: createdAt,
    })
    expect(state.maps.map((map) => map.mapSlug)).toEqual(['pewter-gym', 'viridian-gym'])
    expect(state.connectedClients.map((client) => client.clientId)).toEqual([
      gmClientId,
      playerClientId,
    ])
    expect(state.players).toEqual([playerRecord])
    expect(state.assignments).toEqual([assignment])
    expect(getSelectedSessionMapState(state)?.document.tokens).toEqual(['token-pikachu'])
    expect(getSessionMapState(state, 'pewter-gym')?.revision).toBe(0)

    const presence = toSessionPresenceEntries(state)
    expect(presence).toMatchObject([
      {
        actor: gmActor,
        clientId: gmClientId,
        status: 'connected',
        connectedAt: gmClient.connectedAt,
        lastSeenRevision: 0,
      },
      {
        actor: playerActor,
        clientId: playerClientId,
        status: 'connected',
        connectedAt: playerClient.connectedAt,
        lastSeenAt: playerClient.lastSeenAt,
        lastSeenRevision: 1,
      },
    ])

    const roundTripped = JSON.parse(JSON.stringify(state)) as AuthoritativeSessionState<MapDocumentFixture>
    expect(roundTripped.selectedMapSlug).toBe('viridian-gym')
    expect(roundTripped.revision).toBe(0)
    expect(roundTripped.maps[1]?.document.slug).toBe('viridian-gym')

    expectTypeOf(state).toMatchTypeOf<AuthoritativeSessionState<MapDocumentFixture>>()
    expectTypeOf(state.maps[0]).toMatchTypeOf<AuthoritativeSessionMapState<MapDocumentFixture>>()
    expectTypeOf(state.maps[0]?.revision).toMatchTypeOf<MapRevision>()
  })

  it('defaults selected map safely and rejects duplicate or unknown state keys', () => {
    const defaultSelected = createState({ maps: [viridianMap, pewterMap] })
    const lobbyOnly = createState()

    expect(defaultSelected.selectedMapSlug).toBe('viridian-gym')
    expect(lobbyOnly.selectedMapSlug).toBeNull()
    expect(getSelectedSessionMapState(lobbyOnly)).toBeUndefined()

    expect(() =>
      createState({
        selectedMapSlug: 'cerulean-gym',
        maps: [viridianMap],
      }),
    ).toThrow('Selected map "cerulean-gym" is not present in authoritative session map state')

    expect(() =>
      createState({
        maps: [viridianMap, { ...viridianMap, document: { ...viridianMap.document } }],
      }),
    ).toThrow('Duplicate map slug "viridian-gym" in authoritative session state')

    expect(() =>
      createState({
        connectedClients: [gmClient, { ...gmClient, status: 'reconnecting' }],
      }),
    ).toThrow('Duplicate client id "client_stateGM01" in authoritative session state')

    expect(() =>
      createState({
        players: [playerRecord, { ...playerRecord, updatedAt }],
      }),
    ).toThrow('Duplicate player id "player_state0001" in authoritative session state')

    expect(() =>
      createState({
        assignments: [assignment, { ...assignment, updatedAt }],
      }),
    ).toThrow('Duplicate player assignment "player_state0001" in authoritative session state')

    expect(() => createAuthoritativeSessionMapState({ mapSlug: ' ', document: {} })).toThrow(
      'map slug must be a non-empty string',
    )
  })

  it('upserts maps, players, clients, and assignments without advancing revision implicitly', () => {
    const initial = createState()
    const withMap = upsertSessionMapState(initial, viridianMap, { updatedAt })
    const withPlayer = upsertSessionPlayerRecord(withMap, otherPlayerRecord, {
      updatedAt: '2026-05-25T02:06:00.000Z',
    })
    const otherClient: SessionConnectedClientRecord = {
      clientId: otherClientId,
      actor: {
        role: 'player',
        playerId: otherPlayerId,
        clientId: otherClientId,
        displayName: otherDisplayName,
      },
      status: 'connected',
      connectedAt: '2026-05-25T02:06:30.000Z',
      lastSeenRevision: parseSessionRevision(0),
    }
    const withClient = upsertSessionConnectedClient(withPlayer, otherClient, {
      updatedAt: '2026-05-25T02:07:00.000Z',
    })
    const withAssignment = upsertSessionPlayerAssignment(withClient, assignment, {
      updatedAt: '2026-05-25T02:08:00.000Z',
    })

    expect(initial.maps).toEqual([])
    expect(withMap.selectedMapSlug).toBe('viridian-gym')
    expect(withAssignment.revision).toBe(INITIAL_SESSION_REVISION)
    expect(withAssignment.updatedAt).toBe('2026-05-25T02:08:00.000Z')
    expect(findSessionPlayerRecord(withAssignment.players, otherPlayerId)).toEqual(otherPlayerRecord)
    expect(findSessionConnectedClient(withAssignment.connectedClients, otherClientId)).toEqual(
      otherClient,
    )
    expect(withAssignment.assignments).toEqual([assignment])

    const renamedPlayer = {
      ...otherPlayerRecord,
      displayName: sanitizeSessionDisplayName('Renamed Player'),
      updatedAt: '2026-05-25T02:09:00.000Z',
    }
    const afterRename = upsertSessionPlayerRecord(withAssignment, renamedPlayer, {
      revision: parseSessionRevision(1),
      updatedAt: '2026-05-25T02:09:30.000Z',
    })

    expect(afterRename.players).toEqual([renamedPlayer])
    expect(afterRename.revision).toBe(1)
    expect(afterRename.updatedAt).toBe('2026-05-25T02:09:30.000Z')
  })

  it('changes the selected map only to maps that are part of authoritative state', () => {
    const state = createState({
      revision: parseSessionRevision(3),
      selectedMapSlug: 'viridian-gym',
      maps: [viridianMap, pewterMap],
    })

    const changed = setSelectedSessionMapSlug(state, 'pewter-gym', {
      revision: parseSessionRevision(4),
      updatedAt,
    })
    const cleared = setSelectedSessionMapSlug(changed, null, {
      updatedAt: '2026-05-25T02:10:00.000Z',
    })

    expect(state.selectedMapSlug).toBe('viridian-gym')
    expect(changed.selectedMapSlug).toBe('pewter-gym')
    expect(changed.revision).toBe(4)
    expect(changed.updatedAt).toBe(updatedAt)
    expect(cleared.selectedMapSlug).toBeNull()
    expect(getSelectedSessionMapState(cleared)).toBeUndefined()

    expect(() => setSelectedSessionMapSlug(state, 'unknown-map')).toThrow(
      'Selected map "unknown-map" is not present in authoritative session map state',
    )
  })
})
