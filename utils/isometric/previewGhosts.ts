import * as THREE from 'three'
import type { MapHazardKind } from '~/types/map'
import { blockHexCss, type VoxelRenderStyle } from '~/utils/isometric/blockTextures'
import { buildVoxelFaceMaterials, paintBuildGhostMaterials } from '~/utils/isometric/materials'
import { disposeObject3D } from '~/utils/isometric/resourceDisposal'
import type { BuildTarget, HazardTarget } from '~/utils/isometric/types'
import { getHazardTexture, HAZARD_Y_OFFSET, hazardColorNumber } from '~/utils/isometric/hazardRenderer'

const dangerVoxelStyle = (baseColor: number): VoxelRenderStyle => ({
  materialId: 'airship_floor_metal',
  color: blockHexCss(baseColor),
})

export const createBuildGhostRenderer = (group: THREE.Group) => {
  let ghost: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial[]> | null = null
  let edges: THREE.LineSegments | null = null

  const ensure = () => {
    if (ghost && edges) return

    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const materials = buildVoxelFaceMaterials({ materialId: 'airship_floor_metal', color: '#fabd2f' }, 0.45, false)
    ghost = new THREE.Mesh(geometry, materials)
    ghost.visible = false
    group.add(ghost)

    edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: 0xfbf1c7,
        transparent: true,
        opacity: 0.95,
        depthTest: true,
        depthWrite: false,
      }),
    )
    edges.visible = false
    group.add(edges)
  }

  const hide = () => {
    if (ghost) ghost.visible = false
    if (edges) edges.visible = false
  }

  return {
    ensure,
    hide,

    update(
      target: BuildTarget | null,
      options: {
        buildMode: boolean
        styleForCell: (cell: { x: number; y: number; z: number }) => VoxelRenderStyle
      },
    ) {
      if (!options.buildMode) {
        hide()
        return
      }

      ensure()
      if (!ghost || !edges) return

      if (!target) {
        hide()
        return
      }

      ghost.position.set(target.cell.x + 0.5, target.cell.y + 0.5, target.cell.z + 0.5)
      edges.position.copy(ghost.position)
      ghost.visible = true
      edges.visible = true

      const edgeMaterial = edges.material as THREE.LineBasicMaterial
      if (target.action === 'remove') {
        paintBuildGhostMaterials(ghost.material, dangerVoxelStyle(0xfb4934), 0.42)
        edgeMaterial.color.setHex(0xfb4934)
      } else if (!target.valid) {
        paintBuildGhostMaterials(ghost.material, dangerVoxelStyle(0xfb4934), 0.32)
        edgeMaterial.color.setHex(0xfb4934)
      } else {
        paintBuildGhostMaterials(ghost.material, options.styleForCell(target.cell), 0.55)
        edgeMaterial.color.setHex(0xfbf1c7)
      }
    },

    dispose() {
      disposeObject3D(ghost)
      disposeObject3D(edges)
      ghost = null
      edges = null
    },
  }
}

export const createHazardGhostRenderer = (group: THREE.Group) => {
  let ghost: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null
  let edges: THREE.LineSegments | null = null

  const ensure = (kind: MapHazardKind) => {
    if (ghost && edges) return

    const geometry = new THREE.PlaneGeometry(0.92, 0.92)
    ghost = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: getHazardTexture(kind),
        transparent: true,
        opacity: 0.68,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    ghost.rotation.x = -Math.PI / 2
    ghost.renderOrder = 30
    ghost.visible = false
    group.add(ghost)

    edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: 0xfbf1c7,
        transparent: true,
        opacity: 0.95,
        depthTest: true,
        depthWrite: false,
      }),
    )
    edges.rotation.x = -Math.PI / 2
    edges.visible = false
    group.add(edges)
  }

  const hide = () => {
    if (ghost) ghost.visible = false
    if (edges) edges.visible = false
  }

  return {
    ensure,
    hide,

    update(target: HazardTarget | null, options: { hazardMode: boolean; kind: MapHazardKind }) {
      if (!options.hazardMode) {
        hide()
        return
      }

      ensure(options.kind)
      if (!ghost || !edges) return

      if (!target) {
        hide()
        return
      }

      const material = ghost.material as THREE.MeshBasicMaterial
      material.map = getHazardTexture(options.kind)
      material.color.setHex(target.valid ? 0xffffff : 0xfb4934)
      material.opacity = target.action === 'remove' ? 0.42 : 0.68
      material.needsUpdate = true

      const color = target.action === 'remove' || !target.valid
        ? 0xfb4934
        : hazardColorNumber(options.kind)
      ;(edges.material as THREE.LineBasicMaterial).color.setHex(color)

      ghost.position.set(target.cell.x + 0.5, target.cell.y + HAZARD_Y_OFFSET + 0.07, target.cell.z + 0.5)
      edges.position.copy(ghost.position)
      ghost.visible = true
      edges.visible = true
    },

    dispose() {
      disposeObject3D(ghost)
      disposeObject3D(edges)
      ghost = null
      edges = null
    },
  }
}
