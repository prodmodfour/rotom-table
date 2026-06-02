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

const BACKDROP_MARGIN = 8
const BACKDROP_PLANE_Y = -0.08
const BACKDROP_GRID_Y = -0.05

const buildBackdropGridGeometry = (dimensions: GridDimensions) => {
  const points: number[] = []
  const minX = -BACKDROP_MARGIN
  const maxX = dimensions.x + BACKDROP_MARGIN
  const minZ = -BACKDROP_MARGIN
  const maxZ = dimensions.z + BACKDROP_MARGIN

  const addLine = (x1: number, z1: number, x2: number, z2: number) => {
    points.push(x1, BACKDROP_GRID_Y, z1, x2, BACKDROP_GRID_Y, z2)
  }

  for (let z = minZ; z <= maxZ; z += 1) {
    if (z > 0 && z < dimensions.z) {
      addLine(minX, z, 0, z)
      addLine(dimensions.x, z, maxX, z)
    } else {
      addLine(minX, z, maxX, z)
    }
  }

  for (let x = minX; x <= maxX; x += 1) {
    if (x > 0 && x < dimensions.x) {
      addLine(x, minZ, x, 0)
      addLine(x, dimensions.z, x, maxZ)
    } else {
      addLine(x, minZ, x, maxZ)
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
  backdropBase: number
  backdropGlow: number
  backdropGlowMix: number
  backdropGrid: number
}> = {
  dark: {
    floor: 0x12151b,
    seam: 0x050608,
    seamOpacity: 0.85,
    movement: 0x050608,
    movementOpacity: 0.01,
    backdropBase: 0x050608,
    backdropGlow: 0x13284c,
    backdropGlowMix: 0.34,
    backdropGrid: 0x0b111b,
  },
  light: {
    floor: 0xf2e3d0,
    seam: 0xa39380,
    seamOpacity: 0.58,
    movement: 0x6f6255,
    movementOpacity: 0.045,
    backdropBase: 0xfff8ed,
    backdropGlow: 0xf5d7c8,
    backdropGlowMix: 0.24,
    backdropGrid: 0xe8ddcf,
  },
}

type GridThemePalette = (typeof GRID_THEME_PALETTES)[AppThemeMode]

const buildBackdropPlaneGeometry = (
  dimensions: GridDimensions,
  palette: GridThemePalette,
) => {
  const width = dimensions.x + BACKDROP_MARGIN * 2
  const depth = dimensions.z + BACKDROP_MARGIN * 2
  const geometry = new THREE.PlaneGeometry(width, depth, 24, 24)
  const position = geometry.getAttribute('position')
  const baseColor = new THREE.Color(palette.backdropBase)
  const glowColor = new THREE.Color(palette.backdropGlow)
  const colors: number[] = []

  for (let index = 0; index < position.count; index += 1) {
    const nx = position.getX(index) / Math.max(width / 2, 1)
    const nz = position.getY(index) / Math.max(depth / 2, 1)
    const distance = Math.hypot(nx, nz)
    const glow = Math.max(0, 1 - distance) ** 2 * palette.backdropGlowMix
    const color = baseColor.clone().lerp(glowColor, glow)
    color.toArray(colors, colors.length)
  }

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return geometry
}

export const createGridRenderer = (group: THREE.Group) => {
  let backdropPlane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null
  let backdropGridLines: THREE.LineSegments | null = null
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
    disposeObject3D(backdropPlane)
    disposeObject3D(backdropGridLines)
    disposeObject3D(floorGridLines)
    disposeObject3D(moveGridLines)
    disposeObject3D(floorPlane)
    backdropPlane = null
    backdropGridLines = null
    floorGridLines = null
    moveGridLines = null
    floorPlane = null
  }

  return {
    sync(dimensions: GridDimensions, options: GridRendererSyncOptions = {}) {
      disposeGridObjects()

      const palette = GRID_THEME_PALETTES[options.themeMode ?? 'dark']

      // A low-contrast tabletop backdrop behind the playable map. It gives
      // empty background space the same isometric direction as the terrain
      // without requiring a transparent WebGL canvas.
      backdropPlane = new THREE.Mesh(
        buildBackdropPlaneGeometry(dimensions, palette),
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
        }),
      )
      backdropPlane.rotation.x = -Math.PI / 2
      backdropPlane.position.set(dimensions.x / 2, BACKDROP_PLANE_Y, dimensions.z / 2)
      backdropPlane.renderOrder = -30
      group.add(backdropPlane)

      backdropGridLines = new THREE.LineSegments(
        buildBackdropGridGeometry(dimensions),
        new THREE.LineBasicMaterial({
          color: palette.backdropGrid,
          depthTest: false,
          depthWrite: false,
        }),
      )
      backdropGridLines.renderOrder = -20
      group.add(backdropGridLines)

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
