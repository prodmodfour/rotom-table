import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  createMovementPathLineGeometryBuffer,
  resetMovementPathLineGeometry,
  updateMovementPathLineGeometry,
} from '~/utils/isometric/tokenMovePreview'

const positionValues = (geometry: THREE.BufferGeometry, count: number) => {
  const attribute = geometry.getAttribute('position') as THREE.BufferAttribute
  return Array.from((attribute.array as Float32Array).slice(0, count * 3))
}

describe('token movement preview path line geometry', () => {
  it('updates path vertices in a reusable geometry buffer', () => {
    const buffer = createMovementPathLineGeometryBuffer()
    const geometry = buffer.geometry

    const pointCount = updateMovementPathLineGeometry(buffer, {
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 1 },
      ],
      base: 2,
      clearance: 1.5,
    })

    expect(pointCount).toBe(3)
    expect(buffer.geometry).toBe(geometry)
    expect(buffer.pointCapacity).toBeGreaterThanOrEqual(3)
    expect(geometry.drawRange).toEqual({ start: 0, count: 3 })
    expect(positionValues(geometry, 3)).toEqual([
      1, 0.75, 1,
      2, 0.75, 1,
      2, 1.75, 2,
    ])
  })

  it('reuses the position attribute for shorter paths and only changes draw range', () => {
    const buffer = createMovementPathLineGeometryBuffer()
    updateMovementPathLineGeometry(buffer, {
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      base: 1,
      clearance: 1,
    })
    const geometry = buffer.geometry
    const firstAttribute = geometry.getAttribute('position')
    const firstArray = firstAttribute.array
    const firstCapacity = buffer.pointCapacity

    const pointCount = updateMovementPathLineGeometry(buffer, {
      path: [
        { x: 3, y: 0, z: 1 },
        { x: 4, y: 0, z: 1 },
      ],
      base: 1,
      clearance: 2,
    })

    expect(pointCount).toBe(2)
    expect(buffer.geometry).toBe(geometry)
    expect(buffer.pointCapacity).toBe(firstCapacity)
    expect(geometry.getAttribute('position')).toBe(firstAttribute)
    expect((geometry.getAttribute('position') as THREE.BufferAttribute).array).toBe(firstArray)
    expect(geometry.drawRange).toEqual({ start: 0, count: 2 })
    expect(positionValues(geometry, 2)).toEqual([
      3.5, 1, 1.5,
      4.5, 1, 1.5,
    ])
  })

  it('grows the attribute when a longer path exceeds the current capacity without replacing geometry', () => {
    const buffer = createMovementPathLineGeometryBuffer()
    updateMovementPathLineGeometry(buffer, {
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      base: 1,
      clearance: 1,
    })
    const geometry = buffer.geometry
    const firstAttribute = geometry.getAttribute('position')

    const pointCount = updateMovementPathLineGeometry(buffer, {
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
      ],
      base: 1,
      clearance: 1,
    })

    expect(pointCount).toBe(5)
    expect(buffer.geometry).toBe(geometry)
    expect(buffer.pointCapacity).toBeGreaterThanOrEqual(5)
    expect(geometry.getAttribute('position')).not.toBe(firstAttribute)
    expect(geometry.drawRange).toEqual({ start: 0, count: 5 })
  })

  it('resets draw range for hidden paths without disposing or reallocating the buffer', () => {
    const buffer = createMovementPathLineGeometryBuffer()
    updateMovementPathLineGeometry(buffer, {
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      base: 1,
      clearance: 1,
    })
    const geometry = buffer.geometry
    const attribute = geometry.getAttribute('position')
    const disposeSpy = vi.spyOn(geometry, 'dispose')

    resetMovementPathLineGeometry(buffer)

    expect(disposeSpy).not.toHaveBeenCalled()
    expect(buffer.geometry).toBe(geometry)
    expect(buffer.pointCapacity).toBeGreaterThanOrEqual(3)
    expect(geometry.getAttribute('position')).toBe(attribute)
    expect(geometry.drawRange).toEqual({ start: 0, count: 0 })

    expect(updateMovementPathLineGeometry(buffer, {
      path: null,
      base: 1,
      clearance: 1,
    })).toBe(0)
    expect(disposeSpy).not.toHaveBeenCalled()
    expect(geometry.drawRange).toEqual({ start: 0, count: 0 })
  })
})
