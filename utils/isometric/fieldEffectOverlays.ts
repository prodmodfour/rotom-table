import * as THREE from 'three'
import type { GridDimensions } from '~/types/pokemon'
import type { MapVoxelV2 } from '~/types/map'
import { parseHexColor } from '~/utils/voxelColors'

export interface FieldEffectOverlayInput {
  dimensions: GridDimensions
  voxels: ReadonlyArray<MapVoxelV2>
  groundLevelY: number
}

export interface FieldEffectSurfaceOptions {
  color: string
  opacity: number
  yOffset: number
  inset: number
  renderOrder: number
}

export interface FieldEffectRoomBoundaryOptions {
  color: string
  opacity: number
  y: number
  inset: number
  renderOrder?: number
}

const fieldEffectColumnKey = (x: number, z: number): string => `${x},${z}`

export const fieldEffectColor = (color: string, fallback = 0xfabd2f): number =>
  parseHexColor(color) ?? fallback

export const buildFieldEffectColumnTops = (
  voxels: ReadonlyArray<MapVoxelV2>,
  groundY: number,
): Map<string, number> => {
  const columnTop = new Map<string, number>()
  for (const voxel of voxels) {
    const key = fieldEffectColumnKey(voxel.x, voxel.z)
    columnTop.set(key, Math.max(columnTop.get(key) ?? groundY, voxel.y + 1))
  }
  return columnTop
}

export const createFieldEffectSurfaceMesh = (
  input: FieldEffectOverlayInput,
  options: FieldEffectSurfaceOptions,
): THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> => {
  const count = Math.max(1, input.dimensions.x * input.dimensions.z)
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(
      Math.max(0.2, 1 - options.inset),
      Math.max(0.2, 1 - options.inset),
    ),
    new THREE.MeshBasicMaterial({
      color: fieldEffectColor(options.color),
      transparent: true,
      opacity: options.opacity,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    count,
  )

  const groundY = input.groundLevelY
  const columnTop = buildFieldEffectColumnTops(input.voxels, groundY)

  const rotation = new THREE.Matrix4().makeRotationX(-Math.PI / 2)
  const translation = new THREE.Matrix4()
  const matrix = new THREE.Matrix4()
  let index = 0
  for (let z = 0; z < input.dimensions.z; z += 1) {
    for (let x = 0; x < input.dimensions.x; x += 1) {
      const y =
        Math.max(groundY, columnTop.get(fieldEffectColumnKey(x, z)) ?? groundY) +
        options.yOffset
      translation.makeTranslation(x + 0.5, y, z + 0.5)
      matrix.multiplyMatrices(translation, rotation)
      mesh.setMatrixAt(index, matrix)
      index += 1
    }
  }
  mesh.count = index
  mesh.instanceMatrix.needsUpdate = true
  mesh.renderOrder = options.renderOrder
  return mesh
}

export const createFieldEffectRoomBoundary = (
  input: FieldEffectOverlayInput,
  options: FieldEffectRoomBoundaryOptions,
): THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial> => {
  const width = Math.max(0.2, input.dimensions.x - options.inset * 2)
  const depth = Math.max(0.2, input.dimensions.z - options.inset * 2)
  const height = Math.max(1, input.dimensions.y - options.y)
  const geometry = new THREE.BoxGeometry(width, height, depth)
  const edges = new THREE.EdgesGeometry(geometry)
  geometry.dispose()
  const lines = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({
      color: fieldEffectColor(options.color),
      transparent: true,
      opacity: options.opacity,
      depthTest: true,
      depthWrite: false,
    }),
  )
  lines.position.set(
    input.dimensions.x / 2,
    options.y + height / 2,
    input.dimensions.z / 2,
  )
  lines.renderOrder = options.renderOrder ?? 18
  return lines
}
