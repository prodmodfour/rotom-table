import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import {
  createPlayerProfile as createStoredPlayerProfile,
  type CreatePlayerProfileInput as CreateStoredPlayerProfileInput,
} from '../utils/playerProfileStorage'
import {
  PlayerProfileUseCaseError,
  assertGmProfileRequest,
  assertPlayerProfileRequestObject,
  hasOwn,
  messageFromError,
  normalizePlayerProfileRequestDisplayName,
} from './playerProfileUseCaseHelpers'

export interface CreatePlayerProfileInput {
  readonly role: AuthRole
  readonly displayName?: unknown
  readonly linkedCharacters?: unknown
}

export interface CreatePlayerProfileDependencies {
  readonly createProfile?: (input: CreateStoredPlayerProfileInput) => PlayerProfile
}

export interface CreatePlayerProfileResult {
  readonly profile: PlayerProfile
}

const isProfileStorageConflict = (message: string): boolean => (
  message.includes('already exists') || message.includes('Could not allocate a free player profile id')
)

export const createPlayerProfileUseCase = (
  input: CreatePlayerProfileInput,
  dependencies: CreatePlayerProfileDependencies = {},
): CreatePlayerProfileResult => {
  const request = assertPlayerProfileRequestObject(input, 'Player profile create input')
  assertGmProfileRequest(request.role)

  if (hasOwn(request, 'linkedCharacters')) {
    throw new PlayerProfileUseCaseError(
      400,
      'linkedCharacters cannot be set when creating a player profile',
    )
  }

  const displayName = normalizePlayerProfileRequestDisplayName(request.displayName)
  const createProfile = dependencies.createProfile ?? createStoredPlayerProfile

  try {
    return { profile: createProfile({ displayName }) }
  } catch (error) {
    if (error instanceof PlayerProfileUseCaseError) throw error

    const message = messageFromError(error)
    if (isProfileStorageConflict(message)) throw new PlayerProfileUseCaseError(409, message)
    if (message.includes('displayName') || message.includes('linkedCharacters')) {
      throw new PlayerProfileUseCaseError(400, message)
    }
    throw error
  }
}
