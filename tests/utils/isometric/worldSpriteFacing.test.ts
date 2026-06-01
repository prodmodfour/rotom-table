import { describe, expect, it } from 'vitest'
import {
  resolveWorldSpriteFacing,
  shouldUseFrontWorldSprite,
  worldSpriteMirrorXForAvailableAsset,
} from '~/utils/isometric/worldSpriteFacing'
import { TOKEN_FACING_DIRECTIONS, tokenFacingVector } from '~/utils/tokenFacing'

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

  it('prefers a projected to-camera direction over token-relative camera position', () => {
    const center = { x: 40, z: 0 }
    const facingDirection = { x: 1, y: 1 }

    expect(resolveWorldSpriteFacing({
      center,
      facingDirection,
      cameraPosition: { x: 0, z: 0 },
      toCameraDirection: { x: 1, z: 1 },
    })).toEqual({ asset: 'front', mirrorX: false })
  })

  it('uses mirrored side views for the two perpendicular camera directions', () => {
    const center = { x: 0, z: 0 }
    const facingDirection = { x: 0, y: 1 }

    expect(resolveWorldSpriteFacing({
      center,
      facingDirection,
      cameraPosition: { x: 5, z: 0 },
    })).toEqual({ asset: 'back', mirrorX: true })
    expect(resolveWorldSpriteFacing({
      center,
      facingDirection,
      cameraPosition: { x: -5, z: 0 },
    })).toEqual({ asset: 'front', mirrorX: true })
  })

  it('keeps adjacent diagonal facings distinct on exact sector boundaries', () => {
    const center = { x: 0, z: 0 }
    const eastCameraDirection = { x: 1, z: 0 }

    expect(resolveWorldSpriteFacing({
      center,
      facingDirection: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
      toCameraDirection: eastCameraDirection,
    })).toEqual({ asset: 'back', mirrorX: true })
    expect(resolveWorldSpriteFacing({
      center,
      facingDirection: { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
      toCameraDirection: eastCameraDirection,
    })).toEqual({ asset: 'front', mirrorX: true })
  })

  it('orders the four token facings relative to the default camera', () => {
    const center = { x: 0, z: 0 }
    const defaultCameraDirection = { x: 1, z: 1 }

    expect(TOKEN_FACING_DIRECTIONS.map((facing) => resolveWorldSpriteFacing({
      center,
      facingDirection: tokenFacingVector(facing),
      toCameraDirection: defaultCameraDirection,
    }))).toEqual([
      { asset: 'front', mirrorX: false },
      { asset: 'front', mirrorX: true },
      { asset: 'back', mirrorX: false },
      { asset: 'back', mirrorX: true },
    ])
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

  it('mirrors front-only sprites by facing side when back art is unavailable', () => {
    expect(worldSpriteMirrorXForAvailableAsset({ asset: 'front', mirrorX: false }, false)).toBe(false)
    expect(worldSpriteMirrorXForAvailableAsset({ asset: 'front', mirrorX: true }, false)).toBe(true)
    expect(worldSpriteMirrorXForAvailableAsset({ asset: 'back', mirrorX: false }, false)).toBe(true)
    expect(worldSpriteMirrorXForAvailableAsset({ asset: 'back', mirrorX: true }, false)).toBe(false)
    expect(worldSpriteMirrorXForAvailableAsset({ asset: 'back', mirrorX: true }, true)).toBe(true)
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
    })).toBe(true)
  })
})
