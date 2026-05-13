import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { MapVoxelV2 } from '~/types/map'

vi.mock('~/utils/isometric/materials', () => ({
  buildVoxelFaceMaterials: (_style: unknown, opacity = 1, depthWrite = true) =>
    Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial({
      opacity,
      transparent: opacity < 1,
      depthWrite,
    })),
}))

import {
  createVoxelRenderer,
  GHOST_VOXEL_FADED_OPACITY,
} from '~/utils/isometric/voxelRenderer'

const materialOpacity = (mesh: THREE.InstancedMesh): number => {
  const materials = mesh.material as THREE.MeshBasicMaterial[]
  return materials[0].opacity
}

const materialTransparency = (mesh: THREE.InstancedMesh): boolean => {
  const materials = mesh.material as THREE.MeshBasicMaterial[]
  return materials[0].transparent
}

const voxel = (x: number, ghost = false): MapVoxelV2 => ({
  x,
  y: 0,
  z: 0,
  materialId: 'airship_floor_metal',
  ...(ghost ? { ghost: true } : {}),
})

describe('isometric voxel renderer', () => {
  it('renders ghost voxels normally unless ghost fading is enabled', () => {
    const container = new THREE.Group()
    const renderer = createVoxelRenderer(container)

    renderer.sync([voxel(0, true)])
    expect(materialOpacity(renderer.meshes()[0])).toBe(1)
    expect(materialTransparency(renderer.meshes()[0])).toBe(false)

    renderer.sync([voxel(0, true)], { ghostVoxelsFaded: true })
    expect(materialOpacity(renderer.meshes()[0])).toBe(GHOST_VOXEL_FADED_OPACITY)
    expect(materialTransparency(renderer.meshes()[0])).toBe(true)

    renderer.dispose()
  })

  it('keeps faded ghost voxels in a separate opacity bucket', () => {
    const container = new THREE.Group()
    const renderer = createVoxelRenderer(container)

    renderer.sync([voxel(0, true), voxel(1, false)], { ghostVoxelsFaded: true })

    expect(renderer.meshes()).toHaveLength(2)
    expect(renderer.meshes().map(materialOpacity).sort((a, b) => a - b)).toEqual([GHOST_VOXEL_FADED_OPACITY, 1])

    renderer.dispose()
  })
})
