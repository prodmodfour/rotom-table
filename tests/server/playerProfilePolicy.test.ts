import { describe, expect, it, vi } from 'vitest'
import {
  playerCanAccessSheet,
  playerProfileCanAccessSheet,
  playerProfileSheetAccessKeys,
  playerSheetAccessSource,
  resolvePlayerProfileForPolicy,
  PlayerProfilePolicyError,
} from '../../server/policies/playerProfilePolicy'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '../../shared/playerProfiles'

const profile = (linkedCharacters: PlayerProfile['linkedCharacters']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_ash00000' as PlayerProfileId,
  displayName: 'Ash' as PlayerProfileDisplayName,
  linkedCharacters,
})

describe('player profile sheet policy', () => {
  it('derives linked sheet access from selected player profile character refs', () => {
    const selectedProfile = profile([
      { sheetKind: 'pokemon', sheetSlug: 'pika' },
      { sheetKind: 'trainer', sheetSlug: 'ash' },
    ])

    expect(playerProfileCanAccessSheet(selectedProfile, 'pokemon', 'pika')).toBe(true)
    expect(playerProfileCanAccessSheet(selectedProfile, 'trainer', 'ash')).toBe(true)
    expect(playerProfileCanAccessSheet(selectedProfile, 'pokemon', 'ash')).toBe(false)
    expect(playerProfileCanAccessSheet(null, 'pokemon', 'pika')).toBe(false)
    expect([...playerProfileSheetAccessKeys(selectedProfile)].sort()).toEqual([
      'pokemon:pika',
      'trainer:ash',
    ])
  })

  it('keeps public sheet access and additional grants while recognizing linked private sheets', () => {
    const selectedProfile = profile([{ sheetKind: 'trainer', sheetSlug: 'ash' }])

    expect(playerSheetAccessSource({
      kind: 'pokemon',
      slug: 'public-pika',
      sheet: { player: true },
      playerProfile: null,
    })).toBe('public-sheet')
    expect(playerSheetAccessSource({
      kind: 'trainer',
      slug: 'ash',
      sheet: { player: false },
      playerProfile: selectedProfile,
    })).toBe('linked-player-profile')
    expect(playerCanAccessSheet({
      kind: 'pokemon',
      slug: 'session-pika',
      sheet: { player: false },
      canAccessPlayerSheet: (kind, slug) => kind === 'pokemon' && slug === 'session-pika',
    })).toBe(true)
    expect(playerCanAccessSheet({
      kind: 'pokemon',
      slug: 'locked',
      sheet: { player: false },
      playerProfile: selectedProfile,
    })).toBe(false)
  })

  it('loads selected player profiles by id for API policy boundaries', () => {
    const selectedProfile = profile([])
    const readProfile = vi.fn(() => selectedProfile)

    expect(resolvePlayerProfileForPolicy('profile_ash00000', { readProfile })).toBe(selectedProfile)
    expect(readProfile).toHaveBeenCalledWith('profile_ash00000')
    expect(resolvePlayerProfileForPolicy(undefined, { readProfile })).toBeNull()
  })

  it('rejects malformed or missing selected player profile ids', () => {
    expect(() => resolvePlayerProfileForPolicy(['profile_ash00000'])).toThrow(
      new PlayerProfilePolicyError(400, 'profileId must be a single player profile id'),
    )
    expect(() => resolvePlayerProfileForPolicy('not-a-profile')).toThrow(PlayerProfilePolicyError)
    expect(() => resolvePlayerProfileForPolicy('profile_missing0', { readProfile: () => null })).toThrow(
      new PlayerProfilePolicyError(404, 'Player profile profile_missing0 not found'),
    )
  })
})
