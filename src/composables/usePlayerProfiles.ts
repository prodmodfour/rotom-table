import { computed, ref } from 'vue'
import {
  createRememberedPlayerProfileSelection,
  normalizePlayerProfile,
  parsePlayerProfileId,
  type LinkedCharacterRef,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
  type RememberedPlayerProfileSelection,
} from '#shared/playerProfiles'
import { PLAYER_PROFILE_API_PATHS } from '~/utils/apiRoutes'
import type { ApiClient } from '~/utils/apiClient'
import { useApiClient } from '~/composables/useApiClient'
import {
  playerProfileSelectionStorage,
  type PlayerProfileSelectionStorage,
} from '~/utils/playerProfileSelectionStorage'

export interface PlayerProfileListResponse {
  readonly profiles: readonly PlayerProfile[]
}

export interface PlayerProfileCreateResponse {
  readonly profile: PlayerProfile
}

export interface UsePlayerProfilesOptions {
  readonly apiClient?: ApiClient
  readonly selectionStorage?: PlayerProfileSelectionStorage
  readonly clock?: () => string
}

export interface ReloadPlayerProfilesOptions {
  readonly silent?: boolean
  readonly clearMissingSelection?: boolean
}

export interface CreatePlayerProfileOptions {
  readonly silent?: boolean
}

interface RememberPlayerProfileOptions {
  readonly rememberedAt?: string
  readonly silent?: boolean
}

type SelectionSyncStatus = 'none' | 'selected' | 'missing'

const defaultClock = (): string => new Date().toISOString()

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const getErrorString = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  return null
}

export const playerProfileErrorMessage = (error: unknown): string => {
  if (typeof error !== 'object' || error === null) {
    return getErrorString(error) ?? 'The player profile request failed.'
  }

  const record = error as Record<string, unknown>
  const data = isRecord(record.data) ? record.data : null

  return getErrorString(data?.statusMessage)
    ?? getErrorString(data?.message)
    ?? getErrorString(record.statusMessage)
    ?? getErrorString(record.message)
    ?? 'The player profile request failed.'
}

const normalizePlayerProfileListResponse = (response: unknown): PlayerProfile[] => {
  if (!isRecord(response) || !Array.isArray(response.profiles)) {
    throw new Error('Player profile list response must include a profiles array.')
  }

  return response.profiles.map((profile, index) => normalizePlayerProfile(profile, `profiles[${index}]`))
}

const normalizePlayerProfileCreateResponse = (response: unknown): PlayerProfile => {
  if (!isRecord(response)) {
    throw new Error('Player profile create response must be an object.')
  }

  return normalizePlayerProfile(response.profile, 'profile')
}

const comparePlayerProfilesForClient = (left: PlayerProfile, right: PlayerProfile): number => {
  const displayNameOrder = left.displayName.localeCompare(right.displayName)
  if (displayNameOrder !== 0) return displayNameOrder
  return left.id.localeCompare(right.id)
}

const upsertProfile = (
  existingProfiles: readonly PlayerProfile[],
  profile: PlayerProfile,
): PlayerProfile[] => {
  let replaced = false
  const nextProfiles = existingProfiles.map((existingProfile) => {
    if (existingProfile.id !== profile.id) return existingProfile
    replaced = true
    return profile
  })

  if (!replaced) nextProfiles.push(profile)
  return nextProfiles.sort(comparePlayerProfilesForClient)
}

export const usePlayerProfiles = (options: UsePlayerProfilesOptions = {}) => {
  const apiClient = options.apiClient ?? useApiClient()
  const selectionStorage = options.selectionStorage ?? playerProfileSelectionStorage
  const clock = options.clock ?? defaultClock

  const profiles = ref<PlayerProfile[]>([])
  const selectedProfile = ref<PlayerProfile | null>(null)
  const selectedProfileSummary = ref<RememberedPlayerProfileSelection | null>(null)
  const busy = ref(false)
  const lastError = ref<string | null>(null)
  const lastNotice = ref<string | null>(null)

  const selectedProfileId = computed<PlayerProfileId | null>(() => (
    selectedProfile.value?.id ?? selectedProfileSummary.value?.profileId ?? null
  ))
  const selectedProfileDisplayName = computed<PlayerProfileDisplayName | null>(() => (
    selectedProfile.value?.displayName ?? selectedProfileSummary.value?.displayName ?? null
  ))
  const selectedLinkedCharacters = computed<readonly LinkedCharacterRef[]>(() => (
    selectedProfile.value?.linkedCharacters ?? []
  ))
  const hasSelectedProfile = computed(() => selectedProfileId.value !== null)

  const findLoadedProfile = (profileId: PlayerProfileId): PlayerProfile | null => (
    profiles.value.find((profile) => profile.id === profileId) ?? null
  )

  const recordFailure = (error: unknown): void => {
    lastError.value = playerProfileErrorMessage(error)
    lastNotice.value = null
  }

  const rememberProfile = (
    profile: PlayerProfile,
    rememberOptions: RememberPlayerProfileOptions = {},
  ): RememberedPlayerProfileSelection => {
    const normalizedProfile = normalizePlayerProfile(profile)
    const summary = createRememberedPlayerProfileSelection(
      normalizedProfile,
      rememberOptions.rememberedAt ?? clock(),
    )

    profiles.value = upsertProfile(profiles.value, normalizedProfile)
    selectedProfile.value = normalizedProfile
    selectedProfileSummary.value = summary
    selectionStorage.remember(summary)
    lastError.value = null
    if (rememberOptions.silent !== true) {
      lastNotice.value = `Selected player profile ${normalizedProfile.displayName}.`
    }
    return summary
  }

  const rememberProfileById = (profileIdInput: unknown): RememberedPlayerProfileSelection => {
    try {
      const profileId = parsePlayerProfileId(profileIdInput)
      const profile = findLoadedProfile(profileId)
      if (profile === null) throw new Error(`Player profile ${profileId} has not been loaded.`)
      return rememberProfile(profile)
    } catch (error) {
      recordFailure(error)
      throw error
    }
  }

  const loadRememberedProfile = (): RememberedPlayerProfileSelection | null => {
    const loadedSelection = selectionStorage.load()
    selectedProfileSummary.value = loadedSelection
    selectedProfile.value = loadedSelection === null ? null : findLoadedProfile(loadedSelection.profileId)
    lastError.value = null
    lastNotice.value = loadedSelection === null
      ? 'No selected player profile was remembered in this browser.'
      : 'Loaded the selected player profile for this browser.'
    return loadedSelection
  }

  const syncSelectedProfileAfterReload = (
    reloadOptions: ReloadPlayerProfilesOptions,
  ): SelectionSyncStatus => {
    const loadedSelection = selectedProfileSummary.value ?? selectionStorage.load()
    if (selectedProfileSummary.value === null) selectedProfileSummary.value = loadedSelection

    if (loadedSelection === null) {
      selectedProfile.value = null
      return 'none'
    }

    const matchingProfile = findLoadedProfile(loadedSelection.profileId)
    if (matchingProfile === null) {
      selectedProfile.value = null
      if (reloadOptions.clearMissingSelection !== false) {
        selectionStorage.clear()
        selectedProfileSummary.value = null
      }
      return 'missing'
    }

    const refreshedSummary = createRememberedPlayerProfileSelection(
      matchingProfile,
      loadedSelection.rememberedAt,
    )
    selectedProfile.value = matchingProfile
    selectedProfileSummary.value = refreshedSummary
    selectionStorage.remember(refreshedSummary)
    return 'selected'
  }

  const reloadProfiles = async (
    reloadOptions: ReloadPlayerProfilesOptions = {},
  ): Promise<PlayerProfile[]> => {
    busy.value = true
    lastError.value = null
    if (reloadOptions.silent !== true) lastNotice.value = null

    try {
      const response = await apiClient.getJson<unknown>(PLAYER_PROFILE_API_PATHS.list)
      profiles.value = normalizePlayerProfileListResponse(response)
      const selectionStatus = syncSelectedProfileAfterReload(reloadOptions)
      lastError.value = null

      if (reloadOptions.silent !== true) {
        if (selectionStatus === 'selected') {
          lastNotice.value = `Loaded selected player profile ${selectedProfileDisplayName.value}.`
        } else if (selectionStatus === 'missing') {
          lastNotice.value = 'The remembered player profile no longer exists. Choose a profile to continue.'
        } else {
          lastNotice.value = 'Loaded player profiles.'
        }
      }

      return profiles.value
    } catch (error) {
      if (reloadOptions.silent !== true) recordFailure(error)
      throw error
    } finally {
      busy.value = false
    }
  }

  const createProfile = async (
    displayName: unknown,
    createOptions: CreatePlayerProfileOptions = {},
  ): Promise<PlayerProfile> => {
    busy.value = true
    lastError.value = null
    if (createOptions.silent !== true) lastNotice.value = null

    try {
      const response = await apiClient.postJson<unknown>(PLAYER_PROFILE_API_PATHS.create, { displayName })
      const profile = normalizePlayerProfileCreateResponse(response)
      rememberProfile(profile, { silent: true })
      lastError.value = null
      if (createOptions.silent !== true) {
        lastNotice.value = `Created and selected player profile ${profile.displayName}.`
      }
      return profile
    } catch (error) {
      if (createOptions.silent !== true) recordFailure(error)
      throw error
    } finally {
      busy.value = false
    }
  }

  const clearSelectedProfile = (): void => {
    selectionStorage.clear()
    selectedProfile.value = null
    selectedProfileSummary.value = null
    lastError.value = null
    lastNotice.value = 'Cleared the selected player profile for this browser.'
  }

  return {
    profiles,
    selectedProfile,
    selectedProfileSummary,
    selectedProfileId,
    selectedProfileDisplayName,
    selectedLinkedCharacters,
    hasSelectedProfile,
    busy,
    lastError,
    lastNotice,
    loadRememberedProfile,
    reloadProfiles,
    reload: reloadProfiles,
    createProfile,
    create: createProfile,
    rememberProfile,
    remember: rememberProfile,
    rememberProfileById,
    clearSelectedProfile,
    clear: clearSelectedProfile,
  }
}
