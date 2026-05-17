import * as THREE from 'three'
import type { GridDimensions } from '~/types/pokemon'
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

export const createGridRenderer = (group: THREE.Group) => {
  let floorGridLines: THREE.LineSegments | null = null
  let moveGridLines: THREE.LineSegments | null = null
  let floorPlane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null

  const disposeGridObjects = () => {
    disposeObject3D(floorGridLines)
    disposeObject3D(moveGridLines)
    disposeObject3D(floorPlane)
    floorGridLines = null
    moveGridLines = null
    floorPlane = null
  }

  return {
    sync(dimensions: GridDimensions) {
      disposeGridObjects()

      // Graphite-black terrain seam lines matching the page background.
      // Seam lines stay subtle so terrain reads as tile grout.
      floorGridLines = new THREE.LineSegments(
        buildFloorGridGeometry(dimensions),
        new THREE.LineBasicMaterial({
          color: 0x050608,
          transparent: true,
          opacity: 0.85,
          depthTest: true,
          depthWrite: false,
        }),
      )
      group.add(floorGridLines)

      moveGridLines = new THREE.LineSegments(
        buildMoveGridGeometry(dimensions),
        new THREE.LineBasicMaterial({
          color: 0x050608,
          transparent: true,
          opacity: 0.01,
          depthTest: true,
          depthWrite: false,
        }),
      )
      group.add(moveGridLines)

      // Floor plane = the lit "top" of the tabletop. The graphite surface sits
      // just below voxel tops so placed objects visually pop upward.
      floorPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(dimensions.x, dimensions.z),
        new THREE.MeshBasicMaterial({
          color: 0x12151b,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      )
      floorPlane.rotation.x = -Math.PI / 2
      floorPlane.position.set(dimensions.x / 2, 0, dimensions.z / 2)
      group.add(floorPlane)
    },

    setVisible({ grid, movement }: { grid: boolean; movement: boolean }) {
      group.visible = grid
      if (floorGridLines) floorGridLines.visible = grid
      if (moveGridLines) moveGridLines.visible = grid && movement
    },

    floorPlane() {
      return floorPlane
    },

    dispose() {
      disposeGridObjects()
    },
  }
}
