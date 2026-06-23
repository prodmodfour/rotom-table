import type { AuthRole } from '#shared/auth'
import {
  linkedCharacterRefKey,
  type LinkedCharacterRef,
  type PlayerProfile,
} from '#shared/playerProfiles'
import {
  updatePlayerProfile as updateStoredPlayerProfile,
  type UpdatePlayerProfileInput as UpdateStoredPlayerProfileInput,
} from '../utils/playerProfileStorage'
import { sqliteSheetRepository } from '../storage/sheetRepository'
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
  readonly sheetExists?: (ref: LinkedCharacterRef) => boolean
}

export interface UpdatePlayerProfileResult {
  readonly profile: PlayerProfile
}

const defaultSheetExists = (ref: LinkedCharacterRef): boolean =>
  sqliteSheetRepository.getByRef(ref.sheetKind, ref.sheetSlug) !== null

const assertLinkedCharacterSheetsExist = (
  refs: readonly LinkedCharacterRef[],
  sheetExists: (ref: LinkedCharacterRef) => boolean,
): void => {
  for (const ref of refs) {
    if (!sheetExists(ref)) {
      throw new PlayerProfileUseCaseError(
        400,
        `linkedCharacters contains unknown ${ref.sheetKind} sheet "${ref.sheetSlug}" (${linkedCharacterRefKey(ref)})`,
      )
    }
  }
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
    const linkedCharacters = normalizePlayerProfileRequestLinkedCharacters(request.linkedCharacters)
    assertLinkedCharacterSheetsExist(linkedCharacters, dependencies.sheetExists ?? defaultSheetExists)
    update.linkedCharacters = linkedCharacters
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
