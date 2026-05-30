import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  createMoveVfxLineMaterial,
  createMoveVfxRingMaterial,
  createMoveVfxSolidMaterial,
  createMoveVfxSpriteMaterial,
  createMoveVfxTranslucentMaterial,
  normalizeMoveVfxOpacity,
} from '~/utils/isometric/moveVfxMaterials'

describe('moveVfxMaterials', () => {
  it('normalizes opacity inputs safely', () => {
    expect(normalizeMoveVfxOpacity()).toBe(1)
    expect(normalizeMoveVfxOpacity(0.45)).toBe(0.45)
    expect(normalizeMoveVfxOpacity(-1)).toBe(0)
    expect(normalizeMoveVfxOpacity(2)).toBe(1)
    expect(normalizeMoveVfxOpacity(Number.NaN)).toBe(1)
  })

  it('creates fresh solid mesh materials with VFX defaults', () => {
    const material = createMoveVfxSolidMaterial('#ffeeaa', 0.5)
    const secondMaterial = createMoveVfxSolidMaterial('#ffeeaa', 0.5)

    expect(material).toBeInstanceOf(THREE.MeshBasicMaterial)
    expect(material).not.toBe(secondMaterial)
    expect(material.color.getHexString()).toBe('ffeeaa')
    expect(material.opacity).toBe(0.5)
    expect(material.transparent).toBe(true)
    expect(material.depthTest).toBe(true)
    expect(material.depthWrite).toBe(false)
    expect(material.blending).toBe(THREE.AdditiveBlending)
    expect(material.side).toBe(THREE.FrontSide)
    expect(material.toneMapped).toBe(false)
    expect(material.polygonOffset).toBe(false)
  })

  it('creates double-sided translucent and ring mesh materials', () => {
    const translucent = createMoveVfxTranslucentMaterial({ color: 0x123456, opacity: 0.35 })
    const ring = createMoveVfxRingMaterial({ color: '#3366ff', opacity: 0.25 })

    for (const material of [translucent, ring]) {
      expect(material).toBeInstanceOf(THREE.MeshBasicMaterial)
      expect(material.transparent).toBe(true)
      expect(material.depthTest).toBe(true)
      expect(material.depthWrite).toBe(false)
      expect(material.blending).toBe(THREE.AdditiveBlending)
      expect(material.side).toBe(THREE.DoubleSide)
      expect(material.toneMapped).toBe(false)
    }

    expect(translucent.polygonOffset).toBe(false)
    expect(ring.polygonOffset).toBe(true)
    expect(ring.polygonOffsetFactor).toBe(-1)
    expect(ring.polygonOffsetUnits).toBe(-2)
    expect(translucent.color.getHexString()).toBe('123456')
    expect(ring.color.getHexString()).toBe('3366ff')
    expect(translucent).not.toBe(ring)
  })

  it('allows ring materials to opt out of the ground-surface polygon offset', () => {
    const ring = createMoveVfxRingMaterial({ color: '#3366ff', opacity: 0.25, polygonOffset: false })

    expect(ring.polygonOffset).toBe(false)
  })

  it('creates line and sprite-like materials with the same transparency and depth policy', () => {
    const line = createMoveVfxLineMaterial('#44ccff', 0.4)
    const sprite = createMoveVfxSpriteMaterial('#ffffff', 0.6)

    expect(line).toBeInstanceOf(THREE.LineBasicMaterial)
    expect(sprite).toBeInstanceOf(THREE.SpriteMaterial)

    for (const material of [line, sprite]) {
      expect(material.transparent).toBe(true)
      expect(material.depthTest).toBe(true)
      expect(material.depthWrite).toBe(false)
      expect(material.blending).toBe(THREE.AdditiveBlending)
      expect(material.toneMapped).toBe(false)
    }

    expect(line.color.getHexString()).toBe('44ccff')
    expect(sprite.color.getHexString()).toBe('ffffff')
  })
})
