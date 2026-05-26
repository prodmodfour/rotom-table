import { describe, expect, it } from 'vitest'
import {
  parseClientId,
  parseGmKey,
  parseJoinCode,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
} from '#shared/sessionIdentity'
import { parseMapRevision, parseSessionRevision } from '#shared/sessionRevisions'
import {
  createAuthoritativeSessionMapState,
  createAuthoritativeSessionState,
  type AuthoritativeSessionState,
  type CreateAuthoritativeSessionStateInput,
} from '#shared/sessionState'
import { SESSION_HOST_ENABLE_ENV } from '~~/server/utils/sessionHosting'
import {
  createInMemorySessionStore,
  type InMemorySessionStore,
} from '~~/server/utils/sessionStore'
import {
  getPlayerSessionStateUseCase,
  type GetPlayerSessionStateInput,
} from '~~/server/useCases/getPlayerSessionState'

const enabledEnv = { [SESSION_HOST_ENABLE_ENV]: '1' }
const createdAt = '2026-05-25T10:00:00.000Z'
const updatedAt = '2026-05-25T10:15:00.000Z'
const joinedAt = '2026-05-25T10:05:00.000Z'
const otherJoinedAt = '2026-05-25T10:07:00.000Z'
const lastSeenAt = '2026-05-25T10:14:00.000Z'
const endedAt = '2026-05-25T10:30:00.000Z'

const sessionId = parseSessionId('session_playerstate01')
const unknownSessionId = parseSessionId('session_playerstate02')
const joinCode = parseJoinCode('STAT234')
const gmKey = parseGmKey('gmkey_stateabcdefghijklmnopqrstuvwxyz')
const gmClientId = parseClientId('client_stateGM1')
const playerId = parsePlayerId('player_state001')
const otherPlayerId = parsePlayerId('player_state002')
const clientId = parseClientId('client_state001')
const otherClientId = parseClientId('client_state002')
const displayName = parseSessionDisplayName('Misty')
const otherDisplayName = parseSessionDisplayName('Brock')
const revision = parseSessionRevision(5)
const visibleMapRevision = parseMapRevision(3)
const sideMapRevision = parseMapRevision(2)
const hiddenMapRevision = parseMapRevision(4)

const defaultInput: GetPlayerSessionStateInput = {
  sessionId,
  playerId,
  clientId,
  displayName,
}

type TestMapDocument = { readonly label: string }
type TestSessionStateInput = CreateAuthoritativeSessionStateInput<TestMapDocument>

const createPlayerState = (
  overrides: Partial<Omit<TestSessionStateInput, 'sessionId' | 'createdAt'>> = {},
): AuthoritativeSessionState<TestMapDocument> =>
  createAuthoritativeSessionState<TestMapDocument>({
    sessionId,
    revision,
    selectedMapSlug: 'viridian-gym',
    maps: [
      createAuthoritativeSessionMapState({
        mapSlug: 'viridian-gym',
        revision: visibleMapRevision,
        document: { label: 'visible map' },
      }),
      createAuthoritativeSessionMapState({
        mapSlug: 'arena-side-room',
        revision: sideMapRevision,
        document: { label: 'side map' },
      }),
      createAuthoritativeSessionMapState({
        mapSlug: 'hidden-room',
        revision: hiddenMapRevision,
        document: { label: 'hidden map' },
      }),
    ],
    connectedClients: [
      {
        clientId: gmClientId,
        actor: { role: 'gm', clientId: gmClientId },
        status: 'connected',
        connectedAt: createdAt,
        lastSeenAt,
        lastSeenRevision: revision,
      },
      {
        clientId,
        actor: {
          role: 'player',
          playerId,
          clientId,
          displayName,
        },
        status: 'connected',
        connectedAt: joinedAt,
        lastSeenAt,
        lastSeenRevision: revision,
      },
      {
        clientId: otherClientId,
        actor: {
          role: 'player',
          playerId: otherPlayerId,
          clientId: otherClientId,
          displayName: otherDisplayName,
        },
        status: 'reconnecting',
        connectedAt: otherJoinedAt,
        lastSeenAt,
      },
    ],
    players: [
      {
        playerId,
        displayName,
        joinedAt,
        updatedAt,
      },
      {
        playerId: otherPlayerId,
        displayName: otherDisplayName,
        joinedAt: otherJoinedAt,
        updatedAt: otherJoinedAt,
      },
    ],
    assignments: [
      {
        playerId,
        displayName,
        controllableResources: [
          {
            kind: 'token',
            tokenId: 'token-starmie',
            mapSlug: 'viridian-gym',
            sheetKind: 'pokemon',
            sheetSlug: 'starmie',
          },
          {
            kind: 'sheet',
            sheetKind: 'trainer',
            sheetSlug: 'misty',
          },
        ],
        visibleResources: [
          { kind: 'map', mapSlug: 'arena-side-room' },
          { kind: 'map', mapSlug: 'viridian-gym' },
          { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'misty' },
          {
            kind: 'token',
            tokenId: 'token-starmie',
            mapSlug: 'viridian-gym',
            sheetKind: 'pokemon',
            sheetSlug: 'starmie',
          },
        ],
        updatedAt,
        updatedByClientId: gmClientId,
      },
      {
        playerId: otherPlayerId,
        displayName: otherDisplayName,
        controllableResources: [
          {
            kind: 'token',
            tokenId: 'token-geodude',
            mapSlug: 'hidden-room',
          },
        ],
        visibleResources: [{ kind: 'map', mapSlug: 'hidden-room' }],
        updatedAt: otherJoinedAt,
        updatedByClientId: gmClientId,
      },
    ],
    createdAt,
    updatedAt,
    ...overrides,
  })

const createStoreWithSession = (overrides: {
  readonly state?: AuthoritativeSessionState<TestMapDocument>
  readonly includeState?: boolean
  readonly status?: 'active' | 'ended'
} = {}): InMemorySessionStore<AuthoritativeSessionState<TestMapDocument>> => {
  const store = createInMemorySessionStore<AuthoritativeSessionState<TestMapDocument>>()
  const state = overrides.state ?? createPlayerState()
  store.create({
    sessionId,
    joinCode,
    gmKey,
    revision: state.revision,
    createdAt,
    updatedAt,
    ...(overrides.includeState === false ? {} : { state }),
  })

  if (overrides.status === 'ended') {
    store.end(sessionId, { endedAt })
  }

  return store
}

const getPlayerState = (overrides: {
  readonly input?: GetPlayerSessionStateInput
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TestMapDocument>>
  readonly env?: Record<string, string | undefined>
} = {}) => getPlayerSessionStateUseCase<TestMapDocument>(overrides.input ?? defaultInput, {
  env: overrides.env ?? enabledEnv,
  store: overrides.store ?? createStoreWithSession(),
})

const expectHttpError = (
  action: () => unknown,
  expected: { readonly statusCode: number; readonly message: string },
) => {
  let thrown: unknown
  try {
    action()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toMatchObject(expected)
}

describe('getPlayerSessionStateUseCase', () => {
  it('fails closed when session hosting is not explicitly enabled', () => {
    const store = createStoreWithSession()

    expectHttpError(
      () => getPlayerState({ store, env: {} }),
      {
        statusCode: 403,
        message: 'live session hosting is disabled. Set ROTOM_ENABLE_SESSION_HOST=1 to enable session endpoints.',
      },
    )
  })

  it('returns only the calling player identity, assignment, map visibility, and session status', () => {
    const state = createPlayerState()
    const store = createStoreWithSession({ state })

    const result = getPlayerState({ store })

    expect(result.session).toEqual({
      sessionId,
      status: 'active',
      revision,
      createdAt,
      updatedAt,
    })
    expect(result.player).toEqual({
      playerId,
      clientId,
      displayName,
      joinedAt,
      updatedAt,
      actor: {
        role: 'player',
        playerId,
        clientId,
        displayName,
      },
    })
    expect(result.assignment).toEqual(state.assignments[0])
    expect(result.visibility).toEqual({
      selectedMapAttached: true,
      currentMapVisible: true,
      currentMapAvailable: true,
      currentMap: {
        mapSlug: 'viridian-gym',
        revision: visibleMapRevision,
        selected: true,
        attached: true,
        availableForSessionMode: true,
      },
      visibleMapSlugs: ['arena-side-room', 'viridian-gym'],
      visibleMaps: [
        {
          mapSlug: 'arena-side-room',
          revision: sideMapRevision,
          selected: false,
          attached: true,
          availableForSessionMode: true,
        },
        {
          mapSlug: 'viridian-gym',
          revision: visibleMapRevision,
          selected: true,
          attached: true,
          availableForSessionMode: true,
        },
      ],
    })
    expect(result).not.toHaveProperty('join')
    expect(result).not.toHaveProperty('gmKey')
    expect(result.session).not.toHaveProperty('selectedMapSlug')
    expect(result).not.toHaveProperty('players')
    expect(result).not.toHaveProperty('connectedClients')
  })

  it('reports no available session map before a map is attached', () => {
    const state = createPlayerState({
      selectedMapSlug: null,
      maps: [],
      assignments: [],
    })
    const result = getPlayerState({ store: createStoreWithSession({ state }) })

    expect(result.visibility).toEqual({
      selectedMapAttached: false,
      currentMapVisible: false,
      currentMapAvailable: false,
      currentMap: null,
      visibleMapSlugs: [],
      visibleMaps: [],
    })
  })

  it('returns cloned assignment resources so callers cannot mutate stored state through the response', () => {
    const state = createPlayerState()
    const result = getPlayerState({ store: createStoreWithSession({ state }) })

    expect(result.assignment).not.toBe(state.assignments[0])
    expect(result.assignment.controllableResources).not.toBe(
      state.assignments[0]?.controllableResources,
    )
    expect(result.assignment.visibleResources).not.toBe(state.assignments[0]?.visibleResources)
  })

  it('does not expose the selected map slug when the current map is not visible to the player', () => {
    const state = createPlayerState({ selectedMapSlug: 'hidden-room' })
    const result = getPlayerState({ store: createStoreWithSession({ state }) })

    expect(result.session).not.toHaveProperty('selectedMapSlug')
    expect(result.visibility.selectedMapAttached).toBe(true)
    expect(result.visibility.currentMapVisible).toBe(false)
    expect(result.visibility.currentMapAvailable).toBe(false)
    expect(result.visibility.currentMap).toBeNull()
    expect(result.visibility.visibleMapSlugs).toEqual(['arena-side-room', 'viridian-gym'])
    expect(result.visibility.visibleMaps).not.toContainEqual({
      mapSlug: 'hidden-room',
      revision: hiddenMapRevision,
    })
  })

  it('returns an empty assignment summary for a joined player with no assignment record', () => {
    const state = createPlayerState({ assignments: [] })
    const result = getPlayerState({ store: createStoreWithSession({ state }) })

    expect(result.assignment).toEqual({
      playerId,
      displayName,
      controllableResources: [],
      visibleResources: [],
      updatedAt,
    })
    expect(result.visibility).toEqual({
      selectedMapAttached: true,
      currentMapVisible: false,
      currentMapAvailable: false,
      currentMap: null,
      visibleMapSlugs: [],
      visibleMaps: [],
    })
  })

  it('returns ended session status for a joined player without reactivating the join code', () => {
    const store = createStoreWithSession({ status: 'ended' })

    const result = getPlayerState({ store })

    expect(result.session).toMatchObject({
      sessionId,
      status: 'ended',
      endedAt,
    })
    expect(store.findActiveByJoinCode(joinCode)).toBeUndefined()
  })

  it('rejects malformed player identity fields before returning session data', () => {
    const store = createStoreWithSession()

    expectHttpError(
      () => getPlayerState({ store, input: { ...defaultInput, playerId: 'not-a-player' } }),
      {
        statusCode: 400,
        message: 'playerId must match /^player_[A-Za-z0-9_-]{8,64}$/',
      },
    )
    expectHttpError(
      () => getPlayerState({ store, input: { ...defaultInput, displayName: 'Misty\n' } }),
      {
        statusCode: 400,
        message: 'displayName must be 1-32 safe display characters',
      },
    )
  })

  it('rejects unknown sessions, mismatched players, and client identity collisions', () => {
    const store = createStoreWithSession()

    expectHttpError(
      () => getPlayerState({ store, input: { ...defaultInput, sessionId: unknownSessionId } }),
      {
        statusCode: 404,
        message: 'No live session was found for the supplied session ID',
      },
    )
    expectHttpError(
      () => getPlayerState({ store, input: { ...defaultInput, displayName: otherDisplayName } }),
      {
        statusCode: 403,
        message: 'The supplied player identity is not authorized to read this live session',
      },
    )
    expectHttpError(
      () => getPlayerState({ store, input: { ...defaultInput, clientId: gmClientId } }),
      {
        statusCode: 403,
        message: 'The supplied client ID is already associated with a different session actor',
      },
    )
  })

  it('reports corrupted session records that have no authoritative state', () => {
    const store = createStoreWithSession({ includeState: false })

    expectHttpError(
      () => getPlayerState({ store }),
      {
        statusCode: 500,
        message: 'The live session has no authoritative state available for player state reads',
      },
    )
  })
})
