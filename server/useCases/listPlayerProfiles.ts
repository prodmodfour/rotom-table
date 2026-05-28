import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import {
  listPlayerProfiles as listStoredPlayerProfiles,
} from '../utils/playerProfileStorage'
import {
  assertAuthenticatedProfileRequest,
  assertPlayerProfileRequestObject,
} from './playerProfileUseCaseHelpers'

export interface ListPlayerProfilesInput {
  readonly role: AuthRole
}

export interface ListPlayerProfilesDependencies {
  readonly listProfiles?: () => PlayerProfile[]
}

export interface ListPlayerProfilesResult {
  readonly profiles: PlayerProfile[]
}

export const listPlayerProfilesUseCase = (
  input: ListPlayerProfilesInput,
  dependencies: ListPlayerProfilesDependencies = {},
): ListPlayerProfilesResult => {
  const request = assertPlayerProfileRequestObject(input, 'Player profile list input')
  assertAuthenticatedProfileRequest(request.role)

  const listProfiles = dependencies.listProfiles ?? listStoredPlayerProfiles
  return { profiles: listProfiles() }
}
