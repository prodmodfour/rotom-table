import { describe, expect, it } from 'vitest'
import {
  actorCanControlMapPlacement,
  actorControlledMapPlacementIds,
  buildServerPlayerProfileTokenControlModel,
  playerProfileControlledMapPlacementIds,
  playerProfileTokenControlSheetPredicate,
} from '../../server/policies/playerProfileTokenControlPolicy'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '../../shared/playerProfiles'
import type { SheetPlacement } from '~/types/map'

const profile = (linkedCharacters: PlayerProfile['linkedCharacters']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_mapctrl01' as PlayerProfileId,
  displayName: 'Map Controller' as PlayerProfileDisplayName,
  linkedCharacters,
})

const placements: readonly Pick<SheetPlacement, 'id' | 'sheetKind' | 'sheetSlug'>[] = [
  { id: 'linked-pokemon', sheetKind: 'pokemon', sheetSlug: 'eevee' },
  { id: 'linked-trainer', sheetKind: 'trainer', sheetSlug: 'leaf' },
  { id: 'unrelated', sheetKind: 'pokemon', sheetSlug: 'vaporeon' },
]

describe('server player profile token control policy', () => {
  it('builds a server policy predicate from profile-linked character refs', () => {
    const selectedProfile = profile([
      { sheetKind: 'pokemon', sheetSlug: 'eevee' },
      { sheetKind: 'trainer', sheetSlug: 'leaf' },
    ])
    const canControlSheet = playerProfileTokenControlSheetPredicate(selectedProfile)

    expect(canControlSheet('pokemon', 'eevee')).toBe(true)
    expect(canControlSheet('trainer', 'leaf')).toBe(true)
    expect(canControlSheet('pokemon', 'leaf')).toBe(false)
    expect(playerProfileControlledMapPlacementIds(selectedProfile, placements)).toEqual([
      'linked-pokemon',
      'linked-trainer',
    ])
  })

  it('derives server actor control from role plus selected profile without assignments', () => {
    const selectedProfile = profile([{ sheetKind: 'pokemon', sheetSlug: 'eevee' }])

    expect(actorControlledMapPlacementIds({ role: 'gm', profile: null, placements })).toEqual([
      'linked-pokemon',
      'linked-trainer',
      'unrelated',
    ])
    expect(actorControlledMapPlacementIds({ role: 'player', profile: selectedProfile, placements })).toEqual([
      'linked-pokemon',
    ])
    expect(actorControlledMapPlacementIds({ role: 'player', profile: null, placements })).toEqual([])
    expect(actorCanControlMapPlacement({
      role: 'player',
      profile: selectedProfile,
      placement: placements[0],
    })).toBe(true)
    expect(actorCanControlMapPlacement({
      role: 'player',
      profile: selectedProfile,
      placement: placements[1],
    })).toBe(false)
  })

  it('allows players to control Pokémon from linked trainer sheets', () => {
    const selectedProfile = profile([{ sheetKind: 'trainer', sheetSlug: 'leaf' }])
    const linkedTrainerSheets = [{ slug: 'leaf', currentTeam: ['vaporeon'] }]

    expect(playerProfileTokenControlSheetPredicate(selectedProfile, linkedTrainerSheets)('pokemon', 'vaporeon')).toBe(true)
    expect(playerProfileControlledMapPlacementIds(selectedProfile, placements, linkedTrainerSheets)).toEqual([
      'linked-trainer',
      'unrelated',
    ])
    expect(actorControlledMapPlacementIds({
      role: 'player',
      profile: selectedProfile,
      placements,
      linkedTrainerSheets,
    })).toEqual([
      'linked-trainer',
      'unrelated',
    ])
    expect(actorCanControlMapPlacement({
      role: 'player',
      profile: selectedProfile,
      placement: placements[2],
      linkedTrainerSheets,
    })).toBe(true)
  })

  it('exposes missing-profile status for player map actions that need a profile', () => {
    expect(buildServerPlayerProfileTokenControlModel({
      role: 'player',
      profile: null,
      placements,
    })).toMatchObject({
      status: 'missing-profile',
      controllablePlacementIds: [],
      requiresProfile: true,
    })
  })
})
