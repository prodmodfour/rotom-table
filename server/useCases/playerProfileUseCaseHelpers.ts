import { isAuthRole, type AuthRole } from '#shared/auth'
import {
  normalizeLinkedCharacterRefs,
  parsePlayerProfileDisplayName,
  parsePlayerProfileId,
  sanitizePlayerProfileDisplayNameString,
  type LinkedCharacterRef,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export type PlayerProfileUseCaseErrorStatus = 400 | 401 | 403 | 404 | 409

export class PlayerProfileUseCaseError extends UseCaseHttpError<PlayerProfileUseCaseErrorStatus> {}

type UnknownRecord = Record<string, unknown>

export const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

export const hasOwn = <TKey extends PropertyKey>(
  value: object,
  key: TKey,
): value is object & Record<TKey, unknown> => Object.prototype.hasOwnProperty.call(value, key)

export const messageFromError = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
)

export const assertPlayerProfileRequestObject = (
  input: unknown,
  label: string,
): UnknownRecord => {
  if (!isRecord(input)) throw new PlayerProfileUseCaseError(400, `${label} must be an object`)
  return input
}

export const assertAuthenticatedProfileRequest = (roleInput: unknown): AuthRole => {
  if (!isAuthRole(roleInput)) throw new PlayerProfileUseCaseError(401, 'Login required')
  return roleInput
}

export const assertGmProfileRequest = (roleInput: unknown): AuthRole => {
  const role = assertAuthenticatedProfileRequest(roleInput)
  if (role !== 'gm') throw new PlayerProfileUseCaseError(403, 'GM login required')
  return role
}

export const normalizePlayerProfileRequestId = (
  value: unknown,
  label = 'profileId',
): PlayerProfileId => {
  try {
    return parsePlayerProfileId(value, label)
  } catch (error) {
    throw new PlayerProfileUseCaseError(400, messageFromError(error))
  }
}

export const normalizePlayerProfileRequestDisplayName = (
  value: unknown,
  label = 'displayName',
): PlayerProfileDisplayName => {
  if (typeof value !== 'string') {
    throw new PlayerProfileUseCaseError(400, `${label} must be a string`)
  }

  const displayName = sanitizePlayerProfileDisplayNameString(value)
  if (!displayName) throw new PlayerProfileUseCaseError(400, `${label} is required`)

  try {
    return parsePlayerProfileDisplayName(displayName, label)
  } catch (error) {
    throw new PlayerProfileUseCaseError(400, messageFromError(error))
  }
}

export const normalizePlayerProfileRequestLinkedCharacters = (
  value: unknown,
  label = 'linkedCharacters',
): readonly LinkedCharacterRef[] => {
  try {
    return normalizeLinkedCharacterRefs(value, label)
  } catch (error) {
    throw new PlayerProfileUseCaseError(400, messageFromError(error))
  }
}
