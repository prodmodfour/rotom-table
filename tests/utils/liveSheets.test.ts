import { describe, expect, it } from 'vitest'
import { replaceLiveSheetMaps } from '~/utils/liveSheets'
import {
  applyLiveSheetRealtimeEvent,
  buildLiveSheetMaps,
  createLiveSheetCacheController,
} from '~/utils/liveSheetCache'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

const pokemon = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'bolt',
  nickname: 'Bolt',
  species: 'Pikachu',
  level: 5,
  revision: 0,
  ...overrides,
})

const trainer = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'ash',
  name: 'Ash',
  level: 1,
  revision: 0,
  ...overrides,
})

describe('liveSheets utilities', () => {
  it('reconciles maps with runtime sheet list results through the revision-aware controller', () => {
    const maps = buildLiveSheetMaps([pokemon()], [trainer()])

    replaceLiveSheetMaps(maps, {
      pokemonSheets: [pokemon({ slug: 'ember', nickname: 'Ember', species: 'Charmander', player: true, revision: 1 })],
      trainerSheets: [],
    })

    expect([...maps.pokemonBySlug.keys()]).toEqual(['ember'])
    expect(maps.pokemonBySlug.get('ember')).toMatchObject({ player: true })
    expect(maps.trainerBySlug.size).toBe(0)
  })

  it('adds newly-created complete sheets from realtime update events', () => {
    const maps = buildLiveSheetMaps([], [])
    const controller = createLiveSheetCacheController(maps)

    const result = applyLiveSheetRealtimeEvent(controller, {
      type: 'updated',
      data: {
        kind: 'pokemon',
        slug: 'new-pokemon',
        sheet: pokemon({ slug: 'new-pokemon', nickname: 'New Pokémon', player: true, revision: 1 }),
      },
    })

    expect(result.status).toBe('adopted')
    expect(maps.pokemonBySlug.get('new-pokemon')).toMatchObject({ nickname: 'New Pokémon', player: true })
  })

  it('does not preserve arbitrary document fields when authoritative updates omit them', () => {
    const maps = buildLiveSheetMaps([
      pokemon({ slug: 'example', folder: 'examples/generated', revision: 1 }),
    ], [])
    const controller = createLiveSheetCacheController(maps)

    applyLiveSheetRealtimeEvent(controller, {
      type: 'updated',
      data: {
        kind: 'pokemon',
        slug: 'example',
        sheet: pokemon({ slug: 'example', nickname: 'Updated Example', revision: 2 }),
      },
    })

    expect(maps.pokemonBySlug.get('example')).toMatchObject({
      nickname: 'Updated Example',
    })
    expect(maps.pokemonBySlug.get('example')).not.toHaveProperty('folder')
  })

  it('invalidates rather than patching incomplete move events', () => {
    const maps = buildLiveSheetMaps([pokemon({ folder: 'old', revision: 1 })], [])
    const controller = createLiveSheetCacheController(maps)

    const result = applyLiveSheetRealtimeEvent(controller, {
      type: 'moved',
      data: { kind: 'pokemon', slug: 'bolt', folder: 'players/ash' },
    })

    expect(result.status).toBe('invalidated')
    expect(controller.reconciliationRequired).toBe(true)
    expect(maps.pokemonBySlug.get('bolt')?.folder).toBe('old')
  })
})
