import { describe, expect, it, vi } from 'vitest'
import {
  SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  type SessionClientIdentity,
} from '#shared/sessionClientIdentity'
import { createSessionSafetyStatus } from '#shared/sessionSafety'
import {
  parseClientId,
  parseGmKey,
  parseJoinCode,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
} from '#shared/sessionIdentity'
import { parseMapRevision, parseSessionRevision } from '#shared/sessionRevisions'
import { SESSION_API_PATHS } from '~/utils/apiRoutes'
import type { ApiClient } from '~/utils/apiClient'
import type { SessionClientIdentityStorage } from '~/utils/sessionClientIdentityStorage'
import {
  sessionLobbyErrorMessage,
  useSessionLobby,
  type GmSessionManagementResponse,
  type JoinPlayerSessionResponse,
  type PlayerSessionStateResponse,
  type StartGmSessionResponse,
} from '~/composables/useSessionLobby'

const SESSION_ID = parseSessionId('session_abcdefghijkl')
const GM_CLIENT_ID = parseClientId('client_gmclient1')
const PLAYER_CLIENT_ID = parseClientId('client_player01')
const GM_KEY = parseGmKey('gmkey_abcdefghijklmnopqrstuvwxyz')
const JOIN_CODE = parseJoinCode('ABCD23')
const PLAYER_ID = parsePlayerId('player_player01')
const DISPLAY_NAME = parseSessionDisplayName('Riley')
const CREATED_AT = '2026-05-26T12:00:00.000Z'
const REMEMBERED_AT = '2026-05-26T12:01:00.000Z'
const MAP_SLUG = 'training-yard'

const makeStartResponse = (revision = 0): StartGmSessionResponse => ({
  session: {
    sessionId: SESSION_ID,
    status: 'active',
    revision: parseSessionRevision(revision),
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  gm: {
    gmKey: GM_KEY,
    clientId: GM_CLIENT_ID,
  },
  join: {
    joinCode: JOIN_CODE,
  },
  snapshot: {
    writtenAt: CREATED_AT,
    revision: parseSessionRevision(revision),
  },
})

const makeManagementResponse = (revision = 0): GmSessionManagementResponse => ({
  session: {
    sessionId: SESSION_ID,
    status: 'active',
    revision: parseSessionRevision(revision),
    selectedMapSlug: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    playerCount: 1,
    connectedClientCount: 0,
    assignmentCount: 1,
    mapCount: 0,
  },
  join: {
    joinCode: JOIN_CODE,
  },
  players: [{
    playerId: PLAYER_ID,
    displayName: DISPLAY_NAME,
    joinedAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }],
  connectedClients: [],
  assignments: [{
    playerId: PLAYER_ID,
    displayName: DISPLAY_NAME,
    controllableResources: [{ kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu' }],
    visibleResources: [{ kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu' }],
    updatedAt: CREATED_AT,
  }],
})

const makeJoinResponse = (revision = 1): JoinPlayerSessionResponse => ({
  session: {
    sessionId: SESSION_ID,
    status: 'active',
    revision: parseSessionRevision(revision),
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  player: {
    playerId: PLAYER_ID,
    clientId: PLAYER_CLIENT_ID,
    displayName: DISPLAY_NAME,
    joinedAt: CREATED_AT,
    actor: {
      role: 'player',
      playerId: PLAYER_ID,
      clientId: PLAYER_CLIENT_ID,
      displayName: DISPLAY_NAME,
    },
  },
  snapshot: {
    writtenAt: CREATED_AT,
    revision: parseSessionRevision(revision),
  },
})

const makePlayerStateResponse = (revision = 1): PlayerSessionStateResponse => ({
  session: {
    sessionId: SESSION_ID,
    status: 'active',
    revision: parseSessionRevision(revision),
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  player: {
    playerId: PLAYER_ID,
    clientId: PLAYER_CLIENT_ID,
    displayName: DISPLAY_NAME,
    joinedAt: CREATED_AT,
    updatedAt: CREATED_AT,
    actor: {
      role: 'player',
      playerId: PLAYER_ID,
      clientId: PLAYER_CLIENT_ID,
      displayName: DISPLAY_NAME,
    },
  },
  assignment: {
    playerId: PLAYER_ID,
    displayName: DISPLAY_NAME,
    controllableResources: [{ kind: 'token', tokenId: 'token-pikachu', mapSlug: MAP_SLUG }],
    visibleResources: [
      { kind: 'map', mapSlug: MAP_SLUG },
      { kind: 'token', tokenId: 'token-pikachu', mapSlug: MAP_SLUG },
    ],
    updatedAt: CREATED_AT,
  },
  visibility: {
    currentMapVisible: true,
    currentMap: { mapSlug: MAP_SLUG, revision: parseMapRevision(2) },
    visibleMapSlugs: [MAP_SLUG],
    visibleMaps: [{ mapSlug: MAP_SLUG, revision: parseMapRevision(2) }],
  },
})

const makeStorage = (initial: SessionClientIdentity | null = null) => {
  let stored = initial
  const storage: SessionClientIdentityStorage = {
    remember: vi.fn((identity: SessionClientIdentity) => {
      stored = identity
      return true
    }),
    load: vi.fn(() => stored),
    readCookieHint: vi.fn(() => null),
    clear: vi.fn(() => {
      stored = null
      return true
    }),
  }

  return {
    storage,
    stored: () => stored,
  }
}

const makeApiClient = (handlers: Record<string, (body: unknown) => unknown | Promise<unknown>>) => {
  const calls: { request: string; body: unknown }[] = []
  const apiClient: ApiClient = {
    getJson: vi.fn(async (request: string) => {
      calls.push({ request, body: undefined })
      const handler = handlers[request]
      if (handler === undefined) throw new Error(`unexpected GET request: ${request}`)
      return await handler(undefined)
    }) as ApiClient['getJson'],
    postJson: vi.fn(async (request: string, body: unknown) => {
      calls.push({ request, body })
      const handler = handlers[request]
      if (handler === undefined) throw new Error(`unexpected POST request: ${request}`)
      return await handler(body)
    }) as ApiClient['postJson'],
  }

  return { apiClient, calls }
}

describe('useSessionLobby', () => {
  it('loads the no-secret session safety status without changing lobby request messages', async () => {
    const safetyStatus = createSessionSafetyStatus({
      hostEnabled: true,
      requestHost: '192.168.1.50:3000',
    })
    const api = makeApiClient({
      [SESSION_API_PATHS.safety]: () => safetyStatus,
    })
    const lobby = useSessionLobby({
      apiClient: api.apiClient,
      identityStorage: makeStorage().storage,
    })

    await lobby.loadSafetyStatus()

    expect(api.calls).toEqual([{ request: SESSION_API_PATHS.safety, body: undefined }])
    expect(lobby.safetyStatus.value).toEqual(safetyStatus)
    expect(lobby.safetyError.value).toBeNull()
    expect(lobby.lastError.value).toBeNull()
    expect(lobby.lastNotice.value).toBeNull()
  })

  it('starts a GM session, remembers the GM identity, refreshes safety, and fetches management state', async () => {
    const storage = makeStorage()
    const readySafetyStatus = createSessionSafetyStatus({
      hostEnabled: true,
      requestHost: '192.168.1.50:3000',
      sessionSettings: {
        activeSessionCount: 1,
        credentialedSessionCount: 1,
        stateBackedSessionCount: 1,
      },
    })
    const api = makeApiClient({
      [SESSION_API_PATHS.start]: () => makeStartResponse(0),
      [SESSION_API_PATHS.manage]: (body) => {
        expect(body).toEqual({ sessionId: SESSION_ID, gmKey: GM_KEY })
        return makeManagementResponse(0)
      },
      [SESSION_API_PATHS.safety]: () => readySafetyStatus,
    })
    const lobby = useSessionLobby({
      apiClient: api.apiClient,
      identityStorage: storage.storage,
      clock: () => REMEMBERED_AT,
    })

    await lobby.startGmSession()

    expect(api.calls.map((call) => call.request)).toEqual([
      SESSION_API_PATHS.start,
      SESSION_API_PATHS.manage,
      SESSION_API_PATHS.safety,
    ])
    expect(lobby.identity.value).toMatchObject({
      schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
      role: 'gm',
      sessionId: SESSION_ID,
      clientId: GM_CLIENT_ID,
      gmKey: GM_KEY,
      rememberedAt: REMEMBERED_AT,
      lastSeenRevision: parseSessionRevision(0),
    })
    expect(storage.storage.remember).toHaveBeenCalled()
    expect(lobby.gmJoinCode.value).toBe(JOIN_CODE)
    expect(lobby.gmManagement.value?.players[0]?.displayName).toBe(DISPLAY_NAME)
    expect(lobby.safetyStatus.value).toEqual(readySafetyStatus)
    expect(lobby.lastNotice.value).toBe('Started a GM-hosted Live session in this browser.')
    expect(lobby.lastError.value).toBeNull()
  })

  it('joins a player session, stores the player identity, and reads player-filtered state', async () => {
    const storage = makeStorage()
    const api = makeApiClient({
      [SESSION_API_PATHS.join]: (body) => {
        expect(body).toEqual({ joinCode: 'abcd-23', displayName: '<Riley>' })
        return makeJoinResponse(1)
      },
      [SESSION_API_PATHS.playerState]: (body) => {
        expect(body).toEqual({
          sessionId: SESSION_ID,
          playerId: PLAYER_ID,
          clientId: PLAYER_CLIENT_ID,
          displayName: DISPLAY_NAME,
        })
        return makePlayerStateResponse(2)
      },
    })
    const lobby = useSessionLobby({
      apiClient: api.apiClient,
      identityStorage: storage.storage,
      clock: () => REMEMBERED_AT,
    })

    await lobby.joinPlayerSession({ joinCode: 'abcd-23', displayName: '<Riley>' })

    expect(api.calls.map((call) => call.request)).toEqual([
      SESSION_API_PATHS.join,
      SESSION_API_PATHS.playerState,
    ])
    expect(lobby.identity.value).toMatchObject({
      role: 'player',
      sessionId: SESSION_ID,
      clientId: PLAYER_CLIENT_ID,
      playerId: PLAYER_ID,
      displayName: DISPLAY_NAME,
      rememberedAt: REMEMBERED_AT,
      lastSeenRevision: parseSessionRevision(2),
    })
    expect(storage.stored()).toEqual(lobby.identity.value)
    expect(lobby.playerState.value?.assignment.controllableResources).toEqual([
      { kind: 'token', tokenId: 'token-pikachu', mapSlug: MAP_SLUG },
    ])
    expect(lobby.playerIdentity.value?.displayName).toBe(DISPLAY_NAME)
    expect(lobby.lastNotice.value).toBe('Joined the Live session as Riley.')
  })

  it('loads a remembered GM identity, refreshes it, and clears browser state', async () => {
    const storedIdentity: SessionClientIdentity = {
      schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
      role: 'gm',
      sessionId: SESSION_ID,
      clientId: GM_CLIENT_ID,
      gmKey: GM_KEY,
      rememberedAt: CREATED_AT,
      lastSeenRevision: parseSessionRevision(0),
    }
    const storage = makeStorage(storedIdentity)
    const api = makeApiClient({
      [SESSION_API_PATHS.manage]: () => makeManagementResponse(4),
    })
    const lobby = useSessionLobby({
      apiClient: api.apiClient,
      identityStorage: storage.storage,
      clock: () => REMEMBERED_AT,
    })

    await lobby.loadRememberedIdentity({ refresh: true })

    expect(storage.storage.load).toHaveBeenCalled()
    expect(api.calls).toEqual([{ request: SESSION_API_PATHS.manage, body: { sessionId: SESSION_ID, gmKey: GM_KEY } }])
    expect(lobby.identity.value?.lastSeenRevision).toBe(parseSessionRevision(4))
    expect(lobby.gmManagement.value?.session.revision).toBe(parseSessionRevision(4))

    lobby.clearRememberedIdentity()

    expect(storage.storage.clear).toHaveBeenCalled()
    expect(lobby.identity.value).toBeNull()
    expect(lobby.gmManagement.value).toBeNull()
    expect(lobby.lastNotice.value).toBe('Cleared the remembered live session identity for this browser.')
  })

  it('surfaces request failures without remembering a broken identity', async () => {
    const storage = makeStorage()
    const api = makeApiClient({
      [SESSION_API_PATHS.start]: () => {
        throw { data: { statusMessage: 'ROTOM_ENABLE_SESSION_HOST=1 is required' } }
      },
    })
    const lobby = useSessionLobby({
      apiClient: api.apiClient,
      identityStorage: storage.storage,
      clock: () => REMEMBERED_AT,
    })

    await expect(lobby.startGmSession()).rejects.toEqual({
      data: { statusMessage: 'ROTOM_ENABLE_SESSION_HOST=1 is required' },
    })

    expect(lobby.busy.value).toBe(false)
    expect(lobby.identity.value).toBeNull()
    expect(storage.storage.remember).not.toHaveBeenCalled()
    expect(lobby.lastError.value).toBe('ROTOM_ENABLE_SESSION_HOST=1 is required')
    expect(sessionLobbyErrorMessage(new Error('network down'))).toBe('network down')
  })
})
