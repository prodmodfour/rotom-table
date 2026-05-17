import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  buildFieldEffectColumnTops,
  createFieldEffectRoomBoundary,
  createFieldEffectSurfaceMesh,
  fieldEffectColor,
  type FieldEffectOverlayInput,
} from '~/utils/isometric/fieldEffectOverlays'

const disposeObject = (object: THREE.Object3D) => {
  object.traverse((child) => {
    const disposable = child as THREE.Object3D & {
      geometry?: { dispose?: () => void }
      material?: THREE.Material | THREE.Material[]
    }
    disposable.geometry?.dispose?.()
    const materials = Array.isArray(disposable.material)
      ? disposable.material
      : disposable.material
        ? [disposable.material]
        : []
    for (const material of materials) material.dispose()
  })
}

const matrixPosition = (matrix: THREE.Matrix4) => ({
  x: matrix.elements[12],
  y: matrix.elements[13],
  z: matrix.elements[14],
})

describe('fieldEffectOverlays', () => {
  it('normalizes effect colors and falls back for invalid input', () => {
    expect(fieldEffectColor('#123456')).toBe(0x123456)
    expect(fieldEffectColor('not-a-color')).toBe(0xff1f2d)
    expect(fieldEffectColor('not-a-color', 0x00ff00)).toBe(0x00ff00)
  })

  it('builds column tops from terrain voxels without dropping below ground level', () => {
    const tops = buildFieldEffectColumnTops(
      [
        { x: 1, y: 0, z: 2, materialId: 'grass' },
        { x: 1, y: 3, z: 2, materialId: 'stone' },
        { x: 0, y: -5, z: 0, materialId: 'ice' },
      ],
      2,
    )

    expect(tops.get('1,2')).toBe(4)
    expect(tops.get('0,0')).toBe(2)
  })

  it('creates terrain surface meshes over the highest terrain column', () => {
    const input: FieldEffectOverlayInput = {
      dimensions: { x: 2, y: 4, z: 2 },
      groundLevelY: 0,
      voxels: [{ x: 1, y: 2, z: 0, materialId: 'stone' }],
    }

    const mesh = createFieldEffectSurfaceMesh(input, {
      color: '#00ff00',
      opacity: 0.22,
      yOffset: 0.02,
      inset: 0.1,
      renderOrder: 9,
    })

    expect(mesh.count).toBe(4)
    expect(mesh.renderOrder).toBe(9)
    expect(mesh.material.opacity).toBeCloseTo(0.22)
    expect(mesh.material.color.getHex()).toBe(0x00ff00)

    const firstMatrix = new THREE.Matrix4()
    mesh.getMatrixAt(0, firstMatrix)
    const firstPosition = matrixPosition(firstMatrix)
    expect(firstPosition.x).toBeCloseTo(0.5)
    expect(firstPosition.y).toBeCloseTo(0.02)
    expect(firstPosition.z).toBeCloseTo(0.5)

    const raisedMatrix = new THREE.Matrix4()
    mesh.getMatrixAt(1, raisedMatrix)
    const raisedPosition = matrixPosition(raisedMatrix)
    expect(raisedPosition.x).toBeCloseTo(1.5)
    expect(raisedPosition.y).toBeCloseTo(3.02)
    expect(raisedPosition.z).toBeCloseTo(0.5)

    disposeObject(mesh)
  })

  it('creates room boundaries using map dimensions and requested offsets', () => {
    const input: FieldEffectOverlayInput = {
      dimensions: { x: 5, y: 4, z: 3 },
      groundLevelY: 0,
      voxels: [],
    }

    const boundary = createFieldEffectRoomBoundary(input, {
      color: '#334455',
      opacity: 0.42,
      y: 1,
      inset: 0.2,
    })

    expect(boundary.renderOrder).toBe(18)
    expect(boundary.position.x).toBeCloseTo(2.5)
    expect(boundary.position.y).toBeCloseTo(2.5)
    expect(boundary.position.z).toBeCloseTo(1.5)
    expect(boundary.material.opacity).toBeCloseTo(0.42)
    expect(boundary.material.color.getHex()).toBe(0x334455)

    disposeObject(boundary)
  })
})
