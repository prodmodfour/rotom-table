import { describe, expect, it } from 'vitest'
import {
  applyLiveSheetRealtimeEvent,
  buildLiveSheetMaps,
  replaceLiveSheetMaps,
} from '~/utils/liveSheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

const pokemon = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'bolt',
  nickname: 'Bolt',
  species: 'Pikachu',
  level: 5,
  ...overrides,
})

const trainer = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'ash',
  name: 'Ash',
  level: 1,
  ...overrides,
})

describe('liveSheets utilities', () => {
  it('reconciles maps with runtime sheet list results', () => {
    const maps = buildLiveSheetMaps([pokemon()], [trainer()])

    replaceLiveSheetMaps(maps, {
      pokemonSheets: [pokemon({ slug: 'ember', nickname: 'Ember', species: 'Charmander', player: true })],
      trainerSheets: [],
    })

    expect([...maps.pokemonBySlug.keys()]).toEqual(['ember'])
    expect(maps.pokemonBySlug.get('ember')).toMatchObject({ player: true })
    expect(maps.trainerBySlug.size).toBe(0)
  })

  it('adds newly-created sheets from realtime update events', () => {
    const maps = buildLiveSheetMaps([], [])

    const changed = applyLiveSheetRealtimeEvent(maps, {
      type: 'updated',
      data: {
        kind: 'pokemon',
        slug: 'new-pokemon',
        sheet: pokemon({ slug: 'new-pokemon', nickname: 'New Pokémon', player: true }),
      },
    })

    expect(changed).toBe(true)
    expect(maps.pokemonBySlug.get('new-pokemon')).toMatchObject({ nickname: 'New Pokémon', player: true })
  })

  it('preserves derived folders when save events omit them', () => {
    const maps = buildLiveSheetMaps([
      pokemon({ slug: 'example', folder: 'examples/generated' }),
    ], [])

    applyLiveSheetRealtimeEvent(maps, {
      type: 'updated',
      data: {
        kind: 'pokemon',
        slug: 'example',
        sheet: pokemon({ slug: 'example', nickname: 'Updated Example' }),
      },
    })

    expect(maps.pokemonBySlug.get('example')).toMatchObject({
      nickname: 'Updated Example',
      folder: 'examples/generated',
    })
  })

  it('updates folder metadata from move events', () => {
    const maps = buildLiveSheetMaps([pokemon({ folder: 'old' })], [trainer({ folder: 'old' })])

    expect(applyLiveSheetRealtimeEvent(maps, {
      type: 'moved',
      data: { kind: 'pokemon', slug: 'bolt', folder: 'players/ash' },
    })).toBe(true)

    expect(maps.pokemonBySlug.get('bolt')?.folder).toBe('players/ash')
  })
})
