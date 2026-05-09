import { describe, expect, it } from 'vitest'
import { isPokedexPath } from '~/composables/pokedex/usePokedexSidebarScroll'

describe('usePokedexSidebarScroll helpers', () => {
  it('recognizes paths that should preserve Pokédex sidebar scroll', () => {
    expect(isPokedexPath('/pokedex')).toBe(true)
    expect(isPokedexPath('/pokedex/pikachu')).toBe(true)
    expect(isPokedexPath('/pokedex?type=electric')).toBe(true)
    expect(isPokedexPath('/maps/pokedex')).toBe(false)
    expect(isPokedexPath('/')).toBe(false)
  })
})
