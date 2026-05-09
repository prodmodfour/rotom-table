import { describe, expect, it } from 'vitest'
import {
  buildPokedexEntries,
  buildPokedexEntryBySlug,
  pokedexEntryPath,
  routeParamToPokedexSlug,
} from '~/utils/pokedex/entryIndex'
import type { PokedexRecord } from '~/types/pokemon'

describe('pokedex entry index helpers', () => {
  it('filters empty records, sorts by national dex, and attaches search text', () => {
    const entries = buildPokedexEntries([
      { species: 'Pikachu', types: ['Electric'] },
      { species: '' },
      { species: 'Bulbasaur', types: ['Grass', 'Poison'] },
    ] as PokedexRecord[])

    expect(entries.map((entry) => entry.species)).toEqual(['Bulbasaur', 'Pikachu'])
    expect(entries[0]).toMatchObject({ slug: 'bulbasaur', nationalDexNumber: 1 })
    expect(entries[1]).toMatchObject({ slug: 'pikachu', nationalDexNumber: 25 })
    expect(entries[1].searchText).toContain('pikachu')
    expect(entries[1].searchTexts.type).toContain('electric')
  })

  it('keeps the first entry for duplicated slugs', () => {
    const entries = buildPokedexEntries([
      { species: 'Pikachu', source_gen: 'first' },
      { species: 'Pikachu', source_gen: 'second' },
    ] as PokedexRecord[])

    expect(buildPokedexEntryBySlug(entries).get('pikachu')?.source_gen).toBe('first')
  })

  it('formats entry paths and route params consistently', () => {
    expect(pokedexEntryPath({ slug: 'mr-mime' })).toBe('/pokedex/mr-mime')
    expect(routeParamToPokedexSlug('Mr_Mime')).toBe('mr-mime')
    expect(routeParamToPokedexSlug(['Farfetch’d'])).toBe('farfetchd')
    expect(routeParamToPokedexSlug('   ')).toBeNull()
  })
})
