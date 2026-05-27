import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import {
  updatePlayerProfile as updateStoredPlayerProfile,
  type UpdatePlayerProfileInput as UpdateStoredPlayerProfileInput,
} from '../utils/playerProfileStorage'
import {
  PlayerProfileUseCaseError,
  assertGmProfileRequest,
  assertPlayerProfileRequestObject,
  hasOwn,
  messageFromError,
  normalizePlayerProfileRequestDisplayName,
  normalizePlayerProfileRequestId,
  normalizePlayerProfileRequestLinkedCharacters,
} from './playerProfileUseCaseHelpers'

export interface UpdatePlayerProfileInput {
  readonly role: AuthRole
  readonly profileId?: unknown
  readonly displayName?: unknown
  readonly linkedCharacters?: unknown
}

export interface UpdatePlayerProfileDependencies {
  readonly updateProfile?: (
    profileId: unknown,
    input: UpdateStoredPlayerProfileInput,
  ) => PlayerProfile | null
}

export interface UpdatePlayerProfileResult {
  readonly profile: PlayerProfile
}

export const updatePlayerProfileUseCase = (
  input: UpdatePlayerProfileInput,
  dependencies: UpdatePlayerProfileDependencies = {},
): UpdatePlayerProfileResult => {
  const request = assertPlayerProfileRequestObject(input, 'Player profile update input')
  assertGmProfileRequest(request.role)

  const profileId = normalizePlayerProfileRequestId(request.profileId)
  const update: {
    displayName?: UpdateStoredPlayerProfileInput['displayName']
    linkedCharacters?: UpdateStoredPlayerProfileInput['linkedCharacters']
  } = {}

  if (hasOwn(request, 'displayName')) {
    update.displayName = normalizePlayerProfileRequestDisplayName(request.displayName)
  }

  if (hasOwn(request, 'linkedCharacters')) {
    update.linkedCharacters = normalizePlayerProfileRequestLinkedCharacters(request.linkedCharacters)
  }

  if (!hasOwn(update, 'displayName') && !hasOwn(update, 'linkedCharacters')) {
    throw new PlayerProfileUseCaseError(
      400,
      'At least one of displayName or linkedCharacters is required',
    )
  }

  const updateProfile = dependencies.updateProfile ?? updateStoredPlayerProfile

  try {
    const profile = updateProfile(profileId, update)
    if (!profile) throw new PlayerProfileUseCaseError(404, `Player profile ${profileId} not found`)
    return { profile }
  } catch (error) {
    if (error instanceof PlayerProfileUseCaseError) throw error

    const message = messageFromError(error)
    if (
      message.includes('profileId')
      || message.includes('displayName')
      || message.includes('linkedCharacters')
    ) {
      throw new PlayerProfileUseCaseError(400, message)
    }
    throw error
  }
}
