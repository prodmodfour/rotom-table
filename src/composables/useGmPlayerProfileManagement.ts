import { computed, ref } from 'vue'
import {
  linkedCharacterRefKey,
  normalizeLinkedCharacterRef,
  normalizeLinkedCharacterRefs,
  normalizePlayerProfile,
  parsePlayerProfileId,
  type LinkedCharacterRef,
  type PlayerProfile,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import { PLAYER_PROFILE_API_PATHS, SHEET_API_PATHS } from '~/utils/apiRoutes'
import type { ApiClient } from '~/utils/apiClient'
import { useApiClient } from '~/composables/useApiClient'
import { playerProfileErrorMessage } from '~/composables/usePlayerProfiles'
import {
  buildLinkableCharacterSheetOptions,
  filterAvailableLinkableCharacterOptions,
  linkableCharacterOptionByKey,
  playerProfileLinkedCharacterLabel,
  type LinkableCharacterSheetOption,
  type LinkablePokemonSheetSummary,
  type LinkableTrainerSheetSummary,
} from '~/utils/playerProfileManagement'

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

const normalizePlayerProfileUpdateResponse = (response: unknown): PlayerProfile => {
  if (!isRecord(response)) throw new Error('Player profile update response must be an object.')
  return normalizePlayerProfile(response.profile, 'profile')
}

const normalizeOptionalString = (value: unknown): string | undefined => (
  typeof value === 'string' ? value : undefined
)

const normalizeLinkablePokemonSheetSummary = (
  value: unknown,
  label: string,
): LinkablePokemonSheetSummary => {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  if (typeof value.slug !== 'string') throw new Error(`${label}.slug must be a string.`)
  return {
    slug: value.slug,
    nickname: normalizeOptionalString(value.nickname),
    species: normalizeOptionalString(value.species),
    folder: normalizeOptionalString(value.folder),
  }
}

const normalizeLinkableTrainerSheetSummary = (
  value: unknown,
  label: string,
): LinkableTrainerSheetSummary => {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  if (typeof value.slug !== 'string') throw new Error(`${label}.slug must be a string.`)
  return {
    slug: value.slug,
    name: normalizeOptionalString(value.name),
    folder: normalizeOptionalString(value.folder),
  }
}

const normalizeLinkableSheetListResponse = (response: unknown): LinkableCharacterSheetOption[] => {
  if (!isRecord(response) || !Array.isArray(response.pokemonSheets) || !Array.isArray(response.trainerSheets)) {
    throw new Error('Sheet list response must include pokemonSheets and trainerSheets arrays.')
  }

  return buildLinkableCharacterSheetOptions({
    pokemonSheets: response.pokemonSheets.map((sheet, index) => (
      normalizeLinkablePokemonSheetSummary(sheet, `pokemonSheets[${index}]`)
    )),
    trainerSheets: response.trainerSheets.map((sheet, index) => (
      normalizeLinkableTrainerSheetSummary(sheet, `trainerSheets[${index}]`)
    )),
  })
}

const comparePlayerProfilesForManagement = (left: PlayerProfile, right: PlayerProfile): number => {
  const displayNameOrder = left.displayName.localeCompare(right.displayName)
  if (displayNameOrder !== 0) return displayNameOrder
  return left.id.localeCompare(right.id)
}

const upsertPlayerProfileForManagement = (
  profiles: readonly PlayerProfile[],
  profile: PlayerProfile,
): PlayerProfile[] => {
  let replaced = false
  const nextProfiles = profiles.map((candidate) => {
    if (candidate.id !== profile.id) return candidate
    replaced = true
    return profile
  })
  if (!replaced) nextProfiles.push(profile)
  return nextProfiles.sort(comparePlayerProfilesForManagement)
}

export const useGmPlayerProfileManagement = (
  options: UseGmPlayerProfileManagementOptions = {},
) => {
  const apiClient = options.apiClient ?? useApiClient()

  const profiles = ref<PlayerProfile[]>([])
  const selectedProfileId = ref<PlayerProfileId | null>(null)
  const linkableCharacterOptions = ref<LinkableCharacterSheetOption[]>([])
  const loading = ref(false)
  const loadingLinkableCharacters = ref(false)
  const savingProfileLinks = ref(false)
  const lastError = ref<string | null>(null)
  const lastNotice = ref<string | null>(null)

  const hasProfiles = computed(() => profiles.value.length > 0)
  const profileCount = computed(() => profiles.value.length)
  const selectedProfile = computed<PlayerProfile | null>(() => {
    const profileId = selectedProfileId.value
    if (profileId === null) return null
    return profiles.value.find((profile) => profile.id === profileId) ?? null
  })

  const availableLinkOptions = computed<LinkableCharacterSheetOption[]>(() => (
    selectedProfile.value
      ? filterAvailableLinkableCharacterOptions(
        linkableCharacterOptions.value,
        selectedProfile.value.linkedCharacters,
      )
      : []
  ))

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

  const loadLinkableCharacters = async (): Promise<LinkableCharacterSheetOption[]> => {
    loadingLinkableCharacters.value = true
    lastError.value = null
    lastNotice.value = null

    try {
      const response = await apiClient.getJson<unknown>(SHEET_API_PATHS.list)
      linkableCharacterOptions.value = normalizeLinkableSheetListResponse(response)
      lastNotice.value = linkableCharacterOptions.value.length === 0
        ? 'No Pokémon or trainer sheets are available to link.'
        : `Loaded ${linkableCharacterOptions.value.length} linkable character sheet${linkableCharacterOptions.value.length === 1 ? '' : 's'}.`
      return linkableCharacterOptions.value
    } catch (error) {
      recordFailure(error)
      throw error
    } finally {
      loadingLinkableCharacters.value = false
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

  const selectedProfileForLinkUpdate = (): PlayerProfile => {
    const profile = selectedProfile.value
    if (profile === null) throw new Error('Select a player profile before editing character links.')
    return profile
  }

  const resolveLoadedLinkableCharacterRef = (refInput: unknown): LinkedCharacterRef => {
    const ref = normalizeLinkedCharacterRef(refInput)
    const option = linkableCharacterOptionByKey(linkableCharacterOptions.value, linkedCharacterRefKey(ref))
    if (option === null) {
      throw new Error('Choose an existing Pokémon or trainer sheet from the loaded sheet library.')
    }
    return option.ref
  }

  const replaceProfileAfterLinkUpdate = (profile: PlayerProfile): PlayerProfile => {
    profiles.value = upsertPlayerProfileForManagement(profiles.value, profile)
    selectedProfileId.value = profile.id
    return profile
  }

  const saveLinkedCharacters = async (
    profile: PlayerProfile,
    linkedCharacters: readonly LinkedCharacterRef[],
  ): Promise<PlayerProfile> => {
    const response = await apiClient.postJson<unknown>(PLAYER_PROFILE_API_PATHS.update, {
      profileId: profile.id,
      linkedCharacters,
    })
    return replaceProfileAfterLinkUpdate(normalizePlayerProfileUpdateResponse(response))
  }

  const linkCharacterToSelectedProfile = async (refInput: unknown): Promise<PlayerProfile> => {
    savingProfileLinks.value = true
    lastError.value = null
    lastNotice.value = null

    try {
      const profile = selectedProfileForLinkUpdate()
      const ref = resolveLoadedLinkableCharacterRef(refInput)
      const linkedCharacters = normalizeLinkedCharacterRefs([...profile.linkedCharacters, ref])
      const updated = await saveLinkedCharacters(profile, linkedCharacters)
      lastNotice.value = `Linked ${playerProfileLinkedCharacterLabel(ref, linkableCharacterOptions.value)} to ${updated.displayName}.`
      return updated
    } catch (error) {
      recordFailure(error)
      throw error
    } finally {
      savingProfileLinks.value = false
    }
  }

  const unlinkCharacterFromSelectedProfile = async (refInput: unknown): Promise<PlayerProfile> => {
    savingProfileLinks.value = true
    lastError.value = null
    lastNotice.value = null

    try {
      const profile = selectedProfileForLinkUpdate()
      const ref = normalizeLinkedCharacterRef(refInput)
      const refKey = linkedCharacterRefKey(ref)
      const linkedCharacters = profile.linkedCharacters.filter((candidate) => (
        linkedCharacterRefKey(candidate) !== refKey
      ))
      if (linkedCharacters.length === profile.linkedCharacters.length) {
        throw new Error(`${playerProfileLinkedCharacterLabel(ref, linkableCharacterOptions.value)} is not linked to ${profile.displayName}.`)
      }
      const updated = await saveLinkedCharacters(profile, normalizeLinkedCharacterRefs(linkedCharacters))
      lastNotice.value = `Unlinked ${playerProfileLinkedCharacterLabel(ref, linkableCharacterOptions.value)} from ${updated.displayName}.`
      return updated
    } catch (error) {
      recordFailure(error)
      throw error
    } finally {
      savingProfileLinks.value = false
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
    linkableCharacterOptions,
    availableLinkOptions,
    loading,
    loadingLinkableCharacters,
    savingProfileLinks,
    lastError,
    lastNotice,
    loadProfiles,
    reloadProfiles: loadProfiles,
    loadLinkableCharacters,
    reloadLinkableCharacters: loadLinkableCharacters,
    selectProfile,
    linkCharacterToSelectedProfile,
    unlinkCharacterFromSelectedProfile,
    clearSelectedProfile,
  }
}
