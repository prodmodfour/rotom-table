import { describe, expect, it, vi } from 'vitest'
import {
  SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  type SessionClientIdentity,
} from '#shared/sessionClientIdentity'
import {
  parseClientId,
  parseGmKey,
  parseJoinCode,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
} from '#shared/sessionIdentity'
import type { PlayerAssignmentRecord, SessionTokenResourceRef } from '#shared/sessionPermissions'
import { parseMapRevision, parseSessionRevision } from '#shared/sessionRevisions'
import { useSessionLobby, type GmSessionManagementResponse, type PlayerSessionStateResponse, type UpdatePlayerAssignmentResponse } from '~/composables/useSessionLobby'
import type { ApiClient } from '~/utils/apiClient'
import { SESSION_API_PATHS } from '~/utils/apiRoutes'
import { buildPlayerSessionMapNavigationModel } from '~/utils/playerSessionMapNavigation'
import { buildSessionTokenAssignmentPanelModel } from '~/utils/sessionTokenAssignmentPanel'
import type { SessionClientIdentityStorage } from '~/utils/sessionClientIdentityStorage'

const SESSION_ID = parseSessionId('session_flowabcdef12')
const GM_CLIENT_ID = parseClientId('client_gmflow01')
const PLAYER_CLIENT_ID = parseClientId('client_playerfl')
const GM_KEY = parseGmKey('gmkey_flowabcdefghijklmnopqrstuvwxyz')
const JOIN_CODE = parseJoinCode('ABCD23')
const PLAYER_ID = parsePlayerId('player_flow0001')
const DISPLAY_NAME = parseSessionDisplayName('Riley')
const CREATED_AT = '2026-05-26T17:00:00.000Z'
const REMEMBERED_AT = '2026-05-26T17:01:00.000Z'
const MAP_SLUG = 'training-yard'
const MAP_REVISION = parseMapRevision(0)

const tokenResource: SessionTokenResourceRef = {
  kind: 'token',
  tokenId: 'token-pikachu',
  mapSlug: MAP_SLUG,
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
}

const visibleMapAssignment: PlayerAssignmentRecord = {
  playerId: PLAYER_ID,
  displayName: DISPLAY_NAME,
  controllableResources: [],
  visibleResources: [{ kind: 'map', mapSlug: MAP_SLUG }],
  updatedAt: CREATED_AT,
  updatedByClientId: GM_CLIENT_ID,
}

const tokenControlAssignment: PlayerAssignmentRecord = {
  ...visibleMapAssignment,
  controllableResources: [tokenResource],
  visibleResources: [{ kind: 'map', mapSlug: MAP_SLUG }, tokenResource],
}

const gmIdentity = (): Extract<SessionClientIdentity, { role: 'gm' }> => ({
  schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  role: 'gm',
  sessionId: SESSION_ID,
  clientId: GM_CLIENT_ID,
  gmKey: GM_KEY,
  rememberedAt: CREATED_AT,
  lastSeenRevision: parseSessionRevision(1),
})

const playerIdentity = (): Extract<SessionClientIdentity, { role: 'player' }> => ({
  schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  role: 'player',
  sessionId: SESSION_ID,
  clientId: PLAYER_CLIENT_ID,
  playerId: PLAYER_ID,
  displayName: DISPLAY_NAME,
  rememberedAt: CREATED_AT,
  lastSeenRevision: parseSessionRevision(2),
})

const makeStorage = (initial: SessionClientIdentity | null) => {
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
  const calls: { readonly request: string; readonly body: unknown }[] = []
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

const makeManagementResponse = (
  revision: number,
  options: {
    readonly mapAttached?: boolean
    readonly assignments?: readonly PlayerAssignmentRecord[]
  } = {},
): GmSessionManagementResponse => {
  const mapAttached = options.mapAttached === true
  const assignments = options.assignments ?? []
  const mapSummary = mapAttached
    ? {
        mapSlug: MAP_SLUG,
        revision: MAP_REVISION,
        selected: true,
        attached: true as const,
        availableForSessionMode: true as const,
        playerVisibleByDefault: true,
      }
    : null

  return {
    session: {
      sessionId: SESSION_ID,
      status: 'active',
      revision: parseSessionRevision(revision),
      selectedMapSlug: mapAttached ? MAP_SLUG : null,
      selectedMapRevision: mapAttached ? MAP_REVISION : null,
      selectedMapAttached: mapAttached,
      sessionMapAvailable: mapAttached,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      playerCount: 1,
      connectedClientCount: 0,
      assignmentCount: assignments.length,
      mapCount: mapAttached ? 1 : 0,
    },
    join: { joinCode: JOIN_CODE },
    selectedMap: mapSummary,
    maps: mapSummary === null ? [] : [mapSummary],
    players: [{
      playerId: PLAYER_ID,
      displayName: DISPLAY_NAME,
      joinedAt: CREATED_AT,
      updatedAt: CREATED_AT,
    }],
    connectedClients: [],
    assignments,
  }
}

const makeAssignmentResponse = (): UpdatePlayerAssignmentResponse => ({
  session: {
    sessionId: SESSION_ID,
    status: 'active',
    revision: parseSessionRevision(3),
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  player: {
    playerId: PLAYER_ID,
    displayName: DISPLAY_NAME,
    joinedAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  assignment: tokenControlAssignment,
  change: {
    action: 'assign',
    resources: [tokenResource],
  },
  snapshot: {
    writtenAt: CREATED_AT,
    revision: parseSessionRevision(3),
  },
})

const makePlayerStateResponse = (): PlayerSessionStateResponse => ({
  session: {
    sessionId: SESSION_ID,
    status: 'active',
    revision: parseSessionRevision(3),
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
  assignment: tokenControlAssignment,
  visibility: {
    selectedMapAttached: true,
    currentMapVisible: true,
    currentMapAvailable: true,
    currentMap: {
      mapSlug: MAP_SLUG,
      revision: MAP_REVISION,
      selected: true,
      attached: true,
      availableForSessionMode: true,
    },
    visibleMapSlugs: [MAP_SLUG],
    visibleMaps: [{
      mapSlug: MAP_SLUG,
      revision: MAP_REVISION,
      selected: true,
      attached: true,
      availableForSessionMode: true,
    }],
  },
})

describe('session lobby map flow integration', () => {
  it('moves a remembered GM from an available session map to refreshed token assignment state', async () => {
    const storage = makeStorage(gmIdentity())
    const managementResponses = [
      makeManagementResponse(2, { mapAttached: true, assignments: [visibleMapAssignment] }),
      makeManagementResponse(3, { mapAttached: true, assignments: [tokenControlAssignment] }),
    ]
    const api = makeApiClient({
      [SESSION_API_PATHS.manage]: (body) => {
        expect(body).toEqual({ sessionId: SESSION_ID, gmKey: GM_KEY })
        const response = managementResponses.shift()
        if (response === undefined) throw new Error('unexpected extra live session management refresh')
        return response
      },
      [SESSION_API_PATHS.assignments]: (body) => {
        expect(body).toEqual({
          sessionId: SESSION_ID,
          gmKey: GM_KEY,
          gmClientId: GM_CLIENT_ID,
          playerId: PLAYER_ID,
          action: 'assign',
          resources: [tokenResource],
        })
        return makeAssignmentResponse()
      },
    })
    const lobby = useSessionLobby({
      apiClient: api.apiClient,
      identityStorage: storage.storage,
      clock: () => REMEMBERED_AT,
    })

    await lobby.loadRememberedIdentity({ refresh: true })

    const readyPanel = buildSessionTokenAssignmentPanelModel({
      mapSlug: MAP_SLUG,
      selectedMapSlug: lobby.gmManagement.value?.session.selectedMapSlug ?? null,
      selectedMapAttached: lobby.gmManagement.value?.session.selectedMapAttached ?? false,
      sessionMapAvailable: lobby.gmManagement.value?.session.sessionMapAvailable ?? false,
      localRoleIsGm: true,
      rememberedRole: lobby.identity.value?.role ?? null,
      players: lobby.gmManagement.value?.players ?? [],
      assignments: lobby.gmManagement.value?.assignments ?? [],
      tokens: [{ tokenId: tokenResource.tokenId, sheetKind: 'pokemon', sheetSlug: 'pikachu' }],
    })
    const assignControl = readyPanel.players[0]?.tokens[0]
    expect(readyPanel.statusKind).toBe('ready')
    expect(readyPanel.summary).toContain('Existing map visibility stays in place')
    expect(assignControl).toMatchObject({
      action: 'assign',
      buttonLabel: 'Assign control',
      resource: tokenResource,
    })

    await lobby.assignSessionMapTokenToPlayer({
      playerId: PLAYER_ID,
      tokenId: assignControl?.tokenId ?? '',
      mapSlug: assignControl?.resource.mapSlug ?? null,
      sheetKind: assignControl?.resource.sheetKind ?? null,
      sheetSlug: assignControl?.resource.sheetSlug ?? null,
    })

    const assignedPanel = buildSessionTokenAssignmentPanelModel({
      mapSlug: MAP_SLUG,
      selectedMapSlug: lobby.gmManagement.value?.session.selectedMapSlug ?? null,
      selectedMapAttached: lobby.gmManagement.value?.session.selectedMapAttached ?? false,
      sessionMapAvailable: lobby.gmManagement.value?.session.sessionMapAvailable ?? false,
      localRoleIsGm: true,
      rememberedRole: lobby.identity.value?.role ?? null,
      players: lobby.gmManagement.value?.players ?? [],
      assignments: lobby.gmManagement.value?.assignments ?? [],
      tokens: [{ tokenId: tokenResource.tokenId, sheetKind: 'pokemon', sheetSlug: 'pikachu' }],
    })

    expect(api.calls.map((call) => call.request)).toEqual([
      SESSION_API_PATHS.manage,
      SESSION_API_PATHS.assignments,
      SESSION_API_PATHS.manage,
    ])
    expect(lobby.lastUpdatedPlayerAssignment.value?.assignment).toEqual(tokenControlAssignment)
    expect(lobby.gmManagement.value?.assignments).toEqual([tokenControlAssignment])
    expect(lobby.identity.value?.lastSeenRevision).toBe(parseSessionRevision(3))
    expect(storage.stored()).toEqual(lobby.identity.value)
    expect(lobby.lastNotice.value).toBe('Assigned 1 token resource for Riley.')
    expect(assignedPanel.players[0]?.tokens[0]).toMatchObject({
      assigned: true,
      action: 'unassign',
      buttonLabel: 'Unassign control',
    })
  })

  it('turns a remembered player state into visible session-map links for opening session mode', async () => {
    const storage = makeStorage(playerIdentity())
    const api = makeApiClient({
      [SESSION_API_PATHS.playerState]: (body) => {
        expect(body).toEqual({
          sessionId: SESSION_ID,
          playerId: PLAYER_ID,
          clientId: PLAYER_CLIENT_ID,
          displayName: DISPLAY_NAME,
        })
        return makePlayerStateResponse()
      },
    })
    const lobby = useSessionLobby({
      apiClient: api.apiClient,
      identityStorage: storage.storage,
      clock: () => REMEMBERED_AT,
    })

    const loadingModel = buildPlayerSessionMapNavigationModel(lobby.playerState.value?.visibility ?? null)
    expect(loadingModel.status).toBe('loading')

    await lobby.loadRememberedIdentity({ refresh: true })

    const navigationModel = buildPlayerSessionMapNavigationModel(lobby.playerState.value?.visibility ?? null)

    expect(api.calls).toEqual([{
      request: SESSION_API_PATHS.playerState,
      body: {
        sessionId: SESSION_ID,
        playerId: PLAYER_ID,
        clientId: PLAYER_CLIENT_ID,
        displayName: DISPLAY_NAME,
      },
    }])
    expect(lobby.identity.value?.role).toBe('player')
    expect(lobby.identity.value?.lastSeenRevision).toBe(parseSessionRevision(3))
    expect(lobby.playerState.value?.assignment.controllableResources).toEqual([tokenResource])
    expect(navigationModel.status).toBe('ready')
    expect(navigationModel.summary).toContain('session commands and the session socket')
    expect(navigationModel.links).toEqual([
      expect.objectContaining({
        label: 'Open selected session map',
        mapSlug: MAP_SLUG,
        to: '/maps/training-yard?session=1',
        selected: true,
        revisionLabel: 'map revision 0',
      }),
    ])
    expect(navigationModel.links[0]?.description).toContain('Open it in session mode')
    expect(storage.stored()).toEqual(lobby.identity.value)
  })
})
