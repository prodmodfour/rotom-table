import { describe, expect, it } from 'vitest'
import {
  POKEDEX_SPRITE_VISUAL_BOUNDS_DEBUG_QUERY,
  isPokedexSpriteVisualBoundsDebugEnabled,
} from '~/utils/pokedex/spriteVisualBoundsDebug'

describe('Pokédex sprite visual-bounds debug flag', () => {
  it('stays disabled unless the dev-only query flag is present', () => {
    expect(isPokedexSpriteVisualBoundsDebugEnabled({}, true)).toBe(false)
    expect(isPokedexSpriteVisualBoundsDebugEnabled({ [POKEDEX_SPRITE_VISUAL_BOUNDS_DEBUG_QUERY]: '0' }, true))
      .toBe(false)
  })

  it('accepts common truthy query values in dev builds', () => {
    expect(isPokedexSpriteVisualBoundsDebugEnabled({ [POKEDEX_SPRITE_VISUAL_BOUNDS_DEBUG_QUERY]: '1' }, true))
      .toBe(true)
    expect(isPokedexSpriteVisualBoundsDebugEnabled({ [POKEDEX_SPRITE_VISUAL_BOUNDS_DEBUG_QUERY]: 'true' }, true))
      .toBe(true)
    expect(isPokedexSpriteVisualBoundsDebugEnabled({ [POKEDEX_SPRITE_VISUAL_BOUNDS_DEBUG_QUERY]: ['yes'] }, true))
      .toBe(true)
  })

  it('keeps the overlay disabled outside dev builds', () => {
    expect(isPokedexSpriteVisualBoundsDebugEnabled({ [POKEDEX_SPRITE_VISUAL_BOUNDS_DEBUG_QUERY]: '1' }, false))
      .toBe(false)
  })
})
