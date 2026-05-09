import { describe, expect, it, vi } from 'vitest'
import type * as THREE from 'three'
import {
  pickBuildTargetFromPointer,
  pickHazardTargetFromPointer,
  pickPokemonIdFromPointer,
} from '~/utils/isometric/interactionTargets'

const makeRenderer = () => ({
  domElement: {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 200 }),
  },
}) as unknown as THREE.WebGLRenderer

const makeRaycaster = () => ({
  setFromCamera: vi.fn(),
  intersectObjects: vi.fn(() => []),
  ray: {
    intersectPlane: vi.fn(() => null),
  },
}) as unknown as THREE.Raycaster

const event = { clientX: 60, clientY: 120 } as MouseEvent
const camera = {} as THREE.Camera

describe('isometric interaction target picking', () => {
  it('uses pointer event coordinates for token picking', () => {
    const raycaster = makeRaycaster()

    const result = pickPokemonIdFromPointer({
      event,
      renderer: makeRenderer(),
      camera,
      raycaster,
      renderObjects: [],
    })

    expect(result).toBeNull()
    expect(raycaster.setFromCamera).toHaveBeenCalledWith(
      expect.objectContaining({ x: 0, y: 0 }),
      camera,
    )
  })

  it('uses pointer event coordinates for build and hazard picking', () => {
    const buildRaycaster = makeRaycaster()
    const hazardRaycaster = makeRaycaster()

    expect(pickBuildTargetFromPointer({
      event,
      tool: 'pencil',
      renderer: makeRenderer(),
      camera,
      raycaster: buildRaycaster,
      floorPlane: null,
      voxelMeshes: [],
      dimensions: { x: 4, y: 4, z: 4 },
      pokemons: [],
      allVoxelOccupancy: new Set(),
      mapMovementOccupancy: new Set(),
    })).toBeNull()

    expect(pickHazardTargetFromPointer({
      event,
      tool: 'pencil',
      renderer: makeRenderer(),
      camera,
      raycaster: hazardRaycaster,
      hazardMeshes: [],
      voxelMeshes: [],
      hazards: [],
      dimensions: { x: 4, y: 4, z: 4 },
      groundLevelY: 0,
    })).toBeNull()

    expect(buildRaycaster.setFromCamera).toHaveBeenCalledWith(
      expect.objectContaining({ x: 0, y: 0 }),
      camera,
    )
    expect(hazardRaycaster.setFromCamera).toHaveBeenCalledWith(
      expect.objectContaining({ x: 0, y: 0 }),
      camera,
    )
  })
})
