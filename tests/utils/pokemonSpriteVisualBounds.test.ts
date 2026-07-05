import { describe, expect, it } from 'vitest'
import { toSpriteVisualBounds } from '~/utils/pokemonSpriteVisualBounds'

const visualBoundsRecord = {
  canvas_width: 96,
  canvas_height: 96,
  left: 21,
  top: 11,
  width: 55,
  height: 74,
  floating: true,
}

describe('pokemon sprite visual bounds helpers', () => {
  it('maps manifest visual bounds to catalog and API field names', () => {
    expect(toSpriteVisualBounds(visualBoundsRecord)).toEqual({
      canvasWidth: 96,
      canvasHeight: 96,
      left: 21,
      top: 11,
      width: 55,
      height: 74,
      floating: true,
    })
  })

  it('keeps missing visual bounds optional', () => {
    expect(toSpriteVisualBounds(undefined)).toBeUndefined()
    expect(toSpriteVisualBounds(null)).toBeUndefined()
  })
})
