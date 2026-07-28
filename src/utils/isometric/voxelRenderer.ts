import * as THREE from 'three'
import type { MapVoxelV2 } from '~/types/map'
import { voxelGroupKey } from '~/utils/voxelColors'
import { voxelMaterialDefinition } from '~/utils/voxelMaterials'
import { buildAllVoxelOccupancy, voxelKey } from '~/utils/voxelOccupancy'
import {
  SMART_TERRAIN_CUTAWAY_DEFAULT_OPACITY,
  smartGhostVoxelKeySetSignature,
} from '~/utils/isometric/smartTerrainCutaway'
import { buildVoxelFaceMaterials } from './materials'
import { disposeObject3D } from './resourceDisposal'
import type { VoxelGroup } from './types'

export const GHOST_VOXEL_FADED_OPACITY = 0.1
export const SMART_GHOST_VOXEL_DEFAULT_OPACITY = SMART_TERRAIN_CUTAWAY_DEFAULT_OPACITY

export interface VoxelRendererSyncOptions {
  ghostVoxelsFaded?: boolean
  smartGhostVoxelKeys?: ReadonlySet<string>
  smartGhostOpacity?: number
  /** Stable terrain revision from the caller; falls back to an overlay-specific voxel signature. */
  terrainRevision?: string
}

export interface VoxelRenderer {
  sync(voxels: ReadonlyArray<MapVoxelV2>, options?: VoxelRendererSyncOptions): void
  dispose(): void
  setVisible(visible: boolean): void
  meshes(): THREE.InstancedMesh[]
}

interface VoxelRenderTraits {
  opacity: number
  depthWrite: boolean
  renderOrder: number
}

interface VoxelBucketSnapshot {
  voxels: MapVoxelV2[]
  traits: VoxelRenderTraits
  semanticSignature: string
}

const voxelInstancePositionKey = (voxel: MapVoxelV2): string =>
  `${voxel.x},${voxel.y},${voxel.z}`

const voxelBucketPositionSignature = (voxels: ReadonlyArray<MapVoxelV2>): string =>
  Array.from(voxels, voxelInstancePositionKey).sort().join('|')

const voxelRenderTraitsSignature = (traits: VoxelRenderTraits): string =>
  `${traits.opacity}:${traits.depthWrite ? 'depth' : 'no-depth'}:${traits.renderOrder}`

const smartGhostOpacity = (options: VoxelRendererSyncOptions = {}): number => (
  Number.isFinite(options.smartGhostOpacity) && options.smartGhostOpacity !== undefined
    ? THREE.MathUtils.clamp(options.smartGhostOpacity, 0, 1)
    : SMART_GHOST_VOXEL_DEFAULT_OPACITY
)

const voxelIsAuthoredFadedGhost = (
  voxel: MapVoxelV2,
  options: VoxelRendererSyncOptions = {},
): boolean => options.ghostVoxelsFaded === true && voxel.ghost === true

const voxelIsSmartGhost = (
  voxel: MapVoxelV2,
  options: VoxelRendererSyncOptions = {},
): boolean => options.smartGhostVoxelKeys?.has(voxelKey(voxel.x, voxel.y, voxel.z)) === true

const voxelFadeOpacity = (
  voxel: MapVoxelV2,
  options: VoxelRendererSyncOptions = {},
): number | null => {
  if (voxelIsAuthoredFadedGhost(voxel, options)) return GHOST_VOXEL_FADED_OPACITY
  if (voxelIsSmartGhost(voxel, options)) return smartGhostOpacity(options)
  return null
}

const terrainTopEdgeOverlayVoxelSignature = (
  voxels: ReadonlyArray<MapVoxelV2>,
  options: VoxelRendererSyncOptions = {},
): string =>
  Array.from(voxels, (voxel) => [
    voxel.x,
    voxel.y,
    voxel.z,
    voxel.ghost === true ? 'ghost' : 'solid',
    voxelIsSmartGhost(voxel, options) ? 'smart-ghost' : 'normal',
  ].join(','))
    .sort()
    .join('|')

export const terrainTopEdgeOverlayCacheKey = (
  voxels: ReadonlyArray<MapVoxelV2>,
  options: VoxelRendererSyncOptions = {},
): string => {
  const terrainRevision = options.terrainRevision === undefined
    ? `voxels:${terrainTopEdgeOverlayVoxelSignature(voxels, options)}`
    : `revision:${options.terrainRevision}`
  const ghostFadeRevision = options.ghostVoxelsFaded === true ? 'ghost-fade:on' : 'ghost-fade:off'
  const smartGhostRevision = `smart-ghost:${smartGhostVoxelKeySetSignature(options.smartGhostVoxelKeys)}`
  const smartOpacityRevision = `smart-opacity:${smartGhostOpacity(options)}`

  return `${terrainRevision}|${ghostFadeRevision}|${smartGhostRevision}|${smartOpacityRevision}`
}

const disposeVoxelGroup = (container: THREE.Group, group: VoxelGroup) => {
  container.remove(group.mesh)
  group.mesh.dispose()
  for (const material of group.materials) material.dispose()
}

const resolveVoxelRenderTraits = (
  voxel: MapVoxelV2,
  options: VoxelRendererSyncOptions = {},
): VoxelRenderTraits => {
  const definition = voxelMaterialDefinition(voxel)
  const fadedOpacity = voxelFadeOpacity(voxel, options)
  const opacity = fadedOpacity !== null
    ? fadedOpacity
    : definition.transparent
      ? (definition.opacity ?? 0.5)
      : 1
  const transparent = opacity < 1

  return {
    opacity,
    depthWrite: !transparent,
    renderOrder: transparent ? 8 : 0,
  }
}

const rendererVoxelGroupKey = (
  voxel: MapVoxelV2,
  options: VoxelRendererSyncOptions = {},
): string => {
  const baseKey = voxelGroupKey(voxel)
  const fadeBucket = voxelIsAuthoredFadedGhost(voxel, options)
    ? 'authored-ghost-faded'
    : voxelIsSmartGhost(voxel, options)
      ? `smart-ghost:${smartGhostOpacity(options)}`
      : 'normal'
  return `${baseKey}|${fadeBucket}`
}

const buildVoxelBucketSnapshot = (
  voxels: ReadonlyArray<MapVoxelV2>,
  options: VoxelRendererSyncOptions,
): VoxelBucketSnapshot => {
  const groupVoxels = Array.from(voxels)
  const firstVoxel = groupVoxels[0]
  if (!firstVoxel) throw new Error('Cannot build an empty voxel bucket snapshot.')
  const traits = resolveVoxelRenderTraits(firstVoxel, options)
  return {
    voxels: groupVoxels,
    traits,
    semanticSignature: `${voxelRenderTraitsSignature(traits)}|${voxelBucketPositionSignature(groupVoxels)}`,
  }
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

export const buildTerrainTopEdgeOverlay = (
  voxels: ReadonlyArray<MapVoxelV2>,
  options: VoxelRendererSyncOptions = {},
): THREE.Group => {
  const group = new THREE.Group()
  if (voxels.length === 0) return group

  const occupied = buildAllVoxelOccupancy(voxels)
  const normalLightSegments: number[] = []
  const normalDarkSegments: number[] = []
  const ghostLightSegments: number[] = []
  const ghostDarkSegments: number[] = []
  const smartLightSegments: number[] = []
  const smartDarkSegments: number[] = []
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
    const fadedOpacity = voxelFadeOpacity(voxel, options)
    const authoredFadedGhost = voxelIsAuthoredFadedGhost(voxel, options)
    const lightSegments = fadedOpacity === null
      ? normalLightSegments
      : authoredFadedGhost ? ghostLightSegments : smartLightSegments
    const darkSegments = fadedOpacity === null
      ? normalDarkSegments
      : authoredFadedGhost ? ghostDarkSegments : smartDarkSegments

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

  const appendEdgePair = (lightSegments: number[], darkSegments: number[], opacityScale = 1) => {
    appendTerrainTopEdgeLines(
      group,
      lightSegments,
      new THREE.LineBasicMaterial({
        color: 0xf7f7f2,
        transparent: true,
        opacity: 0.24 * opacityScale,
        depthTest: true,
        depthWrite: false,
      }),
    )
    appendTerrainTopEdgeLines(
      group,
      darkSegments,
      new THREE.LineBasicMaterial({
        color: 0x050608,
        transparent: true,
        opacity: 0.32 * opacityScale,
        depthTest: true,
        depthWrite: false,
      }),
    )
  }

  appendEdgePair(normalLightSegments, normalDarkSegments)
  appendEdgePair(ghostLightSegments, ghostDarkSegments, GHOST_VOXEL_FADED_OPACITY)
  appendEdgePair(smartLightSegments, smartDarkSegments, smartGhostOpacity(options))

  return group
}

export const createVoxelRenderer = (container: THREE.Group): VoxelRenderer => {
  const voxelGroups = new Map<string, VoxelGroup>()
  let terrainTopEdgeOverlay: THREE.Group | null = null
  let terrainTopEdgeOverlayRevision: string | null = null
  let voxelBoxGeometry: THREE.BoxGeometry | null = null
  let visible = true

  const getVoxelBoxGeometry = () => {
    voxelBoxGeometry ??= new THREE.BoxGeometry(1, 1, 1)
    return voxelBoxGeometry
  }

  const disposeVoxelBoxGeometry = () => {
    voxelBoxGeometry?.dispose()
    voxelBoxGeometry = null
  }

  const applyObjectVisibility = (object: THREE.Object3D, nextVisible: boolean) => {
    if (object.visible !== nextVisible) object.visible = nextVisible
  }

  const disposeTerrainTopEdgeOverlay = () => {
    disposeObject3D(terrainTopEdgeOverlay)
    terrainTopEdgeOverlay = null
    terrainTopEdgeOverlayRevision = null
  }

  const syncTerrainTopEdgeOverlay = (
    voxels: ReadonlyArray<MapVoxelV2>,
    options: VoxelRendererSyncOptions,
  ) => {
    const nextRevision = terrainTopEdgeOverlayCacheKey(voxels, options)
    if (terrainTopEdgeOverlayRevision === nextRevision) {
      return
    }

    disposeTerrainTopEdgeOverlay()
    terrainTopEdgeOverlayRevision = nextRevision
    const overlay = buildTerrainTopEdgeOverlay(voxels, options)
    if (overlay.children.length === 0) return

    applyObjectVisibility(overlay, visible)
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
    sync(voxels, options = {}) {
      // Bucket voxels by group key so visually identical voxels share
      // an InstancedMesh.
      const buckets = new Map<string, MapVoxelV2[]>()
      for (const voxel of voxels) {
        const key = rendererVoxelGroupKey(voxel, options)
        let arr = buckets.get(key)
        if (!arr) {
          arr = []
          buckets.set(key, arr)
        }
        arr.push(voxel)
      }

      const bucketSnapshots = new Map<string, VoxelBucketSnapshot>()
      for (const [key, groupVoxels] of buckets.entries()) {
        bucketSnapshots.set(key, buildVoxelBucketSnapshot(groupVoxels, options))
      }

      // Drop groups that no longer have any voxels.
      for (const [key, group] of voxelGroups.entries()) {
        if (!bucketSnapshots.has(key)) {
          disposeVoxelGroup(container, group)
        }
      }

      const nextVoxelGroups = new Map<string, VoxelGroup>()
      const matrix = new THREE.Matrix4()
      for (const [key, snapshot] of bucketSnapshots.entries()) {
        const groupVoxels = snapshot.voxels
        const existing = voxelGroups.get(key)
        if (existing && existing.semanticSignature === snapshot.semanticSignature) {
          applyObjectVisibility(existing.mesh, visible)
          // Keep the existing instance matrices and userData voxel array aligned;
          // reordered-but-equivalent inputs do not need either to change.
          nextVoxelGroups.set(key, existing)
          continue
        }

        if (existing) {
          disposeVoxelGroup(container, existing)
        }
        const traits = snapshot.traits
        const firstVoxel = groupVoxels[0]
        if (!firstVoxel) continue
        const geometry = getVoxelBoxGeometry()
        const materials = buildVoxelFaceMaterials(firstVoxel, traits.opacity, traits.depthWrite)
        const mesh = new THREE.InstancedMesh(geometry, materials, groupVoxels.length)
        mesh.userData.voxels = groupVoxels
        mesh.renderOrder = traits.renderOrder
        applyObjectVisibility(mesh, visible)
        for (let i = 0; i < groupVoxels.length; i += 1) {
          const v = groupVoxels[i]
          if (!v) continue
          matrix.makeTranslation(v.x + 0.5, v.y + 0.5, v.z + 0.5)
          mesh.setMatrixAt(i, matrix)
        }
        mesh.instanceMatrix.needsUpdate = true
        container.add(mesh)
        nextVoxelGroups.set(key, {
          key,
          geometry,
          materials,
          mesh,
          voxels: groupVoxels,
          semanticSignature: snapshot.semanticSignature,
        })
      }

      voxelGroups.clear()
      for (const [key, group] of nextVoxelGroups.entries()) {
        voxelGroups.set(key, group)
      }

      syncTerrainTopEdgeOverlay(voxels, options)
    },

    dispose() {
      disposeTerrainTopEdgeOverlay()
      disposeAllVoxelGroups()
      disposeVoxelBoxGeometry()
    },

    setVisible(nextVisible) {
      if (visible === nextVisible) return

      visible = nextVisible
      applyObjectVisibility(container, nextVisible)
      for (const group of voxelGroups.values()) {
        applyObjectVisibility(group.mesh, nextVisible)
      }
      if (terrainTopEdgeOverlay) applyObjectVisibility(terrainTopEdgeOverlay, nextVisible)
    },

    meshes() {
      return Array.from(voxelGroups.values(), (group) => group.mesh)
    },
  }
}
