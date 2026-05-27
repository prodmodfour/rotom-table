import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  isLinkedCharacterRef,
  isPlayerProfile,
  isPlayerProfileDisplayName,
  isPlayerProfileId,
  linkedCharacterRefKey,
  normalizeLinkedCharacterRef,
  normalizeLinkedCharacterRefs,
  normalizePlayerProfile,
  parsePlayerProfileDisplayName,
  parsePlayerProfileId,
  sanitizePlayerProfileDisplayName,
  type LinkedCharacterRef,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'

describe('player profile domain types', () => {
  it('brands validated player profile identifiers', () => {
    const id = parsePlayerProfileId('profile_ash-123_456')

    expect(id).toBe('profile_ash-123_456')
    expect(isPlayerProfileId(id)).toBe(true)
    expect(isPlayerProfileId('profile_short')).toBe(false)
    expect(isPlayerProfileId('player_ash-123_456')).toBe(false)
    expect(isPlayerProfileId('profile_with/slash')).toBe(false)
    expect(isPlayerProfileId(null)).toBe(false)
    expect(() => parsePlayerProfileId('profile_short')).toThrow('profileId must match')

    expectTypeOf(id).toEqualTypeOf<PlayerProfileId>()
  })

  it('sanitizes and parses safe player profile display names', () => {
    const displayName = sanitizePlayerProfileDisplayName('  Ash\n<Ketchum>\t  ')
    const collapsedName = sanitizePlayerProfileDisplayName('Misty\u00A0  Water')
    const fallbackName = sanitizePlayerProfileDisplayName(' \n\t ', 'Guest')
    const clippedName = sanitizePlayerProfileDisplayName('A'.repeat(65))

    expect(displayName).toBe('Ash Ketchum')
    expect(collapsedName).toBe('Misty Water')
    expect(fallbackName).toBe('Guest')
    expect(clippedName).toBe('A'.repeat(64))
    expect(isPlayerProfileDisplayName(displayName)).toBe(true)
    expect(isPlayerProfileDisplayName(' Ash')).toBe(false)
    expect(isPlayerProfileDisplayName('Ash\nKetchum')).toBe(false)
    expect(isPlayerProfileDisplayName('')).toBe(false)
    expect(() => parsePlayerProfileDisplayName('  Brock')).toThrow('displayName must be')
    expect(() => parsePlayerProfileDisplayName('B'.repeat(65))).toThrow('displayName must be')

    expectTypeOf(displayName).toEqualTypeOf<PlayerProfileDisplayName>()
  })

  it('normalizes Pokémon and trainer linked character refs', () => {
    const pokemon = normalizeLinkedCharacterRef({
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
      ignored: 'extra API fields are not kept',
    })
    const trainer = normalizeLinkedCharacterRef({ sheetKind: 'trainer', sheetSlug: 'brock' })

    expect(pokemon).toEqual({ sheetKind: 'pokemon', sheetSlug: 'pikachu' })
    expect(trainer).toEqual({ sheetKind: 'trainer', sheetSlug: 'brock' })
    expect(isLinkedCharacterRef(pokemon)).toBe(true)
    expect(isLinkedCharacterRef(trainer)).toBe(true)
    expect(linkedCharacterRefKey(pokemon)).toBe('pokemon:pikachu')

    expectTypeOf(pokemon).toEqualTypeOf<LinkedCharacterRef>()
  })

  it('rejects malformed linked character refs', () => {
    expect(() => normalizeLinkedCharacterRef(null)).toThrow('linkedCharacter must be an object')
    expect(() => normalizeLinkedCharacterRef({ sheetKind: 'item', sheetSlug: 'potion' })).toThrow(
      'linkedCharacter.sheetKind must be pokemon | trainer',
    )
    expect(() => normalizeLinkedCharacterRef({ sheetKind: 'pokemon', sheetSlug: 'Pikachu' })).toThrow(
      'linkedCharacter.sheetSlug must be sheet slug matching /^[a-z0-9-]+$/',
    )
    expect(() => normalizeLinkedCharacterRef({ sheetKind: 'trainer', sheetSlug: '' })).toThrow(
      'linkedCharacter.sheetSlug must be sheet slug matching /^[a-z0-9-]+$/',
    )
    expect(isLinkedCharacterRef({ sheetKind: 'pokemon', sheetSlug: '../pikachu' })).toBe(false)
  })

  it('normalizes linked character ref lists deterministically and rejects duplicates', () => {
    const refs = normalizeLinkedCharacterRefs([
      { sheetKind: 'trainer', sheetSlug: 'brock' },
      { sheetKind: 'pokemon', sheetSlug: 'pikachu' },
      { sheetKind: 'pokemon', sheetSlug: 'abra' },
    ])

    expect(refs).toEqual([
      { sheetKind: 'pokemon', sheetSlug: 'abra' },
      { sheetKind: 'pokemon', sheetSlug: 'pikachu' },
      { sheetKind: 'trainer', sheetSlug: 'brock' },
    ])
    expect(() => normalizeLinkedCharacterRefs({ sheetKind: 'pokemon', sheetSlug: 'pikachu' })).toThrow(
      'linkedCharacters must be an array',
    )
    expect(() =>
      normalizeLinkedCharacterRefs([
        { sheetKind: 'pokemon', sheetSlug: 'pikachu' },
        { sheetKind: 'pokemon', sheetSlug: 'pikachu' },
      ]),
    ).toThrow('linkedCharacters must not contain duplicate character ref "pokemon:pikachu"')
  })

  it('normalizes valid persistent player profiles', () => {
    const profile = normalizePlayerProfile({
      schemaVersion: 1,
      id: 'profile_party001',
      displayName: 'The Party',
      linkedCharacters: [
        { sheetKind: 'trainer', sheetSlug: 'misty' },
        { sheetKind: 'pokemon', sheetSlug: 'starmie' },
      ],
    })

    expect(profile).toEqual({
      schemaVersion: 1,
      id: 'profile_party001',
      displayName: 'The Party',
      linkedCharacters: [
        { sheetKind: 'pokemon', sheetSlug: 'starmie' },
        { sheetKind: 'trainer', sheetSlug: 'misty' },
      ],
    })
    expect(isPlayerProfile(profile)).toBe(true)

    expectTypeOf(profile).toEqualTypeOf<PlayerProfile>()
  })

  it('rejects invalid persistent player profiles', () => {
    const baseProfile = {
      schemaVersion: 1,
      id: 'profile_party001',
      displayName: 'The Party',
      linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'starmie' }],
    }

    expect(() => normalizePlayerProfile(null)).toThrow('playerProfile must be an object')
    expect(() => normalizePlayerProfile({ ...baseProfile, schemaVersion: 2 })).toThrow(
      'playerProfile.schemaVersion must be 1',
    )
    expect(() => normalizePlayerProfile({ ...baseProfile, id: 'party01' })).toThrow(
      'playerProfile.id must match',
    )
    expect(() => normalizePlayerProfile({ ...baseProfile, displayName: ' Party' })).toThrow(
      'playerProfile.displayName must be',
    )
    expect(() =>
      normalizePlayerProfile({
        ...baseProfile,
        linkedCharacters: [
          { sheetKind: 'pokemon', sheetSlug: 'starmie' },
          { sheetKind: 'pokemon', sheetSlug: 'starmie' },
        ],
      }),
    ).toThrow('playerProfile.linkedCharacters must not contain duplicate character ref')
    expect(isPlayerProfile({ ...baseProfile, linkedCharacters: [] })).toBe(true)
    expect(isPlayerProfile({ ...baseProfile, linkedCharacters: [{ sheetKind: 'unknown', sheetSlug: 'x' }] })).toBe(false)
  })
})
