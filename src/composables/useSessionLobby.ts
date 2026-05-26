import { computed, ref } from 'vue'
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
} from '#shared/sessionPermissions'
import type { MapRevision, SessionRevision } from '#shared/sessionRevisions'
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

export interface GmSessionManagementResponse {
  readonly session: SessionLobbySessionSummary & {
    readonly selectedMapSlug: SelectedSessionMapSlug
    readonly playerCount: number
    readonly connectedClientCount: number
    readonly assignmentCount: number
    readonly mapCount: number
  }
  readonly join: {
    readonly joinCode: JoinCode
  }
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
    readonly currentMapVisible: boolean
    readonly currentMap: {
      readonly mapSlug: SessionMapSlug
      readonly revision: MapRevision
    } | null
    readonly visibleMapSlugs: readonly SessionMapSlug[]
    readonly visibleMaps: readonly {
      readonly mapSlug: SessionMapSlug
      readonly revision: MapRevision
    }[]
  }
}

export interface JoinPlayerSessionForm {
  readonly joinCode: string
  readonly displayName: string
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

  const rememberIdentity = (nextIdentity: SessionClientIdentity): SessionClientIdentity => {
    identity.value = nextIdentity
    identityStorage.remember(nextIdentity)
    return nextIdentity
  }

  const rememberIdentityRevision = (
    nextIdentity: SessionClientIdentity,
    revision: SessionRevision,
  ): SessionClientIdentity => rememberIdentity(updateSessionClientIdentityRevision(
    nextIdentity,
    revision,
    clock(),
  ))

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

  const startGmSession = async (): Promise<StartGmSessionResponse> => {
    busy.value = true
    lastError.value = null
    lastNotice.value = null

    try {
      const response = await apiClient.postJson<StartGmSessionResponse>(SESSION_API_PATHS.start, {})
      startedGmSession.value = response
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
      lastNotice.value = 'Started a GM-hosted Track 2 session in this browser.'
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
      const response = await apiClient.postJson<JoinPlayerSessionResponse>(SESSION_API_PATHS.join, {
        joinCode: form.joinCode,
        displayName: form.displayName,
      })
      joinedPlayerSession.value = response
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
      lastNotice.value = `Joined the Track 2 session as ${response.player.displayName}.`
      return response
    } catch (error) {
      recordFailure(error)
      throw error
    } finally {
      busy.value = false
    }
  }

  const refreshSessionSummary = async (): Promise<
    GmSessionManagementResponse | PlayerSessionStateResponse | null
  > => {
    const currentIdentity = identity.value
    if (currentIdentity === null) {
      lastError.value = null
      lastNotice.value = 'No remembered Track 2 session identity was found in this browser.'
      return null
    }

    busy.value = true
    lastError.value = null
    lastNotice.value = null

    try {
      const response = currentIdentity.role === 'gm'
        ? await fetchGmManagement(currentIdentity)
        : await fetchPlayerState(currentIdentity)
      lastNotice.value = 'Refreshed the remembered Track 2 session.'
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
      lastNotice.value = 'No remembered Track 2 session identity was found in this browser.'
      return null
    }

    lastError.value = null
    lastNotice.value = 'Loaded the remembered Track 2 session identity for this browser.'
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
    lastError.value = null
    lastNotice.value = 'Cleared the remembered Track 2 session identity for this browser.'
  }

  return {
    identity,
    startedGmSession,
    gmManagement,
    joinedPlayerSession,
    playerState,
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
    loadSafetyStatus,
    startGmSession,
    joinPlayerSession,
    refreshSessionSummary,
    loadRememberedIdentity,
    clearRememberedIdentity,
  }
}
