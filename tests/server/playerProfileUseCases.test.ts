import { describe, expect, it, vi } from 'vitest'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  linkedCharacterRefKey,
  normalizeLinkedCharacterRefs,
  parsePlayerProfileDisplayName,
  parsePlayerProfileId,
  type LinkedCharacterRef,
  type PlayerProfile,
} from '#shared/playerProfiles'
import { createPlayerProfileUseCase } from '~~/server/useCases/createPlayerProfile'
import { listPlayerProfilesUseCase } from '~~/server/useCases/listPlayerProfiles'
import {
  PlayerProfileUseCaseError,
} from '~~/server/useCases/playerProfileUseCaseHelpers'
import { updatePlayerProfileUseCase } from '~~/server/useCases/updatePlayerProfile'
import type {
  CreatePlayerProfileInput as CreateStoredPlayerProfileInput,
  UpdatePlayerProfileInput as UpdateStoredPlayerProfileInput,
} from '~~/server/utils/playerProfileStorage'

const makeProfile = (
  id: string,
  displayName: string,
  linkedCharacters: readonly LinkedCharacterRef[] = [],
): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: parsePlayerProfileId(id),
  displayName: parsePlayerProfileDisplayName(displayName),
  linkedCharacters,
})

const expectUseCaseError = (
  action: () => unknown,
  statusCode: number,
  message: string,
): void => {
  expect(action).toThrow(PlayerProfileUseCaseError)

  try {
    action()
    throw new Error('expected player profile use-case error')
  } catch (error) {
    expect(error).toMatchObject({ statusCode, message })
  }
}

describe('player profile use cases', () => {
  it('lists profiles for authenticated GM and player requests', () => {
    const ash = makeProfile('profile_ash00000', 'Ash')
    const misty = makeProfile('profile_misty000', 'Misty')
    const listProfiles = vi.fn(() => [ash, misty])

    expect(listPlayerProfilesUseCase({ role: 'player' }, { listProfiles })).toEqual({
      profiles: [ash, misty],
    })
    expect(listPlayerProfilesUseCase({ role: 'gm' }, { listProfiles })).toEqual({
      profiles: [ash, misty],
    })
    expect(listProfiles).toHaveBeenCalledTimes(2)

    expectUseCaseError(
      () => listPlayerProfilesUseCase({ role: null as never }, { listProfiles }),
      401,
      'Login required',
    )
  })

  it('creates a profile from a sanitized display name without linked characters for GM requests', () => {
    const created = makeProfile('profile_ash-ketchum', 'Ash Ketchum')
    const createProfile = vi.fn((input: CreateStoredPlayerProfileInput) => {
      expect(input).toEqual({ displayName: 'Ash Ketchum' })
      return created
    })

    expect(createPlayerProfileUseCase({
      role: 'gm',
      displayName: '  Ash\n<Ketchum>\t ',
    }, { createProfile })).toEqual({ profile: created })
    expect(createProfile).toHaveBeenCalledOnce()
  })

  it('rejects unauthorized or malformed profile creation requests before storage mutation', () => {
    const createProfile = vi.fn(() => makeProfile('profile_unused00', 'Unused'))

    expectUseCaseError(
      () => createPlayerProfileUseCase({ role: 'player', displayName: 'Ash' }, { createProfile }),
      403,
      'GM login required',
    )
    expectUseCaseError(
      () => createPlayerProfileUseCase({ role: 'gm', displayName: '  ' }, { createProfile }),
      400,
      'displayName is required',
    )
    expectUseCaseError(
      () => createPlayerProfileUseCase({ role: 'gm', displayName: 42 }, { createProfile }),
      400,
      'displayName must be a string',
    )
    expectUseCaseError(
      () => createPlayerProfileUseCase({
        role: 'gm',
        displayName: 'Ash',
        linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }],
      }, { createProfile }),
      400,
      'linkedCharacters cannot be set when creating a player profile',
    )
    expect(createProfile).not.toHaveBeenCalled()
  })

  it('maps profile creation storage conflicts to conflict errors', () => {
    const createProfile = vi.fn(() => {
      throw new Error('Player profile profile_ash00000 already exists')
    })

    expectUseCaseError(
      () => createPlayerProfileUseCase({ role: 'gm', displayName: 'Ash' }, { createProfile }),
      409,
      'Player profile profile_ash00000 already exists',
    )
  })

  it('updates display names and linked characters only for GM-authorized requests', () => {
    const linkedCharacters = normalizeLinkedCharacterRefs([
      { sheetKind: 'trainer', sheetSlug: 'brock' },
      { sheetKind: 'pokemon', sheetSlug: 'geodude' },
    ])
    const updated = makeProfile('profile_brock000', 'Brock Stone', linkedCharacters)
    const updateProfile = vi.fn((
      profileId: unknown,
      input: UpdateStoredPlayerProfileInput,
    ) => {
      expect(profileId).toBe('profile_brock000')
      expect(input).toEqual({
        displayName: 'Brock Stone',
        linkedCharacters,
      })
      return updated
    })
    const sheetExists = vi.fn((ref: LinkedCharacterRef) => (
      new Set(['pokemon:geodude', 'trainer:brock']).has(linkedCharacterRefKey(ref))
    ))

    expect(updatePlayerProfileUseCase({
      role: 'gm',
      profileId: 'profile_brock000',
      displayName: ' Brock\tStone ',
      linkedCharacters: [
        { sheetKind: 'trainer', sheetSlug: 'brock' },
        { sheetKind: 'pokemon', sheetSlug: 'geodude' },
      ],
    }, { updateProfile, sheetExists })).toEqual({ profile: updated })
    expect(sheetExists).toHaveBeenCalledTimes(2)
    expect(updateProfile).toHaveBeenCalledOnce()
  })

  it('rejects unauthorized or malformed profile update requests before storage mutation', () => {
    const updateProfile = vi.fn(() => makeProfile('profile_brock000', 'Brock'))

    expectUseCaseError(
      () => updatePlayerProfileUseCase({
        role: 'player',
        profileId: 'profile_brock000',
        displayName: 'Brock',
      }, { updateProfile }),
      403,
      'GM login required',
    )
    expectUseCaseError(
      () => updatePlayerProfileUseCase({
        role: 'gm',
        profileId: 'bad-id',
        displayName: 'Brock',
      }, { updateProfile }),
      400,
      'profileId must match /^profile_[A-Za-z0-9_-]{8,64}$/',
    )
    expectUseCaseError(
      () => updatePlayerProfileUseCase({
        role: 'gm',
        profileId: 'profile_brock000',
        linkedCharacters: [
          { sheetKind: 'pokemon', sheetSlug: 'geodude' },
          { sheetKind: 'pokemon', sheetSlug: 'geodude' },
        ],
      }, { updateProfile }),
      400,
      'linkedCharacters must not contain duplicate character ref "pokemon:geodude"',
    )
    expectUseCaseError(
      () => updatePlayerProfileUseCase({
        role: 'gm',
        profileId: 'profile_brock000',
      }, { updateProfile }),
      400,
      'At least one of displayName or linkedCharacters is required',
    )
    expect(updateProfile).not.toHaveBeenCalled()
  })

  it('rejects profile links to sheets that are not in the current libraries', () => {
    const updateProfile = vi.fn(() => makeProfile('profile_brock000', 'Brock'))
    const sheetExists = vi.fn(() => false)

    expectUseCaseError(
      () => updatePlayerProfileUseCase({
        role: 'gm',
        profileId: 'profile_brock000',
        linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'missing-trainer' }],
      }, { updateProfile, sheetExists }),
      400,
      'linkedCharacters contains unknown trainer sheet "missing-trainer" (trainer:missing-trainer)',
    )
    expect(sheetExists).toHaveBeenCalledWith({ sheetKind: 'trainer', sheetSlug: 'missing-trainer' })
    expect(updateProfile).not.toHaveBeenCalled()
  })

  it('returns a not-found error when updating a missing profile', () => {
    const updateProfile = vi.fn(() => null)

    expectUseCaseError(
      () => updatePlayerProfileUseCase({
        role: 'gm',
        profileId: 'profile_missing1',
        displayName: 'Missing',
      }, { updateProfile }),
      404,
      'Player profile profile_missing1 not found',
    )
    expect(updateProfile).toHaveBeenCalledWith('profile_missing1', { displayName: 'Missing' })
  })
})
