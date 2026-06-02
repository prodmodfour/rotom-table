import * as THREE from 'three'
import type { GridDimensions } from '~/types/pokemon'
import type { AppThemeMode } from '~/utils/appTheme'
import { disposeObject3D } from '~/utils/isometric/resourceDisposal'

const buildFloorGridGeometry = (dimensions: GridDimensions) => {
  const points: number[] = []
  const y = 0.02

  for (let z = 0; z <= dimensions.z; z += 1) {
    points.push(0, y, z, dimensions.x, y, z)
  }

  for (let x = 0; x <= dimensions.x; x += 1) {
    points.push(x, y, 0, x, y, dimensions.z)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  return geometry
}

const buildMoveGridGeometry = (dimensions: GridDimensions) => {
  const points: number[] = []

  for (let y = 1; y <= dimensions.y; y += 1) {
    for (let z = 0; z <= dimensions.z; z += 1) {
      points.push(0, y, z, dimensions.x, y, z)
    }
  }

  for (let x = 0; x <= dimensions.x; x += 1) {
    for (let z = 0; z <= dimensions.z; z += 1) {
      points.push(x, 0, z, x, dimensions.y, z)
    }
  }

  for (let x = 0; x <= dimensions.x; x += 1) {
    for (let y = 1; y <= dimensions.y; y += 1) {
      points.push(x, y, 0, x, y, dimensions.z)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  return geometry
}

export interface GridRendererSyncOptions {
  themeMode?: AppThemeMode
}

const GRID_THEME_PALETTES: Record<AppThemeMode, {
  floor: number
  seam: number
  seamOpacity: number
  movement: number
  movementOpacity: number
}> = {
  dark: {
    floor: 0x12151b,
    seam: 0x050608,
    seamOpacity: 0.85,
    movement: 0x050608,
    movementOpacity: 0.01,
  },
  light: {
    floor: 0xf2e3d0,
    seam: 0xa39380,
    seamOpacity: 0.58,
    movement: 0x6f6255,
    movementOpacity: 0.045,
  },
}

export const createGridRenderer = (group: THREE.Group) => {
  let floorGridLines: THREE.LineSegments | null = null
  let moveGridLines: THREE.LineSegments | null = null
  let floorPlane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null
  let appliedGridVisible = true
  let appliedMovementVisible = true

  const applyGridObjectVisibility = () => {
    if (group.visible !== appliedGridVisible) group.visible = appliedGridVisible
    if (floorGridLines && floorGridLines.visible !== appliedGridVisible) {
      floorGridLines.visible = appliedGridVisible
    }
    const nextMoveGridVisible = appliedGridVisible && appliedMovementVisible
    if (moveGridLines && moveGridLines.visible !== nextMoveGridVisible) {
      moveGridLines.visible = nextMoveGridVisible
    }
  }

  const disposeGridObjects = () => {
    disposeObject3D(floorGridLines)
    disposeObject3D(moveGridLines)
    disposeObject3D(floorPlane)
    floorGridLines = null
    moveGridLines = null
    floorPlane = null
  }

  return {
    sync(dimensions: GridDimensions, options: GridRendererSyncOptions = {}) {
      disposeGridObjects()

      const palette = GRID_THEME_PALETTES[options.themeMode ?? 'dark']

      // Terrain seam lines matching the active page theme. Seam lines stay
      // subtle so terrain reads as tile grout without overpowering sprites.
      floorGridLines = new THREE.LineSegments(
        buildFloorGridGeometry(dimensions),
        new THREE.LineBasicMaterial({
          color: palette.seam,
          transparent: true,
          opacity: palette.seamOpacity,
          depthTest: true,
          depthWrite: false,
        }),
      )
      group.add(floorGridLines)

      moveGridLines = new THREE.LineSegments(
        buildMoveGridGeometry(dimensions),
        new THREE.LineBasicMaterial({
          color: palette.movement,
          transparent: true,
          opacity: palette.movementOpacity,
          depthTest: true,
          depthWrite: false,
        }),
      )
      group.add(moveGridLines)

      // Floor plane = the lit "top" of the tabletop. It sits just below voxel
      // tops so placed objects visually pop upward.
      floorPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(dimensions.x, dimensions.z),
        new THREE.MeshBasicMaterial({
          color: palette.floor,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      )
      floorPlane.rotation.x = -Math.PI / 2
      floorPlane.position.set(dimensions.x / 2, 0, dimensions.z / 2)
      group.add(floorPlane)
      applyGridObjectVisibility()
    },

    setVisible({ grid, movement }: { grid: boolean; movement: boolean }) {
      if (appliedGridVisible === grid && appliedMovementVisible === movement) {
        return
      }

      appliedGridVisible = grid
      appliedMovementVisible = movement
      applyGridObjectVisibility()
    },

    floorPlane() {
      return floorPlane
    },

    dispose() {
      disposeGridObjects()
    },
  }
}
