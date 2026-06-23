import { describe, expect, it, vi } from 'vitest'
import { loadSheetUseCase, LoadSheetUseCaseError } from '../../server/useCases/loadSheet'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '../../shared/playerProfiles'

const playerProfile = (linkedCharacters: PlayerProfile['linkedCharacters']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_ash00000' as PlayerProfileId,
  displayName: 'Ash' as PlayerProfileDisplayName,
  linkedCharacters,
})

const sheetRepositoryFor = (sheet: Record<string, unknown> | null, trainerSheets: readonly Record<string, unknown>[] = []) => ({
  getByRef: vi.fn((kind: 'pokemon' | 'trainer', slug: string) => sheet
    ? { kind, slug, sheet, revision: Number(sheet.revision ?? 0), updatedAt: 0 }
    : null),
  list: vi.fn(() => trainerSheets.map((trainer) => ({
    kind: 'trainer' as const,
    slug: String(trainer.slug),
    document: trainer,
    revision: Number(trainer.revision ?? 0),
    updatedAt: 0,
  }))),
})

describe('load sheet use case', () => {
  it('loads a persisted sheet for GMs', () => {
    const sheet = { slug: 'new-trainer-1', name: 'New Trainer', level: 1, folder: 'players/Hassan', player: false }
    const sheetRepository = sheetRepositoryFor(sheet)

    expect(loadSheetUseCase({ role: 'gm', kind: 'trainer', slug: 'new-trainer-1' }, { sheetRepository })).toEqual({
      kind: 'trainer',
      slug: 'new-trainer-1',
      sheet,
    })
    expect(sheetRepository.getByRef).toHaveBeenCalledWith('trainer', 'new-trainer-1')
  })

  it('allows players to load only player-accessible sheets', () => {
    const sheet = { slug: 'pika', nickname: 'Pika', species: 'Pikachu', level: 5, folder: 'players/Hassan', player: true }

    expect(loadSheetUseCase({
      role: 'player',
      kind: 'pokemon',
      slug: 'pika',
    }, { sheetRepository: sheetRepositoryFor(sheet) })).toEqual({ kind: 'pokemon', slug: 'pika', sheet })
  })

  it('rejects inaccessible player sheet loads', () => {
    expect(() => loadSheetUseCase({
      role: 'player',
      kind: 'trainer',
      slug: 'locked',
    }, { sheetRepository: sheetRepositoryFor({ slug: 'locked', name: 'Locked', level: 1, player: false }) }))
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
    }, { sheetRepository: sheetRepositoryFor(sheet) })).toEqual({
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
      sheetRepository: sheetRepositoryFor(sheet),
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
    }, { sheetRepository: sheetRepositoryFor({ slug: 'locked', nickname: 'Locked', species: 'Pikachu', level: 5, player: false }) }))
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
    }, { sheetRepository: sheetRepositoryFor(sheet) })).toEqual({
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
    }, { sheetRepository: sheetRepositoryFor(null) }))
      .toThrow(new LoadSheetUseCaseError(404, 'Sheet missing.json not found'))
  })
})
