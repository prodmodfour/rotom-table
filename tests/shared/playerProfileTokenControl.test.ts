import { describe, expect, it } from 'vitest'
import {
  actorCanControlTokenPlacement,
  buildPlayerProfileTokenControlModel,
  playerProfileCanControlTokenPlacement,
  playerProfileCanControlTokenSheet,
  playerProfileControlledPlacementIds,
  playerProfileTokenControlKeys,
  tokenPlacementSheetKey,
  uniqueTokenPlacementIds,
  type TokenControlPlacementRef,
} from '#shared/playerProfileTokenControl'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'

const profile = (linkedCharacters: PlayerProfile['linkedCharacters']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_tokenctrl01' as PlayerProfileId,
  displayName: 'Token Controller' as PlayerProfileDisplayName,
  linkedCharacters,
})

const placements: readonly TokenControlPlacementRef[] = [
  { id: 'pika-a', sheetKind: 'pokemon', sheetSlug: 'pikachu' },
  { id: 'misty-token', sheetKind: 'trainer', sheetSlug: 'misty' },
  { id: 'psyduck-token', sheetKind: 'pokemon', sheetSlug: 'psyduck' },
  { id: 'mistaken-kind', sheetKind: 'trainer', sheetSlug: 'pikachu' },
]

describe('player profile token control policy', () => {
  it('matches Pokémon and trainer token placements by linked sheet kind and slug', () => {
    const selectedProfile = profile([
      { sheetKind: 'pokemon', sheetSlug: 'pikachu' },
      { sheetKind: 'trainer', sheetSlug: 'misty' },
    ])

    expect(playerProfileCanControlTokenSheet(selectedProfile, 'pokemon', 'pikachu')).toBe(true)
    expect(playerProfileCanControlTokenSheet(selectedProfile, 'trainer', 'misty')).toBe(true)
    expect(playerProfileCanControlTokenSheet(selectedProfile, 'trainer', 'pikachu')).toBe(false)
    expect(playerProfileCanControlTokenPlacement(selectedProfile, placements[0])).toBe(true)
    expect(playerProfileCanControlTokenPlacement(selectedProfile, placements[1])).toBe(true)
    expect(playerProfileControlledPlacementIds(selectedProfile, placements)).toEqual([
      'pika-a',
      'misty-token',
    ])
    expect([...playerProfileTokenControlKeys(selectedProfile)].sort()).toEqual([
      'pokemon:pikachu',
      'trainer:misty',
    ])
    expect(tokenPlacementSheetKey(placements[0])).toBe('pokemon:pikachu')
  })

  it('lets a profile control Pokémon on a linked trainer team', () => {
    const selectedProfile = profile([{ sheetKind: 'trainer', sheetSlug: 'misty' }])
    const linkedTrainerSheets = [{ slug: 'misty', currentTeam: ['psyduck'], boxedPokemon: ['starmie'] }]

    expect(playerProfileCanControlTokenSheet(selectedProfile, 'pokemon', 'psyduck', { linkedTrainerSheets })).toBe(true)
    expect(playerProfileCanControlTokenPlacement(selectedProfile, placements[2], { linkedTrainerSheets })).toBe(true)
    expect(playerProfileControlledPlacementIds(selectedProfile, placements, { linkedTrainerSheets })).toEqual([
      'misty-token',
      'psyduck-token',
    ])
    expect([...playerProfileTokenControlKeys(selectedProfile, { linkedTrainerSheets })].sort()).toEqual([
      'pokemon:psyduck',
      'pokemon:starmie',
      'trainer:misty',
    ])
  })

  it('lets GMs control all token placements without a selected player profile', () => {
    const duplicatedPlacementIds: readonly TokenControlPlacementRef[] = [
      ...placements,
      { id: 'pika-a', sheetKind: 'pokemon', sheetSlug: 'pikachu' },
    ]

    const model = buildPlayerProfileTokenControlModel({
      role: 'gm',
      profile: null,
      placements: duplicatedPlacementIds,
    })

    expect(model.status).toBe('gm-authority')
    expect(model.canControlAllTokens).toBe(true)
    expect(model.requiresProfile).toBe(false)
    expect(model.controllablePlacementIds).toEqual([
      'pika-a',
      'misty-token',
      'psyduck-token',
      'mistaken-kind',
    ])
    expect(model.notice).toBeNull()
    expect(uniqueTokenPlacementIds(duplicatedPlacementIds)).toEqual(model.controllablePlacementIds)
  })

  it('requires a selected profile before a player can control tokens', () => {
    const model = buildPlayerProfileTokenControlModel({
      role: 'player',
      profile: null,
      placements,
    })

    expect(model.status).toBe('missing-profile')
    expect(model.controllablePlacementIds).toEqual([])
    expect(model.requiresProfile).toBe(true)
    expect(model.notice).toContain('Choose a player profile')
    expect(actorCanControlTokenPlacement({ role: 'player', profile: null, placement: placements[0] })).toBe(false)
  })

  it('controls every duplicate token placement for a linked character sheet', () => {
    const selectedProfile = profile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }])
    const duplicateTokens: readonly TokenControlPlacementRef[] = [
      { id: 'pika-a', sheetKind: 'pokemon', sheetSlug: 'pikachu' },
      { id: 'pika-b', sheetKind: 'pokemon', sheetSlug: 'pikachu' },
      { id: 'pika-b', sheetKind: 'pokemon', sheetSlug: 'pikachu' },
    ]

    expect(playerProfileControlledPlacementIds(selectedProfile, duplicateTokens)).toEqual([
      'pika-a',
      'pika-b',
    ])

    const model = buildPlayerProfileTokenControlModel({
      role: 'player',
      profile: selectedProfile,
      placements: duplicateTokens,
    })

    expect(model.status).toBe('linked-profile')
    expect(model.controllablePlacementIds).toEqual(['pika-a', 'pika-b'])
    expect(model.notice).toBeNull()
  })

  it('leaves unlinked player profiles unable to control unrelated sheets', () => {
    const selectedProfile = profile([{ sheetKind: 'trainer', sheetSlug: 'brock' }])

    const model = buildPlayerProfileTokenControlModel({
      role: 'player',
      profile: selectedProfile,
      placements,
    })

    expect(model.status).toBe('unlinked-profile')
    expect(model.controllablePlacementIds).toEqual([])
    expect(model.canControlAllTokens).toBe(false)
    expect(model.notice).toContain('no linked characters on this map')
    expect(actorCanControlTokenPlacement({ role: 'player', profile: selectedProfile, placement: placements[2] })).toBe(false)
    expect(actorCanControlTokenPlacement({ role: 'gm', profile: selectedProfile, placement: placements[2] })).toBe(true)
  })

  it('does not grant token control to guests or unrelated sheets', () => {
    const selectedProfile = profile([{ sheetKind: 'pokemon', sheetSlug: 'psyduck' }])

    expect(buildPlayerProfileTokenControlModel({
      role: null,
      profile: selectedProfile,
      placements,
    })).toMatchObject({
      status: 'guest',
      controllablePlacementIds: [],
      canControlAllTokens: false,
    })
    expect(playerProfileCanControlTokenPlacement(selectedProfile, placements[0])).toBe(false)
    expect(playerProfileCanControlTokenPlacement(selectedProfile, placements[2])).toBe(true)
  })
})
