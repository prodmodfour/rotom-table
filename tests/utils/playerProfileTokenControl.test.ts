import { describe, expect, it } from 'vitest'
import {
  buildClientPlayerProfileTokenControlModel,
  clientActorCanControlPlacement,
  clientPlayerProfileControlledPlacementIds,
} from '~/utils/playerProfileTokenControl'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import type { SheetPlacement } from '~/types/map'

const selectedProfile: PlayerProfile = {
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_client001' as PlayerProfileId,
  displayName: 'Client Player' as PlayerProfileDisplayName,
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'blue' }],
}

const placements: readonly Pick<SheetPlacement, 'id' | 'sheetKind' | 'sheetSlug'>[] = [
  { id: 'trainer-token', sheetKind: 'trainer', sheetSlug: 'blue' },
  { id: 'pokemon-token', sheetKind: 'pokemon', sheetSlug: 'blastoise' },
]

describe('client player profile token control helpers', () => {
  it('derives client-side controllable placement ids from the selected player profile', () => {
    expect(clientPlayerProfileControlledPlacementIds(selectedProfile, placements)).toEqual([
      'trainer-token',
    ])
    expect(clientPlayerProfileControlledPlacementIds(
      selectedProfile,
      placements,
      [{ slug: 'blue', currentTeam: ['blastoise'] }],
    )).toEqual([
      'trainer-token',
      'pokemon-token',
    ])
    expect(clientActorCanControlPlacement({
      role: 'player',
      profile: selectedProfile,
      placement: placements[0],
    })).toBe(true)
    expect(clientActorCanControlPlacement({
      role: 'player',
      profile: selectedProfile,
      placement: placements[1],
    })).toBe(false)
    expect(clientActorCanControlPlacement({
      role: 'player',
      profile: selectedProfile,
      placement: placements[1],
      linkedTrainerSheets: [{ slug: 'blue', currentTeam: ['blastoise'] }],
    })).toBe(true)
  })

  it('keeps GM and missing-profile client control decisions explicit', () => {
    expect(buildClientPlayerProfileTokenControlModel({
      role: 'gm',
      profile: null,
      placements,
    })).toMatchObject({
      status: 'gm-authority',
      controllablePlacementIds: ['trainer-token', 'pokemon-token'],
      canControlAllTokens: true,
    })
    expect(buildClientPlayerProfileTokenControlModel({
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
