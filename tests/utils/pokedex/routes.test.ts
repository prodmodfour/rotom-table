import { describe, expect, it } from 'vitest'
import {
  POKEDEX_PATH,
  isPokedexPath,
  pokedexEntryPathForSlug,
  pokedexEntryPathForSpecies,
  pokedexPath,
} from '~/utils/pokedex/routes'

describe('Pokédex route helpers', () => {
  it('exposes the canonical Pokédex path', () => {
    expect(POKEDEX_PATH).toBe('/pokedex')
    expect(pokedexPath()).toBe('/pokedex')
  })

  it('recognizes Pokédex route-like paths for scroll preservation', () => {
    expect(isPokedexPath('/pokedex')).toBe(true)
    expect(isPokedexPath('/pokedex/pikachu')).toBe(true)
    expect(isPokedexPath('/pokedex?type=electric')).toBe(true)
    expect(isPokedexPath('/moves')).toBe(false)
  })

  it('builds encoded entry paths from slugs and species names', () => {
    expect(pokedexEntryPathForSlug('mr-mime')).toBe('/pokedex/mr-mime')
    expect(pokedexEntryPathForSlug('nidoran♀')).toBe('/pokedex/nidoran%E2%99%80')
    expect(pokedexEntryPathForSpecies('Mr. Mime')).toBe('/pokedex/mr-mime')
    expect(pokedexEntryPathForSpecies(null)).toBeNull()
  })
})
