import * as THREE from 'three'
import type { MapGroundItem } from '#shared/moveAutomation/groundItems'
import { disposeObject3D } from './resourceDisposal'

export const GROUND_ITEM_MARKER_RADIUS = 0.2
export const GROUND_ITEM_MARKER_Y_OFFSET = 0.28
export const GROUND_ITEM_MARKER_COLOR = 0xf4c95d
export const GROUND_ITEM_MARKER_SELECTED_COLOR = 0xffffff
export const GROUND_ITEM_MARKER_SELECTED_SCALE = 1.35

export type GroundItemMarkerMesh = THREE.Mesh<
  THREE.OctahedronGeometry,
  THREE.MeshBasicMaterial
>

export interface GroundItemRenderer {
  sync(items: readonly MapGroundItem[]): void
  setSelected(itemId: string | null): void
  meshes(): GroundItemMarkerMesh[]
  dispose(): void
}

const paintSelection = (
  mesh: GroundItemMarkerMesh,
  selectedItemId: string | null,
): void => {
  const selected = mesh.userData.groundItemId === selectedItemId
  const scale = selected ? GROUND_ITEM_MARKER_SELECTED_SCALE : 1
  mesh.scale.setScalar(scale)
  mesh.material.color.setHex(
    selected ? GROUND_ITEM_MARKER_SELECTED_COLOR : GROUND_ITEM_MARKER_COLOR,
  )
  mesh.material.opacity = selected ? 1 : 0.92
}

const createMarkerMesh = (item: MapGroundItem): GroundItemMarkerMesh => {
  const geometry = new THREE.OctahedronGeometry(GROUND_ITEM_MARKER_RADIUS, 0)
  const material = new THREE.MeshBasicMaterial({
    color: GROUND_ITEM_MARKER_COLOR,
    transparent: true,
    opacity: 0.92,
    depthTest: true,
    depthWrite: true,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(
    item.position.x + 0.5,
    item.position.y + GROUND_ITEM_MARKER_Y_OFFSET,
    item.position.z + 0.5,
  )
  mesh.rotation.y = Math.PI / 4
  mesh.renderOrder = 13
  mesh.name = `ground-item:${item.id}`
  mesh.userData.groundItemId = item.id
  mesh.userData.groundItem = item
  return mesh
}

/**
 * Render a deliberately small, generic marker for every authoritative map
 * item. Item mechanics and identity remain in map state; the marker carries
 * only the stable ID required by the pointer-selection seam.
 */
export const createGroundItemRenderer = (container: THREE.Group): GroundItemRenderer => {
  const markerMeshes: GroundItemMarkerMesh[] = []
  let selectedItemId: string | null = null

  const clear = () => {
    for (const mesh of markerMeshes.splice(0)) disposeObject3D(mesh)
  }

  return {
    sync(items) {
      clear()
      for (const item of items) {
        const mesh = createMarkerMesh(item)
        paintSelection(mesh, selectedItemId)
        container.add(mesh)
        markerMeshes.push(mesh)
      }
    },

    setSelected(itemId) {
      selectedItemId = itemId
      for (const mesh of markerMeshes) paintSelection(mesh, selectedItemId)
    },

    meshes: () => [...markerMeshes],

    dispose: clear,
  }
}
