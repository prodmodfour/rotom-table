import { describe, expect, it } from 'vitest'
import {
  POKEMON_GENDER_OPTIONS,
  coercePokemonGenderForPokedexEntry,
  normalizePokemonGender,
  pokemonGenderOptionsForPokedexEntry,
  syncPokemonGenderForPokedexEntry,
} from '~/utils/sheets/pokemonGender'

const entry = (overrides: Parameters<typeof pokemonGenderOptionsForPokedexEntry>[0]) => overrides

describe('pokemon gender helpers', () => {
  it('normalizes supported gender labels', () => {
    expect(normalizePokemonGender('M')).toBe('Male')
    expect(normalizePokemonGender('♀')).toBe('Female')
    expect(normalizePokemonGender('genderless')).toBe('Genderless')
    expect(normalizePokemonGender('-')).toBeNull()
  })

  it('resolves possible genders from species gender data', () => {
    expect(pokemonGenderOptionsForPokedexEntry(null)).toBe(POKEMON_GENDER_OPTIONS)
    expect(pokemonGenderOptionsForPokedexEntry(entry({ genderless: true }))).toEqual(['Genderless'])
    expect(pokemonGenderOptionsForPokedexEntry(entry({ genderless: false, male_pct: 50, female_pct: 50 }))).toEqual(['Male', 'Female'])
    expect(pokemonGenderOptionsForPokedexEntry(entry({ genderless: false, male_pct: 100, female_pct: 0 }))).toEqual(['Male'])
    expect(pokemonGenderOptionsForPokedexEntry(entry({ genderless: false, male_pct: 0, female_pct: 100 }))).toEqual(['Female'])
    expect(pokemonGenderOptionsForPokedexEntry(entry({ genderless: false }))).toEqual(['Male', 'Female'])
  })

  it('coerces invalid or impossible sheet genders to a species-valid value', () => {
    expect(coercePokemonGenderForPokedexEntry('Female', entry({ genderless: false, male_pct: 100, female_pct: 0 }))).toBe('Male')
    expect(coercePokemonGenderForPokedexEntry('-', entry({ genderless: true }))).toBe('Genderless')
    expect(coercePokemonGenderForPokedexEntry('f', entry({ genderless: false, male_pct: 50, female_pct: 50 }))).toBe('Female')
  })

  it('syncs target sheets in place', () => {
    const sheet = { gender: '-' }
    expect(syncPokemonGenderForPokedexEntry(sheet, entry({ genderless: false, male_pct: 0, female_pct: 100 }))).toBe('Female')
    expect(sheet.gender).toBe('Female')
  })
})
