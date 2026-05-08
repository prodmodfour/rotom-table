import * as THREE from 'three'
import type { MapVoxelV2 } from '~/types/map'
import { buildAllVoxelOccupancy, voxelGroupKey, voxelKey, voxelMaterialDefinition } from '~/utils/voxels'
import { buildVoxelFaceMaterials } from './materials'
import { disposeObject3D } from './resourceDisposal'
import type { VoxelGroup } from './types'

export interface VoxelRenderer {
  sync(voxels: ReadonlyArray<MapVoxelV2>): void
  dispose(): void
  setVisible(visible: boolean): void
  meshes(): THREE.InstancedMesh[]
}

const disposeVoxelGroup = (container: THREE.Group, group: VoxelGroup) => {
  container.remove(group.mesh)
  group.mesh.dispose()
  group.geometry.dispose()
  for (const material of group.materials) material.dispose()
}

const appendTerrainTopEdgeLines = (
  group: THREE.Group,
  segments: number[],
  material: THREE.LineBasicMaterial,
) => {
  if (segments.length === 0) {
    material.dispose()
    return
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3))
  geometry.computeBoundingSphere()

  const lines = new THREE.LineSegments(geometry, material)
  // Transparent edge rims should be evaluated after opaque terrain, but
  // still depth-test so they remain terrain silhouettes rather than UI.
  lines.renderOrder = 1
  group.add(lines)
}

export const buildTerrainTopEdgeOverlay = (voxels: ReadonlyArray<MapVoxelV2>): THREE.Group => {
  const group = new THREE.Group()
  if (voxels.length === 0) return group

  const occupied = buildAllVoxelOccupancy(voxels)
  const lightSegments: number[] = []
  const darkSegments: number[] = []
  const eps = 0.002

  const hasVoxel = (x: number, y: number, z: number) => occupied.has(voxelKey(x, y, z))
  const addSegment = (
    target: number[],
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ) => {
    target.push(ax, ay, az, bx, by, bz)
  }

  for (const voxel of voxels) {
    // Hidden top faces do not need a rim; the voxel above owns the visible cap.
    if (hasVoxel(voxel.x, voxel.y + 1, voxel.z)) continue

    const topY = voxel.y + 1 + eps
    const x0 = voxel.x
    const x1 = voxel.x + 1
    const z0 = voxel.z
    const z1 = voxel.z + 1

    // Match the existing isometric face ramp: back/left top edges catch
    // the restrained highlight, front/right edges pick up the darker seam.
    if (!hasVoxel(voxel.x, voxel.y, voxel.z - 1)) {
      addSegment(lightSegments, x0, topY, z0, x1, topY, z0)
    }
    if (!hasVoxel(voxel.x - 1, voxel.y, voxel.z)) {
      addSegment(lightSegments, x0, topY, z0, x0, topY, z1)
    }
    if (!hasVoxel(voxel.x, voxel.y, voxel.z + 1)) {
      addSegment(darkSegments, x0, topY, z1, x1, topY, z1)
    }
    if (!hasVoxel(voxel.x + 1, voxel.y, voxel.z)) {
      addSegment(darkSegments, x1, topY, z0, x1, topY, z1)
    }
  }

  appendTerrainTopEdgeLines(
    group,
    lightSegments,
    new THREE.LineBasicMaterial({
      color: 0xfbf1c7,
      transparent: true,
      opacity: 0.24,
      depthTest: true,
      depthWrite: false,
    }),
  )
  appendTerrainTopEdgeLines(
    group,
    darkSegments,
    new THREE.LineBasicMaterial({
      color: 0x1d2021,
      transparent: true,
      opacity: 0.32,
      depthTest: true,
      depthWrite: false,
    }),
  )

  return group
}

export const createVoxelRenderer = (container: THREE.Group): VoxelRenderer => {
  const voxelGroups = new Map<string, VoxelGroup>()
  let terrainTopEdgeOverlay: THREE.Group | null = null
  let visible = true

  const disposeTerrainTopEdgeOverlay = () => {
    disposeObject3D(terrainTopEdgeOverlay)
    terrainTopEdgeOverlay = null
  }

  const syncTerrainTopEdgeOverlay = (voxels: ReadonlyArray<MapVoxelV2>) => {
    disposeTerrainTopEdgeOverlay()
    const overlay = buildTerrainTopEdgeOverlay(voxels)
    if (overlay.children.length === 0) return

    overlay.visible = visible
    terrainTopEdgeOverlay = overlay
    container.add(terrainTopEdgeOverlay)
  }

  const disposeAllVoxelGroups = () => {
    for (const group of voxelGroups.values()) {
      disposeVoxelGroup(container, group)
    }
    voxelGroups.clear()
  }

  return {
    sync(voxels) {
      // Bucket voxels by group key so visually identical voxels share
      // an InstancedMesh.
      const buckets = new Map<string, MapVoxelV2[]>()
      for (const voxel of voxels) {
        const key = voxelGroupKey(voxel)
        let arr = buckets.get(key)
        if (!arr) {
          arr = []
          buckets.set(key, arr)
        }
        arr.push(voxel)
      }

      // Drop groups that no longer have any voxels.
      for (const [key, group] of voxelGroups.entries()) {
        if (!buckets.has(key)) {
          disposeVoxelGroup(container, group)
          voxelGroups.delete(key)
        }
      }

      // Rebuild each bucket. We always rebuild rather than try to mutate
      // ``InstancedMesh.count`` in place — voxel changes are debounced
      // through the save layer so the cost is bounded.
      const matrix = new THREE.Matrix4()
      for (const [key, groupVoxels] of buckets.entries()) {
        const existing = voxelGroups.get(key)
        if (existing) {
          disposeVoxelGroup(container, existing)
          voxelGroups.delete(key)
        }
        const definition = voxelMaterialDefinition(groupVoxels[0])
        const opacity = definition.transparent ? (definition.opacity ?? 0.5) : 1
        const depthWrite = !definition.transparent
        const geometry = new THREE.BoxGeometry(1, 1, 1)
        const materials = buildVoxelFaceMaterials(groupVoxels[0], opacity, depthWrite)
        const mesh = new THREE.InstancedMesh(geometry, materials, groupVoxels.length)
        mesh.userData.voxels = groupVoxels
        mesh.renderOrder = definition.transparent ? 8 : 0
        mesh.visible = visible
        for (let i = 0; i < groupVoxels.length; i += 1) {
          const v = groupVoxels[i]
          matrix.makeTranslation(v.x + 0.5, v.y + 0.5, v.z + 0.5)
          mesh.setMatrixAt(i, matrix)
        }
        mesh.instanceMatrix.needsUpdate = true
        container.add(mesh)
        voxelGroups.set(key, { key, geometry, materials, mesh, voxels: groupVoxels })
      }

      syncTerrainTopEdgeOverlay(voxels)
    },

    dispose() {
      disposeTerrainTopEdgeOverlay()
      disposeAllVoxelGroups()
    },

    setVisible(nextVisible) {
      visible = nextVisible
      container.visible = nextVisible
      for (const group of voxelGroups.values()) {
        group.mesh.visible = nextVisible
      }
      if (terrainTopEdgeOverlay) terrainTopEdgeOverlay.visible = nextVisible
    },

    meshes() {
      return Array.from(voxelGroups.values(), (group) => group.mesh)
    },
  }
}
