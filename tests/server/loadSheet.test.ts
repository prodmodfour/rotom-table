import { describe, expect, it, vi } from 'vitest'
import { loadSheetUseCase, LoadSheetUseCaseError } from '../../server/useCases/loadSheet'
import type { SheetKind } from '../../shared/sheets'

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
      .toThrow(new LoadSheetUseCaseError(403, 'Sheet is not marked as player accessible'))
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
