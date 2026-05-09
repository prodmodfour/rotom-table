import { describe, expect, it } from 'vitest'
import {
  buildDisplayedPokedexEvolutions,
  pokedexPageTitle,
  requestedPokemonNameForRoute,
  selectPokedexEntry,
} from '~/composables/pokedex/usePokedexBrowser'
import type { DisplayPokedexEntry } from '~/utils/pokedex/entryIndex'

const makeEntry = (overrides: Partial<DisplayPokedexEntry>): DisplayPokedexEntry => ({
  id: overrides.id ?? overrides.slug ?? 'entry',
  species: overrides.species ?? 'Entry',
  slug: overrides.slug ?? 'entry',
  nationalDexNumber: overrides.nationalDexNumber ?? null,
  searchText: '',
  searchTexts: {
    any: '',
    identity: '',
    type: '',
    ability: '',
    capability: '',
    move: '',
    habitat: '',
    breeding: '',
    diet: '',
    skill: '',
    stat: '',
    size: '',
  },
  ...overrides,
})

describe('usePokedexBrowser helpers', () => {
  const bulbasaur = makeEntry({
    id: '1-bulbasaur',
    species: 'Bulbasaur',
    slug: 'bulbasaur',
    evolutions: [
      { stage: 2, species: 'Ivysaur', min_level: 16 },
      { stage: 1, species: 'Bulbasaur' },
      { stage: 3, species: 'Missingno' },
    ],
  })
  const ivysaur = makeEntry({ id: '2-ivysaur', species: 'Ivysaur', slug: 'ivysaur' })
  const entryBySlug = new Map([
    [bulbasaur.slug, bulbasaur],
    [ivysaur.slug, ivysaur],
  ])

  it('selects a routed entry or falls back to the first filtered row', () => {
    expect(selectPokedexEntry('ivysaur', [bulbasaur], entryBySlug)).toBe(ivysaur)
    expect(selectPokedexEntry('missingno', [bulbasaur], entryBySlug)).toBeNull()
    expect(selectPokedexEntry(null, [bulbasaur], entryBySlug)).toBe(bulbasaur)
    expect(selectPokedexEntry(null, [], entryBySlug)).toBeNull()
  })

  it('normalizes requested missing route labels', () => {
    expect(requestedPokemonNameForRoute(null, null, 'bulbasaur')).toBeNull()
    expect(requestedPokemonNameForRoute('bulbasaur', bulbasaur, 'bulbasaur')).toBeNull()
    expect(requestedPokemonNameForRoute('missingno', null, ['Missing_No'])).toBe('Missing_No')
    expect(requestedPokemonNameForRoute('missingno', null, undefined)).toBe('missingno')
  })

  it('builds display evolutions with self links suppressed', () => {
    expect(buildDisplayedPokedexEvolutions(bulbasaur, bulbasaur.id, entryBySlug)).toEqual([
      { stage: 2, species: 'Ivysaur', min_level: 16, href: '/pokedex/ivysaur' },
      { stage: 1, species: 'Bulbasaur', href: null },
      { stage: 3, species: 'Missingno', href: null },
    ])
  })

  it('formats route-aware page titles', () => {
    expect(pokedexPageTitle(null, null)).toBe('Pokédex · Rotom Table')
    expect(pokedexPageTitle('bulbasaur', bulbasaur)).toBe('Bulbasaur · Pokédex · Rotom Table')
    expect(pokedexPageTitle('missingno', null)).toBe('Pokémon not found · Pokédex · Rotom Table')
  })
})
