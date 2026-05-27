import { computed, ref } from 'vue'
import type {
  AttachSessionMapInput,
  AttachSessionMapResult,
  SessionMapAttachmentSelectedMapBehavior,
  SessionMapAttachmentVisibilityBehavior,
} from '#shared/sessionMapAttachment'
import {
  SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  updateSessionClientIdentityRevision,
  type SessionClientIdentity,
} from '#shared/sessionClientIdentity'
import type {
  ClientId,
  GmKey,
  JoinCode,
  PlayerId,
  SessionDisplayName,
  SessionId,
} from '#shared/sessionIdentity'
import type { SessionSafetyStatus } from '#shared/sessionSafety'
import type {
  PlayerAssignmentRecord,
  PlayerSessionActor,
  SessionControllableResourceRef,
  SessionTokenResourceRef,
} from '#shared/sessionPermissions'
import type { MapRevision, SessionRevision } from '#shared/sessionRevisions'
import type { SheetKind } from '#shared/sheets'
import type {
  SelectedSessionMapSlug,
  SessionConnectedClientRecord,
  SessionMapSlug,
  SessionPlayerRecord,
} from '#shared/sessionState'
import { SESSION_API_PATHS } from '~/utils/apiRoutes'
import type { ApiClient } from '~/utils/apiClient'
import {
  sessionClientIdentityStorage,
  type SessionClientIdentityStorage,
} from '~/utils/sessionClientIdentityStorage'
import { useApiClient } from '~/composables/useApiClient'
import {
  buildSessionMapTokenResource,
  normalizeSessionTokenAssignmentText,
} from '~/utils/sessionTokenAssignmentResources'

export type SessionLobbyLifecycleStatus = 'active' | 'ended'
export type SessionLobbyClock = () => string

export interface SessionLobbySessionSummary {
  readonly sessionId: SessionId
  readonly status: SessionLobbyLifecycleStatus
  readonly revision: SessionRevision
  readonly createdAt: string
  readonly updatedAt: string
  readonly endedAt?: string
}

export interface StartGmSessionResponse {
  readonly session: SessionLobbySessionSummary
  readonly gm: {
    readonly gmKey: GmKey
    readonly clientId: ClientId
  }
  readonly join: {
    readonly joinCode: JoinCode
  }
  readonly snapshot: {
    readonly writtenAt: string
    readonly revision: SessionRevision
  }
}

export interface SessionLobbyMapSummary {
  readonly mapSlug: SessionMapSlug
  readonly revision: MapRevision
  readonly selected: boolean
  readonly attached: true
  readonly availableForSessionMode: true
  readonly playerVisibleByDefault?: boolean
}

export interface GmSessionManagementResponse {
  readonly session: SessionLobbySessionSummary & {
    readonly selectedMapSlug: SelectedSessionMapSlug
    readonly selectedMapRevision: MapRevision | null
    readonly selectedMapAttached: boolean
    readonly sessionMapAvailable: boolean
    readonly playerCount: number
    readonly connectedClientCount: number
    readonly assignmentCount: number
    readonly mapCount: number
  }
  readonly join: {
    readonly joinCode: JoinCode
  }
  readonly selectedMap: SessionLobbyMapSummary | null
  readonly maps: readonly SessionLobbyMapSummary[]
  readonly players: readonly SessionPlayerRecord[]
  readonly connectedClients: readonly SessionConnectedClientRecord[]
  readonly assignments: readonly PlayerAssignmentRecord[]
}

export interface JoinPlayerSessionResponse {
  readonly session: SessionLobbySessionSummary
  readonly player: {
    readonly playerId: PlayerId
    readonly clientId: ClientId
    readonly displayName: SessionDisplayName
    readonly joinedAt: string
    readonly actor: PlayerSessionActor
  }
  readonly snapshot: {
    readonly writtenAt: string
    readonly revision: SessionRevision
  }
}

export interface PlayerSessionStateResponse {
  readonly session: SessionLobbySessionSummary
  readonly player: {
    readonly playerId: PlayerId
    readonly clientId: ClientId
    readonly displayName: SessionDisplayName
    readonly joinedAt: string
    readonly updatedAt: string
    readonly actor: PlayerSessionActor
  }
  readonly assignment: PlayerAssignmentRecord
  readonly visibility: {
    readonly selectedMapAttached: boolean
    readonly currentMapVisible: boolean
    readonly currentMapAvailable: boolean
    readonly currentMap: SessionLobbyMapSummary | null
    readonly visibleMapSlugs: readonly SessionMapSlug[]
    readonly visibleMaps: readonly SessionLobbyMapSummary[]
  }
}

export interface PlayerSessionProfileSummary {
  readonly playerId: PlayerId
  readonly displayName: SessionDisplayName
  readonly joinedAt: string
  readonly updatedAt: string
}

export interface PlayerSessionProfilesResponse {
  readonly session: SessionLobbySessionSummary | null
  readonly profiles: readonly PlayerSessionProfileSummary[]
}

export interface JoinPlayerSessionForm {
  readonly joinCode?: string
  readonly displayName?: string
  readonly playerId?: PlayerId | string
}

export interface AttachSessionMapForm {
  readonly mapSlug: string
  readonly selectedMapBehavior?: SessionMapAttachmentSelectedMapBehavior
  readonly visibilityBehavior?: SessionMapAttachmentVisibilityBehavior
}

export type UpdatePlayerAssignmentAction = 'assign' | 'unassign'

export interface UpdatePlayerAssignmentForm {
  readonly playerId: PlayerId
  readonly action: UpdatePlayerAssignmentAction
  readonly resources: readonly SessionControllableResourceRef[]
}

export interface UpdatePlayerMapTokenAssignmentForm {
  readonly playerId: PlayerId
  readonly tokenId: string
  readonly mapSlug?: string | null
  readonly sheetKind?: SheetKind | null
  readonly sheetSlug?: string | null
}

export interface UpdatePlayerAssignmentResponse {
  readonly session: SessionLobbySessionSummary
  readonly player: SessionPlayerRecord
  readonly assignment: PlayerAssignmentRecord
  readonly change: {
    readonly action: UpdatePlayerAssignmentAction
    readonly resources: readonly SessionControllableResourceRef[]
  }
  readonly snapshot: {
    readonly writtenAt: string
    readonly revision: SessionRevision
  }
}

export interface UseSessionLobbyOptions {
  readonly apiClient?: ApiClient
  readonly identityStorage?: SessionClientIdentityStorage
  readonly clock?: SessionLobbyClock
}

const defaultClock: SessionLobbyClock = () => new Date().toISOString()

const getErrorString = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  return null
}

export const sessionLobbyErrorMessage = (error: unknown): string => {
  if (typeof error !== 'object' || error === null) {
    return getErrorString(error) ?? 'The session lobby request failed.'
  }

  const record = error as Record<string, unknown>
  const data = typeof record.data === 'object' && record.data !== null
    ? record.data as Record<string, unknown>
    : null

  return getErrorString(data?.statusMessage)
    ?? getErrorString(data?.message)
    ?? getErrorString(record.statusMessage)
    ?? getErrorString(record.message)
    ?? 'The session lobby request failed.'
}

export const useSessionLobby = (options: UseSessionLobbyOptions = {}) => {
  const apiClient = options.apiClient ?? useApiClient()
  const identityStorage = options.identityStorage ?? sessionClientIdentityStorage
  const clock = options.clock ?? defaultClock

  const identity = ref<SessionClientIdentity | null>(null)
  const startedGmSession = ref<StartGmSessionResponse | null>(null)
  const gmManagement = ref<GmSessionManagementResponse | null>(null)
  const joinedPlayerSession = ref<JoinPlayerSessionResponse | null>(null)
  const playerState = ref<PlayerSessionStateResponse | null>(null)
  const playerProfileLobby = ref<PlayerSessionProfilesResponse | null>(null)
  const lastAttachedSessionMap = ref<AttachSessionMapResult | null>(null)
  const lastUpdatedPlayerAssignment = ref<UpdatePlayerAssignmentResponse | null>(null)
  const safetyStatus = ref<SessionSafetyStatus | null>(null)
  const safetyError = ref<string | null>(null)
  const busy = ref(false)
  const lastError = ref<string | null>(null)
  const lastNotice = ref<string | null>(null)

  const activeRole = computed(() => identity.value?.role ?? null)
  const hasRememberedIdentity = computed(() => identity.value !== null)
  const gmJoinCode = computed(() =>
    gmManagement.value?.join.joinCode ?? startedGmSession.value?.join.joinCode ?? null,
  )
  const gmSession = computed(() => gmManagement.value?.session ?? startedGmSession.value?.session ?? null)
  const playerSession = computed(() => playerState.value?.session ?? joinedPlayerSession.value?.session ?? null)
  const playerIdentity = computed(() => playerState.value?.player ?? joinedPlayerSession.value?.player ?? null)
  const playerProfileSession = computed(() => playerProfileLobby.value?.session ?? null)
  const playerProfiles = computed(() => playerProfileLobby.value?.profiles ?? [])

  const rememberIdentity = (nextIdentity: SessionClientIdentity): SessionClientIdentity => {
    identity.value = nextIdentity
    identityStorage.remember(nextIdentity)
    return nextIdentity
  }

  const rememberIdentityRevision = <TIdentity extends SessionClientIdentity>(
    nextIdentity: TIdentity,
    revision: SessionRevision,
  ): TIdentity => rememberIdentity(updateSessionClientIdentityRevision(
    nextIdentity,
    revision,
    clock(),
  )) as TIdentity

  const recordFailure = (error: unknown): void => {
    const message = sessionLobbyErrorMessage(error)
    lastError.value = message
    lastNotice.value = null
  }

  const fetchGmManagement = async (
    gmIdentity: Extract<SessionClientIdentity, { role: 'gm' }>,
  ): Promise<GmSessionManagementResponse> => {
    const response = await apiClient.postJson<GmSessionManagementResponse>(SESSION_API_PATHS.manage, {
      sessionId: gmIdentity.sessionId,
      gmKey: gmIdentity.gmKey,
    })
    gmManagement.value = response
    playerState.value = null
    joinedPlayerSession.value = null
    rememberIdentityRevision(gmIdentity, response.session.revision)
    return response
  }

  const fetchPlayerState = async (
    playerIdentityValue: Extract<SessionClientIdentity, { role: 'player' }>,
  ): Promise<PlayerSessionStateResponse> => {
    const response = await apiClient.postJson<PlayerSessionStateResponse>(SESSION_API_PATHS.playerState, {
      sessionId: playerIdentityValue.sessionId,
      playerId: playerIdentityValue.playerId,
      clientId: playerIdentityValue.clientId,
      displayName: playerIdentityValue.displayName,
    })
    playerState.value = response
    gmManagement.value = null
    startedGmSession.value = null
    lastAttachedSessionMap.value = null
    lastUpdatedPlayerAssignment.value = null
    rememberIdentityRevision(playerIdentityValue, response.session.revision)
    return response
  }

  const loadSafetyStatus = async (): Promise<SessionSafetyStatus> => {
    try {
      const response = await apiClient.getJson<SessionSafetyStatus>(SESSION_API_PATHS.safety)
      safetyStatus.value = response
      safetyError.value = null
      return response
    } catch (error) {
      safetyStatus.value = null
      safetyError.value = sessionLobbyErrorMessage(error)
      throw error
    }
  }

  const loadPlayerProfiles = async (
    loadOptions: { readonly silent?: boolean } = {},
  ): Promise<PlayerSessionProfilesResponse> => {
    try {
      const response = await apiClient.getJson<PlayerSessionProfilesResponse>(SESSION_API_PATHS.playerProfiles)
      playerProfileLobby.value = response
      return response
    } catch (error) {
      playerProfileLobby.value = null
      if (loadOptions.silent !== true) recordFailure(error)
      throw error
    }
  }

  const startGmSession = async (): Promise<StartGmSessionResponse> => {
    busy.value = true
    lastError.value = null
    lastNotice.value = null

    try {
      const response = await apiClient.postJson<StartGmSessionResponse>(SESSION_API_PATHS.start, {})
      startedGmSession.value = response
      lastAttachedSessionMap.value = null
      lastUpdatedPlayerAssignment.value = null
      const nextIdentity: Extract<SessionClientIdentity, { role: 'gm' }> = {
        schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
        role: 'gm',
        sessionId: response.session.sessionId,
        clientId: response.gm.clientId,
        gmKey: response.gm.gmKey,
        rememberedAt: clock(),
        lastSeenRevision: response.session.revision,
      }
      rememberIdentity(nextIdentity)
      await fetchGmManagement(nextIdentity)
      await loadSafetyStatus().catch(() => undefined)
      lastNotice.value = 'Started a GM-hosted live session in this browser.'
      return response
    } catch (error) {
      recordFailure(error)
      throw error
    } finally {
      busy.value = false
    }
  }

  const joinPlayerSession = async (form: JoinPlayerSessionForm): Promise<JoinPlayerSessionResponse> => {
    busy.value = true
    lastError.value = null
    lastNotice.value = null

    try {
      const requestBody: Record<string, unknown> = {}
      if (form.joinCode !== undefined && form.joinCode.trim().length > 0) {
        requestBody.joinCode = form.joinCode
      }
      if (form.displayName !== undefined) requestBody.displayName = form.displayName
      if (form.playerId !== undefined) requestBody.playerId = form.playerId

      const response = await apiClient.postJson<JoinPlayerSessionResponse>(SESSION_API_PATHS.join, requestBody)
      joinedPlayerSession.value = response
      lastAttachedSessionMap.value = null
      lastUpdatedPlayerAssignment.value = null
      const nextIdentity: Extract<SessionClientIdentity, { role: 'player' }> = {
        schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
        role: 'player',
        sessionId: response.session.sessionId,
        clientId: response.player.clientId,
        playerId: response.player.playerId,
        displayName: response.player.displayName,
        rememberedAt: clock(),
        lastSeenRevision: response.session.revision,
      }
      rememberIdentity(nextIdentity)
      await fetchPlayerState(nextIdentity)
      lastNotice.value = `Joined the live session as ${response.player.displayName}.`
      return response
    } catch (error) {
      recordFailure(error)
      throw error
    } finally {
      busy.value = false
    }
  }

  const attachMapToSession = async (form: AttachSessionMapForm): Promise<AttachSessionMapResult> => {
    busy.value = true
    lastError.value = null
    lastNotice.value = null

    try {
      const currentIdentity = identity.value ?? identityStorage.load()
      if (identity.value === null && currentIdentity !== null) {
        identity.value = currentIdentity
      }
      if (currentIdentity?.role !== 'gm') {
        throw new Error('A remembered GM live session is required before attaching a session map.')
      }

      const requestBody: AttachSessionMapInput = {
        sessionId: currentIdentity.sessionId,
        gmKey: currentIdentity.gmKey,
        gmClientId: currentIdentity.clientId,
        mapSlug: form.mapSlug.trim(),
        ...(form.selectedMapBehavior === undefined
          ? {}
          : { selectedMapBehavior: form.selectedMapBehavior }),
        ...(form.visibilityBehavior === undefined
          ? {}
          : { visibilityBehavior: form.visibilityBehavior }),
      }

      const response = await apiClient.postJson<AttachSessionMapResult>(
        SESSION_API_PATHS.attachMap,
        requestBody,
      )
      lastAttachedSessionMap.value = response
      lastUpdatedPlayerAssignment.value = null
      const refreshedIdentity = rememberIdentityRevision(currentIdentity, response.session.revision)
      await fetchGmManagement(refreshedIdentity)
      lastNotice.value = `Attached ${response.map.mapSlug} to the live session map.`
      return response
    } catch (error) {
      recordFailure(error)
      throw error
    } finally {
      busy.value = false
    }
  }

  const selectedMapSlugForTokenAssignment = (): string | null => {
    const selectedMap = gmManagement.value?.selectedMap
    if (selectedMap?.availableForSessionMode === true) return selectedMap.mapSlug

    const session = gmManagement.value?.session
    if (
      session?.selectedMapAttached === true &&
      session.sessionMapAvailable === true &&
      session.selectedMapSlug !== null
    ) {
      return session.selectedMapSlug
    }

    return lastAttachedSessionMap.value?.map.mapSlug ?? null
  }

  const mapTokenResourceForAssignment = (
    form: UpdatePlayerMapTokenAssignmentForm,
  ): SessionTokenResourceRef => {
    const fallbackMapSlug = selectedMapSlugForTokenAssignment()
    const requestedMapSlug = normalizeSessionTokenAssignmentText(form.mapSlug)
    const resource = buildSessionMapTokenResource({
      tokenId: form.tokenId,
      mapSlug: requestedMapSlug,
      sheetKind: form.sheetKind,
      sheetSlug: form.sheetSlug,
    }, {
      fallbackMapSlug,
    })

    if (resource === null) {
      throw new Error('Choose a token on an attached live session map before assigning player token control.')
    }

    return resource
  }

  const updatePlayerAssignment = async (
    form: UpdatePlayerAssignmentForm,
  ): Promise<UpdatePlayerAssignmentResponse> => {
    busy.value = true
    lastError.value = null
    lastNotice.value = null

    try {
      const currentIdentity = identity.value ?? identityStorage.load()
      if (identity.value === null && currentIdentity !== null) {
        identity.value = currentIdentity
      }
      if (currentIdentity?.role !== 'gm') {
        throw new Error('A remembered GM live session is required before assigning player tokens.')
      }

      const response = await apiClient.postJson<UpdatePlayerAssignmentResponse>(
        SESSION_API_PATHS.assignments,
        {
          sessionId: currentIdentity.sessionId,
          gmKey: currentIdentity.gmKey,
          gmClientId: currentIdentity.clientId,
          playerId: form.playerId,
          action: form.action,
          resources: form.resources,
        },
      )
      lastUpdatedPlayerAssignment.value = response
      const refreshedIdentity = rememberIdentityRevision(currentIdentity, response.session.revision)
      await fetchGmManagement(refreshedIdentity)
      const resourceCount = response.change.resources.length
      const resourceLabel = resourceCount === 1 ? 'token resource' : 'token resources'
      lastNotice.value = `${response.change.action === 'assign' ? 'Assigned' : 'Unassigned'} ${resourceCount} ${resourceLabel} for ${response.player.displayName}.`
      return response
    } catch (error) {
      recordFailure(error)
      throw error
    } finally {
      busy.value = false
    }
  }

  const updatePlayerMapTokenAssignment = async (
    action: UpdatePlayerAssignmentAction,
    form: UpdatePlayerMapTokenAssignmentForm,
  ): Promise<UpdatePlayerAssignmentResponse> => {
    let resource: SessionTokenResourceRef
    try {
      resource = mapTokenResourceForAssignment(form)
    } catch (error) {
      recordFailure(error)
      throw error
    }

    return await updatePlayerAssignment({
      playerId: form.playerId,
      action,
      resources: [resource],
    })
  }

  const assignSessionMapTokenToPlayer = async (
    form: UpdatePlayerMapTokenAssignmentForm,
  ): Promise<UpdatePlayerAssignmentResponse> =>
    await updatePlayerMapTokenAssignment('assign', form)

  const unassignSessionMapTokenFromPlayer = async (
    form: UpdatePlayerMapTokenAssignmentForm,
  ): Promise<UpdatePlayerAssignmentResponse> =>
    await updatePlayerMapTokenAssignment('unassign', form)

  const refreshSessionSummary = async (): Promise<
    GmSessionManagementResponse | PlayerSessionStateResponse | null
  > => {
    const currentIdentity = identity.value
    if (currentIdentity === null) {
      lastError.value = null
      lastNotice.value = 'No remembered live session identity was found in this browser.'
      return null
    }

    busy.value = true
    lastError.value = null
    lastNotice.value = null

    try {
      const response = currentIdentity.role === 'gm'
        ? await fetchGmManagement(currentIdentity)
        : await fetchPlayerState(currentIdentity)
      lastNotice.value = 'Refreshed the remembered live session.'
      return response
    } catch (error) {
      recordFailure(error)
      throw error
    } finally {
      busy.value = false
    }
  }

  const loadRememberedIdentity = async (
    loadOptions: { readonly refresh?: boolean } = {},
  ): Promise<SessionClientIdentity | null> => {
    const loadedIdentity = identityStorage.load()
    identity.value = loadedIdentity

    if (loadedIdentity === null) {
      lastNotice.value = 'No remembered live session identity was found in this browser.'
      return null
    }

    lastError.value = null
    lastNotice.value = 'Loaded the remembered live session identity for this browser.'
    if (loadOptions.refresh) await refreshSessionSummary()
    return loadedIdentity
  }

  const clearRememberedIdentity = (): void => {
    identityStorage.clear()
    identity.value = null
    startedGmSession.value = null
    gmManagement.value = null
    joinedPlayerSession.value = null
    playerState.value = null
    lastAttachedSessionMap.value = null
    lastUpdatedPlayerAssignment.value = null
    lastError.value = null
    lastNotice.value = 'Cleared the remembered live session identity for this browser.'
  }

  return {
    identity,
    startedGmSession,
    gmManagement,
    joinedPlayerSession,
    playerState,
    playerProfileLobby,
    lastAttachedSessionMap,
    lastUpdatedPlayerAssignment,
    safetyStatus,
    safetyError,
    busy,
    lastError,
    lastNotice,
    activeRole,
    hasRememberedIdentity,
    gmJoinCode,
    gmSession,
    playerSession,
    playerIdentity,
    playerProfileSession,
    playerProfiles,
    loadSafetyStatus,
    loadPlayerProfiles,
    startGmSession,
    joinPlayerSession,
    attachMapToSession,
    updatePlayerAssignment,
    assignSessionMapTokenToPlayer,
    unassignSessionMapTokenFromPlayer,
    refreshSessionSummary,
    loadRememberedIdentity,
    clearRememberedIdentity,
  }
}
