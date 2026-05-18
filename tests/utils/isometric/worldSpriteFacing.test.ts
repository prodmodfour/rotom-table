import { describe, expect, it } from 'vitest'
import {
  resolveWorldSpriteFacing,
  shouldUseFrontWorldSprite,
} from '~/utils/isometric/worldSpriteFacing'

describe('world sprite facing helpers', () => {
  it('uses the unmirrored front sprite when camera data is unavailable or coincident', () => {
    const center = { x: 4, z: -2 }
    const facingDirection = { x: 0, y: 1 }

    expect(resolveWorldSpriteFacing({ center, facingDirection, cameraPosition: null })).toEqual({
      asset: 'front',
      mirrorX: false,
    })
    expect(resolveWorldSpriteFacing({ center, facingDirection, cameraPosition: center })).toEqual({
      asset: 'front',
      mirrorX: false,
    })
  })

  it('selects unmirrored front and back views from the camera position relative to token facing', () => {
    const center = { x: 0, z: 0 }
    const facingDirection = { x: 0, y: 1 }

    expect(resolveWorldSpriteFacing({
      center,
      facingDirection,
      cameraPosition: { x: 0, z: 5 },
    })).toEqual({ asset: 'front', mirrorX: false })
    expect(resolveWorldSpriteFacing({
      center,
      facingDirection,
      cameraPosition: { x: 0, z: -5 },
    })).toEqual({ asset: 'back', mirrorX: false })
  })

  it('uses mirrored side views for the two perpendicular camera directions', () => {
    const center = { x: 0, z: 0 }
    const facingDirection = { x: 0, y: 1 }

    expect(resolveWorldSpriteFacing({
      center,
      facingDirection,
      cameraPosition: { x: 5, z: 0 },
    })).toEqual({ asset: 'front', mirrorX: true })
    expect(resolveWorldSpriteFacing({
      center,
      facingDirection,
      cameraPosition: { x: -5, z: 0 },
    })).toEqual({ asset: 'back', mirrorX: true })
  })

  it('flips the facing direction for legacy turned tokens', () => {
    const center = { x: 0, z: 0 }
    const facingDirection = { x: 0, y: 1 }

    expect(resolveWorldSpriteFacing({
      center,
      facingDirection,
      cameraPosition: { x: 0, z: 5 },
      turned: true,
    })).toEqual({ asset: 'back', mirrorX: false })
    expect(resolveWorldSpriteFacing({
      center,
      facingDirection,
      cameraPosition: { x: 0, z: -5 },
      turned: true,
    })).toEqual({ asset: 'front', mirrorX: false })
  })

  it('preserves the boolean front/back helper as a wrapper around facing resolution', () => {
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
    })).toBe(false)
  })
})
