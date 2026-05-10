import { describe, expect, it, vi } from 'vitest'
import { createSheetUseCase } from '../../server/useCases/createSheet'
import type { SheetKind } from '../../shared/sheets'

const createdPokemon = {
  kind: 'pokemon' as const,
  slug: 'new-pokemon',
  folder: 'party/bench',
  sheet: {
    slug: 'new-pokemon',
    nickname: 'New Pokémon',
    species: 'Bulbasaur',
    level: 1,
    player: false,
  },
  filePath: '/repo/data/sheets/party/bench/new-pokemon.json',
  relativePath: 'data/sheets/party/bench/new-pokemon.json',
}

describe('create sheet use case', () => {
  it('creates a Pokémon sheet and emits a compatible sheet-library update event', () => {
    const createSheet = vi.fn((_kind: SheetKind, _folder: string) => createdPokemon)

    const result = createSheetUseCase({
      kind: 'pokemon',
      folder: 'party/bench',
      clientId: 'client-1',
    }, { createSheet })

    expect(createSheet).toHaveBeenCalledWith('pokemon', 'party/bench')
    expect(result).toMatchObject({
      ok: true,
      kind: 'pokemon',
      slug: 'new-pokemon',
      path: 'data/sheets/party/bench/new-pokemon.json',
    })
    expect(result.events).toEqual([
      {
        channel: 'sheets',
        type: 'updated',
        clientId: 'client-1',
        data: {
          kind: 'pokemon',
          slug: 'new-pokemon',
          sheet: { ...createdPokemon.sheet, folder: 'party/bench' },
        },
      },
    ])
  })

  it('preserves trainer creation response data and root-folder realtime payloads', () => {
    const trainerSheet = {
      kind: 'trainer' as const,
      slug: 'new-trainer',
      folder: '',
      sheet: { slug: 'new-trainer', name: 'New Trainer', level: 1, player: false },
      filePath: '/repo/data/trainers/new-trainer.json',
      relativePath: 'data/trainers/new-trainer.json',
    }
    const createSheet = vi.fn(() => trainerSheet)

    const result = createSheetUseCase({ kind: 'trainer', folder: '' }, { createSheet })

    expect(createSheet).toHaveBeenCalledWith('trainer', '')
    expect(result).toMatchObject({
      ok: true,
      kind: 'trainer',
      slug: 'new-trainer',
      path: 'data/trainers/new-trainer.json',
    })
    expect(result.events[0]).toMatchObject({
      channel: 'sheets',
      type: 'updated',
      clientId: undefined,
      data: {
        kind: 'trainer',
        slug: 'new-trainer',
        sheet: { ...trainerSheet.sheet, folder: '' },
      },
    })
  })

  it('uses the persisted folder from storage in realtime payloads', () => {
    const createSheet = vi.fn(() => ({ ...createdPokemon, folder: 'sanitized/folder' }))

    const result = createSheetUseCase({ kind: 'pokemon', folder: '/sanitized/folder/' }, { createSheet })

    expect(result.events[0]?.data).toMatchObject({
      sheet: { folder: 'sanitized/folder' },
    })
  })

  it('lets unexpected storage failures bubble so route boundaries keep server-error semantics', () => {
    const createSheet = vi.fn(() => {
      throw new Error('Could not allocate a free slug')
    })

    expect(() => createSheetUseCase({ kind: 'pokemon', folder: '' }, { createSheet }))
      .toThrow('Could not allocate a free slug')
  })
})
