import { describe, expect, it } from 'vitest'
import {
  buildDisplayedPokedexEvolutions,
  pokedexPageTitle,
  randomPokedexEntryPath,
  requestedPokemonNameForRoute,
  selectAdjacentPokedexEvolutionEntry,
  selectAdjacentPokedexNumberEntry,
  selectPokedexEntry,
  selectRandomPokedexEntry,
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
      { stage: 2, species: 'Ivysaur', min_level: 16, condition: 'Holding Miracle Seed' },
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
      { stage: 2, species: 'Ivysaur', min_level: 16, condition: 'Holding Miracle Seed', href: '/pokedex/ivysaur' },
      { stage: 1, species: 'Bulbasaur', href: null },
      { stage: 3, species: 'Missingno', href: null },
    ])
  })

  it('formats route-aware page titles', () => {
    expect(pokedexPageTitle(null, null)).toBe('Pokédex · Rotom Table')
    expect(pokedexPageTitle('bulbasaur', bulbasaur)).toBe('Bulbasaur · Pokédex · Rotom Table')
    expect(pokedexPageTitle('missingno', null)).toBe('Pokémon not found · Pokédex · Rotom Table')
  })

  it('selects random entries while avoiding the current selection when possible', () => {
    const charmander = makeEntry({ id: '4-charmander', species: 'Charmander', slug: 'charmander' })

    expect(selectRandomPokedexEntry([bulbasaur, ivysaur, charmander], bulbasaur.id, () => 0)).toBe(ivysaur)
    expect(selectRandomPokedexEntry([bulbasaur, ivysaur, charmander], bulbasaur.id, () => 0.99)).toBe(charmander)
    expect(selectRandomPokedexEntry([bulbasaur], bulbasaur.id, () => 0)).toBe(bulbasaur)
    expect(selectRandomPokedexEntry([], null, () => 0)).toBeNull()
  })

  it('selects adjacent entries by Pokédex order', () => {
    const charmander = makeEntry({ id: '4-charmander', species: 'Charmander', slug: 'charmander' })
    const entries = [bulbasaur, ivysaur, charmander]

    expect(selectAdjacentPokedexNumberEntry(entries, ivysaur.id, 'previous')).toBe(bulbasaur)
    expect(selectAdjacentPokedexNumberEntry(entries, ivysaur.id, 'next')).toBe(charmander)
    expect(selectAdjacentPokedexNumberEntry(entries, bulbasaur.id, 'previous')).toBeNull()
    expect(selectAdjacentPokedexNumberEntry(entries, 'missingno', 'next')).toBeNull()
  })

  it('selects adjacent evolution entries, including parser notes after species names', () => {
    const charmander = makeEntry({
      id: '4-charmander',
      species: 'Charmander',
      slug: 'charmander',
      evolutions: [
        { stage: 1, species: 'Charmander' },
        { stage: 2, species: 'Charmeleon' },
      ],
    })
    const charmeleon = makeEntry({ id: '5-charmeleon', species: 'Charmeleon', slug: 'charmeleon' })
    const eevee = makeEntry({
      id: '133-eevee',
      species: 'Eevee',
      slug: 'eevee',
      evolutions: [
        { stage: 1, species: 'Eevee' },
        { stage: 2, species: 'Jolteon Thunderstone' },
      ],
    })
    const jolteon = makeEntry({
      id: '135-jolteon',
      species: 'Jolteon',
      slug: 'jolteon',
      evolutions: eevee.evolutions,
    })
    const evolutionEntryBySlug = new Map([
      [charmander.slug, charmander],
      [charmeleon.slug, charmeleon],
      [eevee.slug, eevee],
      [jolteon.slug, jolteon],
    ])

    expect(selectAdjacentPokedexEvolutionEntry(charmander, charmander.id, evolutionEntryBySlug, 'next')).toBe(charmeleon)
    expect(selectAdjacentPokedexEvolutionEntry(eevee, eevee.id, evolutionEntryBySlug, 'next')).toBe(jolteon)
    expect(selectAdjacentPokedexEvolutionEntry(jolteon, jolteon.id, evolutionEntryBySlug, 'previous')).toBe(eevee)
    expect(selectAdjacentPokedexEvolutionEntry(jolteon, jolteon.id, evolutionEntryBySlug, 'next')).toBeNull()
  })

  it('builds random entry paths', () => {
    expect(randomPokedexEntryPath([bulbasaur, ivysaur], bulbasaur.id, () => 0)).toBe('/pokedex/ivysaur')
    expect(randomPokedexEntryPath([], null, () => 0)).toBeNull()
  })
})
