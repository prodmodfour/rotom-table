import { computed, ref } from 'vue'
import {
  normalizePlayerProfile,
  parsePlayerProfileId,
  type PlayerProfile,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import { PLAYER_PROFILE_API_PATHS } from '~/utils/apiRoutes'
import type { ApiClient } from '~/utils/apiClient'
import { useApiClient } from '~/composables/useApiClient'
import { playerProfileErrorMessage } from '~/composables/usePlayerProfiles'

export interface UseGmPlayerProfileManagementOptions {
  readonly apiClient?: ApiClient
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const normalizePlayerProfileListResponse = (response: unknown): PlayerProfile[] => {
  if (!isRecord(response) || !Array.isArray(response.profiles)) {
    throw new Error('Player profile list response must include a profiles array.')
  }

  return response.profiles.map((profile, index) => normalizePlayerProfile(profile, `profiles[${index}]`))
}

const comparePlayerProfilesForManagement = (left: PlayerProfile, right: PlayerProfile): number => {
  const displayNameOrder = left.displayName.localeCompare(right.displayName)
  if (displayNameOrder !== 0) return displayNameOrder
  return left.id.localeCompare(right.id)
}

export const useGmPlayerProfileManagement = (
  options: UseGmPlayerProfileManagementOptions = {},
) => {
  const apiClient = options.apiClient ?? useApiClient()

  const profiles = ref<PlayerProfile[]>([])
  const selectedProfileId = ref<PlayerProfileId | null>(null)
  const loading = ref(false)
  const lastError = ref<string | null>(null)
  const lastNotice = ref<string | null>(null)

  const hasProfiles = computed(() => profiles.value.length > 0)
  const profileCount = computed(() => profiles.value.length)
  const selectedProfile = computed<PlayerProfile | null>(() => {
    const profileId = selectedProfileId.value
    if (profileId === null) return null
    return profiles.value.find((profile) => profile.id === profileId) ?? null
  })

  const recordFailure = (error: unknown): void => {
    lastError.value = playerProfileErrorMessage(error)
    lastNotice.value = null
  }

  const syncSelectionAfterLoad = (): void => {
    const profileId = selectedProfileId.value
    if (profileId === null) return
    if (!profiles.value.some((profile) => profile.id === profileId)) selectedProfileId.value = null
  }

  const loadProfiles = async (): Promise<PlayerProfile[]> => {
    loading.value = true
    lastError.value = null
    lastNotice.value = null

    try {
      const response = await apiClient.getJson<unknown>(PLAYER_PROFILE_API_PATHS.list)
      profiles.value = normalizePlayerProfileListResponse(response).sort(comparePlayerProfilesForManagement)
      syncSelectionAfterLoad()
      lastNotice.value = profiles.value.length === 0
        ? 'No player profiles found.'
        : `Loaded ${profiles.value.length} player profile${profiles.value.length === 1 ? '' : 's'}.`
      return profiles.value
    } catch (error) {
      recordFailure(error)
      throw error
    } finally {
      loading.value = false
    }
  }

  const selectProfile = (profileIdInput: unknown): PlayerProfile => {
    try {
      const profileId = parsePlayerProfileId(profileIdInput)
      const profile = profiles.value.find((candidate) => candidate.id === profileId) ?? null
      if (profile === null) throw new Error(`Player profile ${profileId} has not been loaded.`)
      selectedProfileId.value = profileId
      lastError.value = null
      lastNotice.value = `Opened player profile ${profile.displayName}.`
      return profile
    } catch (error) {
      recordFailure(error)
      throw error
    }
  }

  const clearSelectedProfile = (): void => {
    selectedProfileId.value = null
    lastError.value = null
    lastNotice.value = null
  }

  return {
    profiles,
    selectedProfileId,
    selectedProfile,
    hasProfiles,
    profileCount,
    loading,
    lastError,
    lastNotice,
    loadProfiles,
    reloadProfiles: loadProfiles,
    selectProfile,
    clearSelectedProfile,
  }
}
