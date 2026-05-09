import * as THREE from 'three'
import type { GridDimensions, SpawnedPokemon } from '~/types/pokemon'
import type { MapHazardKind, MapHazardV2, MapVoxelV2 } from '~/types/map'
import type { BuildTool } from '~/shared/mapEditor'
import { cellInsidePokemonFootprint, voxelKey } from '~/utils/voxels'
import type { BuildTarget, HazardTarget, PokemonRenderObject } from '~/utils/isometric/types'

export type PointerCoords = Pick<MouseEvent | PointerEvent, 'clientX' | 'clientY'>

export const setRaycasterFromPointer = (options: {
  coords: PointerCoords
  renderer: THREE.WebGLRenderer | null
  camera: THREE.Camera | null
  raycaster: THREE.Raycaster
}) => {
  if (!options.renderer || !options.camera) return null

  const bounds = options.renderer.domElement.getBoundingClientRect()
  const pointer = new THREE.Vector2(
    ((options.coords.clientX - bounds.left) / bounds.width) * 2 - 1,
    -((options.coords.clientY - bounds.top) / bounds.height) * 2 + 1,
  )

  options.raycaster.setFromCamera(pointer, options.camera)
  return pointer
}

export const pickPokemonIdFromPointer = (options: {
  event: MouseEvent | PointerEvent
  renderer: THREE.WebGLRenderer | null
  camera: THREE.Camera | null
  raycaster: THREE.Raycaster
  renderObjects: Iterable<PokemonRenderObject>
}) => {
  if (!setRaycasterFromPointer(options)) return null

  const proxies = Array.from(options.renderObjects, (renderObject) => renderObject.proxy)
  const intersections = options.raycaster.intersectObjects(proxies, false)
  const hit = intersections[0]?.object

  return (hit?.userData.pokemonId as string | undefined) ?? null
}

export const getMoveGridIntersectionFromPointer = (options: {
  event: MouseEvent | PointerEvent
  yLevel: number
  renderer: THREE.WebGLRenderer | null
  camera: THREE.Camera | null
  raycaster: THREE.Raycaster
}) => {
  if (!setRaycasterFromPointer({
    coords: options.event,
    renderer: options.renderer,
    camera: options.camera,
    raycaster: options.raycaster,
  })) {
    return null
  }

  const point = new THREE.Vector3()
  const hit = options.raycaster.ray.intersectPlane(
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -options.yLevel),
    point,
  )

  return hit ? point : null
}

export const pickBuildTargetFromPointer = (options: {
  event: MouseEvent | PointerEvent
  tool: BuildTool
  renderer: THREE.WebGLRenderer | null
  camera: THREE.Camera | null
  raycaster: THREE.Raycaster
  floorPlane: THREE.Object3D | null
  voxelMeshes: THREE.Object3D[]
  dimensions: GridDimensions
  pokemons: SpawnedPokemon[]
  allVoxelOccupancy: ReadonlySet<string>
  mapMovementOccupancy: ReadonlySet<string>
}): BuildTarget | null => {
  if (!setRaycasterFromPointer(options)) return null

  const targets: THREE.Object3D[] = []
  if (options.floorPlane) targets.push(options.floorPlane)
  targets.push(...options.voxelMeshes)

  const intersections = options.raycaster.intersectObjects(targets, false)
  const hit = intersections[0]
  if (!hit) return null

  let voxel: MapVoxelV2 | null = null
  if (hit.object !== options.floorPlane) {
    const mesh = hit.object as THREE.InstancedMesh
    const voxels = mesh.userData.voxels as MapVoxelV2[] | undefined
    if (voxels && hit.instanceId !== undefined) {
      voxel = voxels[hit.instanceId] ?? null
    }
  }

  if (options.tool === 'eraser') {
    if (!voxel) return null
    return {
      action: 'remove',
      cell: { x: voxel.x, y: voxel.y, z: voxel.z },
      valid: true,
    }
  }

  let cell: { x: number; y: number; z: number }
  if (voxel && hit.face) {
    const normal = hit.face.normal
    cell = {
      x: voxel.x + Math.round(normal.x),
      y: voxel.y + Math.round(normal.y),
      z: voxel.z + Math.round(normal.z),
    }
  } else {
    cell = {
      x: Math.floor(hit.point.x),
      y: 0,
      z: Math.floor(hit.point.z),
    }
  }

  const inBounds =
    cell.x >= 0 &&
    cell.x < options.dimensions.x &&
    cell.y >= 0 &&
    cell.y < options.dimensions.y &&
    cell.z >= 0 &&
    cell.z < options.dimensions.z
  const key = voxelKey(cell.x, cell.y, cell.z)
  const occupiedByVoxel = options.allVoxelOccupancy.has(key)
  const occupiedByBlockingObject = options.mapMovementOccupancy.has(key)
  const insidePokemon = cellInsidePokemonFootprint(cell.x, cell.y, cell.z, options.pokemons)

  return {
    action: 'place',
    cell,
    valid: inBounds && !occupiedByVoxel && !occupiedByBlockingObject && !insidePokemon,
  }
}

const hazardTargetFromHit = (
  hit: THREE.Intersection,
): { x: number; y: number; z: number; kind?: MapHazardKind } | null => {
  const hazard = hit.object.userData.hazard as MapHazardV2 | undefined
  if (hazard) return { x: hazard.x, y: hazard.y, z: hazard.z, kind: hazard.kind }

  const mesh = hit.object as THREE.InstancedMesh
  const voxels = mesh.userData.voxels as MapVoxelV2[] | undefined
  const voxel = voxels && hit.instanceId !== undefined ? voxels[hit.instanceId] : null
  if (voxel) return { x: voxel.x, y: voxel.y + 1, z: voxel.z }

  return null
}

const hazardTargetFromGroundPlane = (options: {
  raycaster: THREE.Raycaster
  groundLevelY: number
}): { x: number; y: number; z: number; kind?: MapHazardKind } | null => {
  const point = new THREE.Vector3()
  const hit = options.raycaster.ray.intersectPlane(
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -options.groundLevelY),
    point,
  )
  if (!hit) return null
  return { x: Math.floor(point.x), y: options.groundLevelY, z: Math.floor(point.z) }
}

export const pickHazardTargetFromPointer = (options: {
  event: MouseEvent | PointerEvent
  tool: BuildTool
  renderer: THREE.WebGLRenderer | null
  camera: THREE.Camera | null
  raycaster: THREE.Raycaster
  hazardMeshes: THREE.Object3D[]
  voxelMeshes: THREE.Object3D[]
  hazards: MapHazardV2[]
  dimensions: GridDimensions
  groundLevelY: number
}): HazardTarget | null => {
  if (!setRaycasterFromPointer(options)) return null

  const targets: THREE.Object3D[] = []
  targets.push(...options.hazardMeshes)
  targets.push(...options.voxelMeshes)

  const intersections = options.raycaster.intersectObjects(targets, false)
  const target = intersections[0]
    ? hazardTargetFromHit(intersections[0])
    : hazardTargetFromGroundPlane({ raycaster: options.raycaster, groundLevelY: options.groundLevelY })
  if (!target) return null

  const cell = { x: target.x, y: target.y, z: target.z }
  const inBounds =
    cell.x >= 0 &&
    cell.x < options.dimensions.x &&
    cell.y >= 0 &&
    cell.y < options.dimensions.y &&
    cell.z >= 0 &&
    cell.z < options.dimensions.z

  if (options.tool === 'eraser') {
    const hasHazard = options.hazards.some(
      (hazard) => hazard.x === cell.x && hazard.y === cell.y && hazard.z === cell.z,
    )
    return {
      action: 'remove',
      cell,
      kind: target.kind,
      valid: inBounds && hasHazard,
    }
  }

  return {
    action: 'place',
    cell,
    valid: inBounds,
  }
}
