import { describe, expect, it, vi } from 'vitest'
import { loadSheetUseCase, LoadSheetUseCaseError } from '../../server/useCases/loadSheet'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '../../shared/playerProfiles'
import type { SheetKind } from '../../shared/sheets'

const playerProfile = (linkedCharacters: PlayerProfile['linkedCharacters']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_ash00000' as PlayerProfileId,
  displayName: 'Ash' as PlayerProfileDisplayName,
  linkedCharacters,
})

describe('load sheet use case', () => {
  it('loads a persisted sheet for GMs', () => {
    const sheet = { slug: 'new-trainer-1', name: 'New Trainer', level: 1, folder: 'players/Hassan', player: false }
    const readSheet = vi.fn((_kind: SheetKind, _slug: string) => ({ sheet }))

    expect(loadSheetUseCase({ role: 'gm', kind: 'trainer', slug: 'new-trainer-1' }, { readSheet })).toEqual({
      kind: 'trainer',
      slug: 'new-trainer-1',
      sheet,
    })
    expect(readSheet).toHaveBeenCalledWith('trainer', 'new-trainer-1')
  })

  it('allows players to load only player-accessible sheets', () => {
    const sheet = { slug: 'pika', nickname: 'Pika', species: 'Pikachu', level: 5, folder: 'players/Hassan', player: true }

    expect(loadSheetUseCase({
      role: 'player',
      kind: 'pokemon',
      slug: 'pika',
    }, { readSheet: () => ({ sheet }) })).toEqual({ kind: 'pokemon', slug: 'pika', sheet })
  })

  it('rejects inaccessible player sheet loads', () => {
    expect(() => loadSheetUseCase({
      role: 'player',
      kind: 'trainer',
      slug: 'locked',
    }, { readSheet: () => ({ sheet: { slug: 'locked', name: 'Locked', level: 1, player: false } }) }))
      .toThrow(new LoadSheetUseCaseError(
        403,
        'Sheet is not marked as player accessible or linked to the selected player profile',
      ))
  })

  it('allows players to load sheets linked to their selected player profile', () => {
    const sheet = { slug: 'locked', name: 'Locked', level: 1, player: false }

    expect(loadSheetUseCase({
      role: 'player',
      kind: 'trainer',
      slug: 'locked',
      playerProfile: playerProfile([{ sheetKind: 'trainer', sheetSlug: 'locked' }]),
    }, { readSheet: () => ({ sheet }) })).toEqual({
      kind: 'trainer',
      slug: 'locked',
      sheet,
    })
  })

  it('allows players to load private Pokémon linked through their selected trainer', () => {
    const sheet = { slug: 'locked', nickname: 'Locked', species: 'Pikachu', level: 5, player: false }
    const listTrainerSheets = vi.fn(() => [{ slug: 'ash', currentTeam: ['locked'] }])

    expect(loadSheetUseCase({
      role: 'player',
      kind: 'pokemon',
      slug: 'locked',
      playerProfile: playerProfile([{ sheetKind: 'trainer', sheetSlug: 'ash' }]),
    }, {
      readSheet: () => ({ sheet }),
      listTrainerSheets,
    })).toEqual({ kind: 'pokemon', slug: 'locked', sheet })
    expect(listTrainerSheets).toHaveBeenCalledOnce()
  })

  it('does not let one selected player profile load another profile linked sheet', () => {
    expect(() => loadSheetUseCase({
      role: 'player',
      kind: 'pokemon',
      slug: 'locked',
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'other' }]),
    }, { readSheet: () => ({ sheet: { slug: 'locked', nickname: 'Locked', species: 'Pikachu', level: 5, player: false } }) }))
      .toThrow(new LoadSheetUseCaseError(
        403,
        'Sheet is not marked as player accessible or linked to the selected player profile',
      ))
  })

  it('allows players to load sheets granted by a live-session assignment', () => {
    const sheet = { slug: 'locked', name: 'Locked', level: 1, player: false }

    expect(loadSheetUseCase({
      role: 'player',
      kind: 'trainer',
      slug: 'locked',
      canAccessPlayerSheet: (kind, slug) => kind === 'trainer' && slug === 'locked',
    }, { readSheet: () => ({ sheet }) })).toEqual({
      kind: 'trainer',
      slug: 'locked',
      sheet,
    })
  })

  it('returns a not-found error when storage cannot find the sheet', () => {
    expect(() => loadSheetUseCase({
      role: 'gm',
      kind: 'trainer',
      slug: 'missing',
    }, { readSheet: () => null }))
      .toThrow(new LoadSheetUseCaseError(404, 'Sheet missing.json not found'))
  })
})
