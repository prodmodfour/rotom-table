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
} from '#shared/sessionState'
import { SESSION_HOST_ENABLE_ENV } from '~~/server/utils/sessionHosting'
import {
  createInMemorySessionStore,
  type InMemorySessionStore,
} from '~~/server/utils/sessionStore'
import {
  getGmSessionManagementUseCase,
  type GetGmSessionManagementInput,
} from '~~/server/useCases/getGmSessionManagement'

const enabledEnv = { [SESSION_HOST_ENABLE_ENV]: '1' }
const createdAt = '2026-05-25T10:00:00.000Z'
const updatedAt = '2026-05-25T10:15:00.000Z'
const joinedAt = '2026-05-25T10:05:00.000Z'
const lastSeenAt = '2026-05-25T10:14:00.000Z'
const disconnectedAt = '2026-05-25T10:13:00.000Z'
const endedAt = '2026-05-25T10:30:00.000Z'

const sessionId = parseSessionId('session_manage000001')
const unknownSessionId = parseSessionId('session_missing000001')
const joinCode = parseJoinCode('MGMT234')
const gmKey = parseGmKey('gmkey_manageabcdefghijklmnopqrstuvwxyz')
const wrongGmKey = parseGmKey('gmkey_wrongabcdefghijklmnopqrstuvwxyz')
const gmClientId = parseClientId('client_manageGM1')
const playerId = parsePlayerId('player_manage01')
const playerClientId = parseClientId('client_managePL1')
const displayName = parseSessionDisplayName('Misty')
const revision = parseSessionRevision(3)
const mapRevision = parseMapRevision(2)

const defaultInput: GetGmSessionManagementInput = {
  sessionId,
  gmKey,
}

const createManagedState = (): AuthoritativeSessionState<{ readonly tokenCount: number }> =>
  createAuthoritativeSessionState({
    sessionId,
    revision,
    selectedMapSlug: 'viridian-gym',
    maps: [
      createAuthoritativeSessionMapState({
        mapSlug: 'viridian-gym',
        revision: mapRevision,
        document: { tokenCount: 2 },
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
        clientId: playerClientId,
        actor: {
          role: 'player',
          playerId,
          clientId: playerClientId,
          displayName,
        },
        status: 'reconnecting',
        connectedAt: joinedAt,
        lastSeenAt,
        lastSeenRevision: revision,
        disconnectedAt,
      },
    ],
    players: [
      {
        playerId,
        displayName,
        joinedAt,
        updatedAt,
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
            mapSlug: 'viridian-gym',
            sheetKind: 'pokemon',
            sheetSlug: 'pikachu',
          },
        ],
        visibleResources: [
          { kind: 'map', mapSlug: 'viridian-gym' },
          { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu' },
        ],
        updatedAt,
        updatedByClientId: gmClientId,
      },
    ],
    createdAt,
    updatedAt,
  })

const createStoreWithSession = (overrides: {
  readonly state?: AuthoritativeSessionState<{ readonly tokenCount: number }>
  readonly includeState?: boolean
  readonly status?: 'active' | 'ended'
} = {}): InMemorySessionStore<AuthoritativeSessionState<{ readonly tokenCount: number }>> => {
  const store = createInMemorySessionStore<AuthoritativeSessionState<{ readonly tokenCount: number }>>()
  const state = overrides.state ?? createManagedState()
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

const getManagement = (overrides: {
  readonly input?: GetGmSessionManagementInput
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<{ readonly tokenCount: number }>>
  readonly env?: Record<string, string | undefined>
} = {}) => getGmSessionManagementUseCase(overrides.input ?? defaultInput, {
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

describe('getGmSessionManagementUseCase', () => {
  it('fails closed when session hosting is not explicitly enabled', () => {
    const store = createStoreWithSession()

    expectHttpError(
      () => getManagement({ store, env: {} }),
      {
        statusCode: 403,
        message: 'live session hosting is disabled. Set ROTOM_ENABLE_SESSION_HOST=1 to enable session endpoints.',
      },
    )
  })

  it('reports that no selected session map is available before a map is attached', () => {
    const state = createAuthoritativeSessionState<{ readonly tokenCount: number }>({
      sessionId,
      revision,
      createdAt,
      updatedAt,
    })
    const store = createStoreWithSession({ state })

    const result = getManagement({ store })

    expect(result.session).toMatchObject({
      sessionId,
      status: 'active',
      revision,
      selectedMapSlug: null,
      selectedMapRevision: null,
      selectedMapAttached: false,
      sessionMapAvailable: false,
      mapCount: 0,
    })
    expect(result.selectedMap).toBeNull()
    expect(result.maps).toEqual([])
  })

  it('returns GM management status, join code, attached maps, players, clients, and assignments', () => {
    const state = createManagedState()
    const store = createStoreWithSession({ state })

    const result = getManagement({ store })

    expect(result.session).toEqual({
      sessionId,
      status: 'active',
      revision,
      selectedMapSlug: 'viridian-gym',
      selectedMapRevision: mapRevision,
      selectedMapAttached: true,
      sessionMapAvailable: true,
      createdAt,
      updatedAt,
      playerCount: 1,
      connectedClientCount: 2,
      assignmentCount: 1,
      mapCount: 1,
    })
    const mapSummary = {
      mapSlug: 'viridian-gym',
      revision: mapRevision,
      selected: true,
      attached: true,
      availableForSessionMode: true,
      playerVisibleByDefault: false,
    }
    expect(result.join).toEqual({ joinCode })
    expect(result.selectedMap).toEqual(mapSummary)
    expect(result.maps).toEqual([mapSummary])
    expect(result.players).toEqual(state.players)
    expect(result.connectedClients).toEqual(state.connectedClients)
    expect(result.assignments).toEqual(state.assignments)
    expect(result).not.toHaveProperty('gmKey')
  })

  it('returns cloned arrays so callers cannot mutate store state through the summary', () => {
    const state = createManagedState()
    const result = getManagement({ store: createStoreWithSession({ state }) })

    expect(result.players).not.toBe(state.players)
    expect(result.connectedClients).not.toBe(state.connectedClients)
    expect(result.connectedClients[0]?.actor).not.toBe(state.connectedClients[0]?.actor)
    expect(result.assignments).not.toBe(state.assignments)
    expect(result.assignments[0]?.controllableResources).not.toBe(
      state.assignments[0]?.controllableResources,
    )
    expect(result.assignments[0]?.visibleResources).not.toBe(state.assignments[0]?.visibleResources)
  })

  it('returns ended session status for GM inspection without reactivating the join code', () => {
    const store = createStoreWithSession({ status: 'ended' })

    const result = getManagement({ store })

    expect(result.session).toMatchObject({
      sessionId,
      status: 'ended',
      endedAt,
    })
    expect(store.findActiveByJoinCode(joinCode)).toBeUndefined()
  })

  it('rejects malformed management credentials before reading session data', () => {
    const store = createStoreWithSession()

    expectHttpError(
      () => getManagement({ store, input: { sessionId: 'not-a-session', gmKey } }),
      {
        statusCode: 400,
        message: 'sessionId must match /^session_[A-Za-z0-9_-]{12,64}$/',
      },
    )
    expectHttpError(
      () => getManagement({ store, input: { sessionId, gmKey: 'not-a-gm-key' } }),
      {
        statusCode: 400,
        message: 'gmKey must match /^gmkey_[A-Za-z0-9_-]{24,128}$/',
      },
    )
  })

  it('rejects unknown sessions and wrong GM keys without returning the join code', () => {
    const store = createStoreWithSession()

    expectHttpError(
      () => getManagement({ store, input: { sessionId: unknownSessionId, gmKey } }),
      {
        statusCode: 404,
        message: 'No live session was found for the supplied session ID',
      },
    )
    expectHttpError(
      () => getManagement({ store, input: { sessionId, gmKey: wrongGmKey } }),
      {
        statusCode: 403,
        message: 'The supplied GM key is not authorized to manage this live session',
      },
    )
  })

  it('reports corrupted session records that have no authoritative state', () => {
    const store = createStoreWithSession({ includeState: false })

    expectHttpError(
      () => getManagement({ store }),
      {
        statusCode: 500,
        message: 'The live session has no authoritative state available for GM management',
      },
    )
  })
})
