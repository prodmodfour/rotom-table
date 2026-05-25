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
  terrainTopEdgeOverlayCacheKey,
} from '~/utils/isometric/voxelRenderer'

const materialOpacity = (mesh: THREE.InstancedMesh): number => {
  const materials = mesh.material as THREE.MeshBasicMaterial[]
  return materials[0].opacity
}

const materialTransparency = (mesh: THREE.InstancedMesh): boolean => {
  const materials = mesh.material as THREE.MeshBasicMaterial[]
  return materials[0].transparent
}

const meshWithOpacity = (
  meshes: THREE.InstancedMesh[],
  opacity: number,
): THREE.InstancedMesh | undefined => meshes.find((mesh) => materialOpacity(mesh) === opacity)

const voxel = (x: number, ghost = false): MapVoxelV2 => ({
  x,
  y: 0,
  z: 0,
  materialId: 'airship_floor_metal',
  ...(ghost ? { ghost: true } : {}),
})

const coloredVoxel = (x: number, color: string): MapVoxelV2 => ({
  ...voxel(x),
  color,
})

const meshVoxelXs = (mesh: THREE.InstancedMesh): number[] =>
  (mesh.userData.voxels as MapVoxelV2[]).map((entry) => entry.x)

const sortedMeshVoxelXs = (mesh: THREE.InstancedMesh): number[] =>
  meshVoxelXs(mesh).toSorted((a, b) => a - b)

const meshContainingVoxelX = (
  meshes: THREE.InstancedMesh[],
  x: number,
): THREE.InstancedMesh | undefined => meshes.find((mesh) => meshVoxelXs(mesh).includes(x))

const terrainTopEdgeOverlay = (container: THREE.Group): THREE.Group | undefined =>
  container.children.find((child): child is THREE.Group =>
    child instanceof THREE.Group
    && child.children.some((entry) => entry instanceof THREE.LineSegments),
  )

const firstTerrainTopEdgeLine = (container: THREE.Group): THREE.LineSegments => {
  const overlay = terrainTopEdgeOverlay(container)
  const line = overlay?.children.find((child): child is THREE.LineSegments => child instanceof THREE.LineSegments)
  expect(line).toBeDefined()
  return line!
}

const terrainTopEdgeOverlayOpacities = (container: THREE.Group): number[] => {
  const overlay = terrainTopEdgeOverlay(container)
  expect(overlay).toBeDefined()

  return overlay!.children
    .filter((child): child is THREE.LineSegments => child instanceof THREE.LineSegments)
    .map((line) => (line.material as THREE.LineBasicMaterial).opacity)
    .sort((a, b) => a - b)
}

describe('isometric voxel renderer', () => {
  it('builds stable terrain top-edge overlay cache keys from terrain revision and ghost fade state', () => {
    expect(terrainTopEdgeOverlayCacheKey([
      voxel(2),
      voxel(0, true),
    ])).toBe(terrainTopEdgeOverlayCacheKey([
      voxel(0, true),
      voxel(2),
    ]))
    expect(terrainTopEdgeOverlayCacheKey([voxel(0)], { terrainRevision: 'terrain:1' }))
      .toBe(terrainTopEdgeOverlayCacheKey([voxel(2)], { terrainRevision: 'terrain:1' }))
    expect(terrainTopEdgeOverlayCacheKey([voxel(0)], { terrainRevision: 'terrain:1' }))
      .not.toBe(terrainTopEdgeOverlayCacheKey([voxel(0)], { terrainRevision: 'terrain:2' }))
    expect(terrainTopEdgeOverlayCacheKey([voxel(0, true)], { terrainRevision: 'terrain:1' }))
      .not.toBe(terrainTopEdgeOverlayCacheKey([voxel(0, true)], {
        ghostVoxelsFaded: true,
        terrainRevision: 'terrain:1',
      }))
  })

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

  it('groups renderer buckets by normalized custom colors and material fallback keys', () => {
    const container = new THREE.Group()
    const renderer = createVoxelRenderer(container)

    renderer.sync([
      coloredVoxel(0, '#112233'),
      coloredVoxel(1, '#445566'),
      { ...coloredVoxel(2, '#112233'), tags: ['decorative'] },
      coloredVoxel(3, 'not-a-color'),
      voxel(4),
    ])

    expect(renderer.meshes()).toHaveLength(3)
    expect(renderer.meshes()
      .map(sortedMeshVoxelXs)
      .toSorted((left, right) => left[0] - right[0]))
      .toEqual([[0, 2], [1], [3, 4]])

    renderer.dispose()
  })

  it('shares one voxel box geometry across buckets and rebuilds', () => {
    const container = new THREE.Group()
    const renderer = createVoxelRenderer(container)

    renderer.sync([voxel(0, true), voxel(1, false)], { ghostVoxelsFaded: true })

    const initialMeshes = renderer.meshes()
    const sharedGeometry = initialMeshes[0].geometry
    const geometryDisposeSpy = vi.spyOn(sharedGeometry, 'dispose')
    const opaqueMesh = meshWithOpacity(initialMeshes, 1)
    expect(opaqueMesh).toBeDefined()
    const opaqueMaterials = opaqueMesh!.material as THREE.MeshBasicMaterial[]
    const materialDisposeSpy = vi.spyOn(opaqueMaterials[0], 'dispose')

    expect(initialMeshes).toHaveLength(2)
    expect(initialMeshes[1].geometry).toBe(sharedGeometry)

    renderer.sync([voxel(2, true)], { ghostVoxelsFaded: true })

    const rebuiltMeshes = renderer.meshes()
    expect(rebuiltMeshes).toHaveLength(1)
    expect(rebuiltMeshes[0].geometry).toBe(sharedGeometry)
    expect(materialDisposeSpy).toHaveBeenCalledTimes(1)
    expect(geometryDisposeSpy).not.toHaveBeenCalled()

    renderer.dispose()
    expect(geometryDisposeSpy).toHaveBeenCalledTimes(1)
  })

  it('keeps an unchanged voxel bucket mesh across semantically identical syncs', () => {
    const container = new THREE.Group()
    const renderer = createVoxelRenderer(container)

    renderer.sync([
      voxel(2),
      { ...voxel(0), tags: ['old'] },
      voxel(1),
    ])

    const [initialMesh] = renderer.meshes()
    const initialMaterials = initialMesh.material as THREE.MeshBasicMaterial[]
    const meshDisposeSpy = vi.spyOn(initialMesh, 'dispose')
    const materialDisposeSpy = vi.spyOn(initialMaterials[0], 'dispose')

    expect((initialMesh.userData.voxels as MapVoxelV2[]).map((v) => v.x)).toEqual([2, 0, 1])

    renderer.sync([
      { ...voxel(1), blocksMovement: true },
      { ...voxel(2), tags: ['changed'] },
      voxel(0),
    ])

    expect(renderer.meshes()).toEqual([initialMesh])
    expect((initialMesh.userData.voxels as MapVoxelV2[]).map((v) => v.x)).toEqual([2, 0, 1])
    expect(meshDisposeSpy).not.toHaveBeenCalled()
    expect(materialDisposeSpy).not.toHaveBeenCalled()

    renderer.dispose()
  })

  it('reuses normalized custom-color buckets when output-relevant positions are unchanged', () => {
    const container = new THREE.Group()
    const renderer = createVoxelRenderer(container)

    renderer.sync([
      coloredVoxel(0, '#ABCDEF'),
      coloredVoxel(1, '#abcdef'),
    ])

    const [initialMesh] = renderer.meshes()
    const meshDisposeSpy = vi.spyOn(initialMesh, 'dispose')

    renderer.sync([
      { ...coloredVoxel(1, '#abcdef'), tags: ['renamed'] },
      coloredVoxel(0, '#abcdef'),
    ])

    expect(renderer.meshes()).toEqual([initialMesh])
    expect(meshVoxelXs(initialMesh)).toEqual([0, 1])
    expect(meshDisposeSpy).not.toHaveBeenCalled()

    renderer.dispose()
  })

  it('rebuilds only the voxel bucket whose bucket key changes', () => {
    const container = new THREE.Group()
    const renderer = createVoxelRenderer(container)

    renderer.sync([
      coloredVoxel(0, '#112233'),
      coloredVoxel(1, '#445566'),
      voxel(2),
    ])

    const stableCustomMesh = meshContainingVoxelX(renderer.meshes(), 0)
    const recoloredMesh = meshContainingVoxelX(renderer.meshes(), 1)
    const materialMesh = meshContainingVoxelX(renderer.meshes(), 2)
    expect(stableCustomMesh).toBeDefined()
    expect(recoloredMesh).toBeDefined()
    expect(materialMesh).toBeDefined()
    const stableCustomDisposeSpy = vi.spyOn(stableCustomMesh!, 'dispose')
    const recoloredDisposeSpy = vi.spyOn(recoloredMesh!, 'dispose')
    const materialDisposeSpy = vi.spyOn(materialMesh!, 'dispose')

    renderer.sync([
      coloredVoxel(0, '#112233'),
      coloredVoxel(1, '#778899'),
      voxel(2),
    ])

    expect(meshContainingVoxelX(renderer.meshes(), 0)).toBe(stableCustomMesh)
    expect(meshContainingVoxelX(renderer.meshes(), 1)).not.toBe(recoloredMesh)
    expect(meshContainingVoxelX(renderer.meshes(), 2)).toBe(materialMesh)
    expect(stableCustomDisposeSpy).not.toHaveBeenCalled()
    expect(recoloredDisposeSpy).toHaveBeenCalledTimes(1)
    expect(materialDisposeSpy).not.toHaveBeenCalled()

    renderer.dispose()
  })

  it('rebuilds only voxel buckets whose semantic positions changed', () => {
    const container = new THREE.Group()
    const renderer = createVoxelRenderer(container)

    renderer.sync([voxel(0, true), voxel(1, false)], { ghostVoxelsFaded: true })

    const initialMeshes = renderer.meshes()
    const opaqueMesh = meshWithOpacity(initialMeshes, 1)
    const fadedMesh = meshWithOpacity(initialMeshes, GHOST_VOXEL_FADED_OPACITY)
    expect(opaqueMesh).toBeDefined()
    expect(fadedMesh).toBeDefined()
    const opaqueDisposeSpy = vi.spyOn(opaqueMesh!, 'dispose')
    const fadedDisposeSpy = vi.spyOn(fadedMesh!, 'dispose')

    renderer.sync([voxel(1, false), voxel(2, true)], { ghostVoxelsFaded: true })

    const syncedMeshes = renderer.meshes()
    expect(meshWithOpacity(syncedMeshes, 1)).toBe(opaqueMesh)
    expect(meshWithOpacity(syncedMeshes, GHOST_VOXEL_FADED_OPACITY)).not.toBe(fadedMesh)
    expect(opaqueDisposeSpy).not.toHaveBeenCalled()
    expect(fadedDisposeSpy).toHaveBeenCalledTimes(1)

    renderer.dispose()
  })

  it('rebuilds a same-position bucket when its render traits change', () => {
    const container = new THREE.Group()
    const renderer = createVoxelRenderer(container)
    const customVoxel = (materialId: string): MapVoxelV2 => ({
      ...voxel(0),
      materialId,
      color: '#123456',
    })

    renderer.sync([customVoxel('airship_floor_metal')])

    const [initialMesh] = renderer.meshes()
    const initialDisposeSpy = vi.spyOn(initialMesh, 'dispose')

    renderer.sync([customVoxel('reinforced_glass')])

    const [updatedMesh] = renderer.meshes()
    expect(updatedMesh).not.toBe(initialMesh)
    expect(materialOpacity(updatedMesh)).toBe(0.36)
    expect(materialTransparency(updatedMesh)).toBe(true)
    expect(initialDisposeSpy).toHaveBeenCalledTimes(1)

    renderer.dispose()
  })

  it('keeps the terrain top-edge overlay for unchanged terrain revisions', () => {
    const container = new THREE.Group()
    const renderer = createVoxelRenderer(container)

    renderer.sync([voxel(0)], { terrainRevision: 'terrain:1' })

    const initialOverlay = terrainTopEdgeOverlay(container)
    const initialLine = firstTerrainTopEdgeLine(container)
    const geometryDisposeSpy = vi.spyOn(initialLine.geometry, 'dispose')
    const materialDisposeSpy = vi.spyOn(initialLine.material as THREE.LineBasicMaterial, 'dispose')

    renderer.sync([voxel(0)], { terrainRevision: 'terrain:1' })

    expect(terrainTopEdgeOverlay(container)).toBe(initialOverlay)
    expect(geometryDisposeSpy).not.toHaveBeenCalled()
    expect(materialDisposeSpy).not.toHaveBeenCalled()

    renderer.dispose()
  })

  it('keeps fallback terrain overlays for reordered voxels and invalidates changed positions', () => {
    const container = new THREE.Group()
    const renderer = createVoxelRenderer(container)

    renderer.sync([voxel(0), voxel(2)])

    const initialOverlay = terrainTopEdgeOverlay(container)
    const initialLine = firstTerrainTopEdgeLine(container)
    const geometryDisposeSpy = vi.spyOn(initialLine.geometry, 'dispose')
    const materialDisposeSpy = vi.spyOn(initialLine.material as THREE.LineBasicMaterial, 'dispose')

    renderer.sync([voxel(2), voxel(0)])

    expect(terrainTopEdgeOverlay(container)).toBe(initialOverlay)
    expect(geometryDisposeSpy).not.toHaveBeenCalled()
    expect(materialDisposeSpy).not.toHaveBeenCalled()

    renderer.sync([voxel(1), voxel(2)])

    expect(terrainTopEdgeOverlay(container)).not.toBe(initialOverlay)
    expect(geometryDisposeSpy).toHaveBeenCalledTimes(1)
    expect(materialDisposeSpy).toHaveBeenCalledTimes(1)

    renderer.dispose()
  })

  it('removes the terrain top-edge overlay when invalidation produces no visible overlay', () => {
    const container = new THREE.Group()
    const renderer = createVoxelRenderer(container)

    renderer.sync([voxel(0)], { terrainRevision: 'terrain:1' })

    const initialLine = firstTerrainTopEdgeLine(container)
    const geometryDisposeSpy = vi.spyOn(initialLine.geometry, 'dispose')
    const materialDisposeSpy = vi.spyOn(initialLine.material as THREE.LineBasicMaterial, 'dispose')

    renderer.sync([], { terrainRevision: 'terrain:2' })

    expect(terrainTopEdgeOverlay(container)).toBeUndefined()
    expect(geometryDisposeSpy).toHaveBeenCalledTimes(1)
    expect(materialDisposeSpy).toHaveBeenCalledTimes(1)

    renderer.dispose()
  })

  it('rebuilds the terrain top-edge overlay when the terrain revision changes', () => {
    const container = new THREE.Group()
    const renderer = createVoxelRenderer(container)

    renderer.sync([voxel(0)], { terrainRevision: 'terrain:1' })

    const initialOverlay = terrainTopEdgeOverlay(container)
    const initialLine = firstTerrainTopEdgeLine(container)
    const geometryDisposeSpy = vi.spyOn(initialLine.geometry, 'dispose')
    const materialDisposeSpy = vi.spyOn(initialLine.material as THREE.LineBasicMaterial, 'dispose')

    renderer.sync([voxel(0)], { terrainRevision: 'terrain:2' })

    expect(terrainTopEdgeOverlay(container)).not.toBe(initialOverlay)
    expect(geometryDisposeSpy).toHaveBeenCalledTimes(1)
    expect(materialDisposeSpy).toHaveBeenCalledTimes(1)

    renderer.dispose()
  })

  it('rebuilds the terrain top-edge overlay when ghost fade settings change', () => {
    const container = new THREE.Group()
    const renderer = createVoxelRenderer(container)

    renderer.sync([voxel(0, true)], { terrainRevision: 'terrain:1' })

    const initialOverlay = terrainTopEdgeOverlay(container)
    expect(terrainTopEdgeOverlayOpacities(container)).toEqual([0.24, 0.32])

    renderer.sync([voxel(0, true)], {
      ghostVoxelsFaded: true,
      terrainRevision: 'terrain:1',
    })

    expect(terrainTopEdgeOverlay(container)).not.toBe(initialOverlay)
    expect(terrainTopEdgeOverlayOpacities(container)).toEqual([
      0.24 * GHOST_VOXEL_FADED_OPACITY,
      0.32 * GHOST_VOXEL_FADED_OPACITY,
    ])

    renderer.dispose()
  })
})
