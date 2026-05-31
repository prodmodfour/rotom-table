import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { PokemonRenderObject } from '~/utils/isometric/types'
import {
  MOVE_VFX_TOKEN_ANCHOR,
  moveVfxAreaCentroidAnchor,
  moveVfxGridCellCenterAnchor,
  moveVfxTokenAboveHeadAnchor,
  moveVfxTokenAnchor,
  moveVfxTokenCenterAnchor,
  moveVfxTokenChestAnchor,
  moveVfxTokenFootAnchor,
  moveVfxTokenHeadAnchor,
  resolveMoveVfxAnchorPair,
  resolveMoveVfxTokenAnchor,
} from '~/utils/isometric/moveVfxAnchors'

const expectVector = (actual: THREE.Vector3 | null, expected: [number, number, number]) => {
  expect(actual).not.toBeNull()
  expect(actual?.x).toBeCloseTo(expected[0])
  expect(actual?.y).toBeCloseTo(expected[1])
  expect(actual?.z).toBeCloseTo(expected[2])
}

const makeRenderObject = (overrides: Partial<PokemonRenderObject> = {}): PokemonRenderObject => ({
  id: 'token-a',
  currentCenter: new THREE.Vector3(3, 2, 5),
  targetCenter: new THREE.Vector3(3, 2, 5),
  width: 2,
  height: 2,
  base: 2,
  clearance: 3,
  ...overrides,
}) as PokemonRenderObject

describe('move VFX anchor helpers', () => {
  it('resolves named token anchors from the current token center', () => {
    const renderObject = makeRenderObject()

    expectVector(moveVfxTokenFootAnchor(renderObject), [3, 2, 5])
    expectVector(moveVfxTokenCenterAnchor(renderObject), [3, 3.5, 5])
    expectVector(moveVfxTokenChestAnchor(renderObject), [3, 3.16, 5])
    expectVector(moveVfxTokenHeadAnchor(renderObject), [3, 3.84, 5])
    expectVector(moveVfxTokenAboveHeadAnchor(renderObject), [3, 5.35, 5])
  })

  it('uses minimum chest/head heights so very small tokens still have readable anchors', () => {
    const renderObject = makeRenderObject({ height: 0.4, clearance: 0.4 })

    expectVector(moveVfxTokenAnchor(renderObject, MOVE_VFX_TOKEN_ANCHOR.chest), [3, 2.45, 5])
    expectVector(moveVfxTokenAnchor(renderObject, MOVE_VFX_TOKEN_ANCHOR.head), [3, 2.85, 5])
  })

  it('returns grid-cell centres on the x/z plane at the cell elevation', () => {
    expectVector(moveVfxGridCellCenterAnchor({ x: 4, y: 1, z: 7 }), [4.5, 1, 7.5])
  })

  it('computes an area centroid from cell centres', () => {
    const centroid = moveVfxAreaCentroidAnchor([
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 2, z: 4 },
      { x: 4, y: 1, z: 2 },
    ])

    expectVector(centroid, [2.5, 1, 2.5])
  })

  it('handles empty areas safely with null or an explicit fallback cell', () => {
    expect(moveVfxAreaCentroidAnchor([])).toBeNull()
    expect(moveVfxAreaCentroidAnchor(null)).toBeNull()
    expectVector(moveVfxAreaCentroidAnchor([], { x: 8, y: 3, z: 6 }), [8.5, 3, 6.5])
  })

  it('resolves token anchors by id without exposing mutable render-object vectors', () => {
    const renderObject = makeRenderObject()
    const renderObjects = new Map([[renderObject.id, renderObject]])

    const anchor = resolveMoveVfxTokenAnchor({
      renderObjects,
      tokenId: renderObject.id,
      anchor: MOVE_VFX_TOKEN_ANCHOR.foot,
    })

    expectVector(anchor, [3, 2, 5])
    expect(anchor).not.toBe(renderObject.currentCenter)
  })

  it('falls back to a grid cell when a target render object is missing', () => {
    const renderObjects = new Map<string, PokemonRenderObject>()

    expectVector(resolveMoveVfxTokenAnchor({
      renderObjects,
      tokenId: 'missing-target',
      fallbackCell: { x: 9, y: 2, z: 1 },
    }), [9.5, 2, 1.5])

    expect(resolveMoveVfxTokenAnchor({ renderObjects, tokenId: 'missing-target' })).toBeNull()
  })

  it('resolves projectile/beam anchor pairs with target fallbacks', () => {
    const user = makeRenderObject({ id: 'user', currentCenter: new THREE.Vector3(1, 0, 1), height: 2, clearance: 2 })
    const renderObjects = new Map([[user.id, user]])

    const pair = resolveMoveVfxAnchorPair({
      renderObjects,
      userId: 'user',
      targetId: 'missing-target',
      targetCell: { x: 4, y: 0, z: 5 },
    })

    expectVector(pair?.start ?? null, [1, 1.16, 1])
    expectVector(pair?.end ?? null, [4.5, 0, 5.5])
  })

  it('returns null anchor pairs when either side cannot be resolved', () => {
    const renderObjects = new Map<string, PokemonRenderObject>()

    expect(resolveMoveVfxAnchorPair({
      renderObjects,
      userId: 'missing-user',
      targetCell: { x: 1, y: 0, z: 1 },
    })).toBeNull()
  })
})
