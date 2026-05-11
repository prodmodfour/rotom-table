import { describe, expect, it } from 'vitest'
import { shouldUseFrontWorldSprite } from '~/utils/isometric/worldSpriteFacing'

describe('world sprite facing helpers', () => {
  it('uses the front sprite when camera data is unavailable or coincident', () => {
    const center = { x: 4, z: -2 }
    const facingDirection = { x: 0, y: 1 }

    expect(shouldUseFrontWorldSprite({ center, facingDirection, cameraPosition: null })).toBe(true)
    expect(shouldUseFrontWorldSprite({ center, facingDirection, cameraPosition: center })).toBe(true)
  })

  it('selects front or back from the camera position relative to token facing', () => {
    const center = { x: 0, z: 0 }
    const facingDirection = { x: 0, y: 1 }

    expect(shouldUseFrontWorldSprite({
      center,
      facingDirection,
      cameraPosition: { x: 0, z: 5 },
    })).toBe(true)
    expect(shouldUseFrontWorldSprite({
      center,
      facingDirection,
      cameraPosition: { x: 0, z: -5 },
    })).toBe(false)
  })

  it('flips the facing direction for turned tokens', () => {
    const center = { x: 0, z: 0 }
    const facingDirection = { x: 0, y: 1 }

    expect(shouldUseFrontWorldSprite({
      center,
      facingDirection,
      cameraPosition: { x: 0, z: 5 },
      turned: true,
    })).toBe(false)
    expect(shouldUseFrontWorldSprite({
      center,
      facingDirection,
      cameraPosition: { x: 0, z: -5 },
      turned: true,
    })).toBe(true)
  })

  it('preserves diagonal facing and edge-on front behavior', () => {
    const center = { x: 10, z: 10 }
    const facingDirection = { x: 1, y: 1 }

    expect(shouldUseFrontWorldSprite({
      center,
      facingDirection,
      cameraPosition: { x: 12, z: 12 },
    })).toBe(true)
    expect(shouldUseFrontWorldSprite({
      center,
      facingDirection,
      cameraPosition: { x: 8, z: 8 },
    })).toBe(false)
    expect(shouldUseFrontWorldSprite({
      center,
      facingDirection,
      cameraPosition: { x: 9, z: 11 },
    })).toBe(true)
  })
})
