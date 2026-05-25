import { describe, expect, it, vi } from 'vitest'
import type * as THREE from 'three'
import {
  createRendererPointerBoundsCache,
  pickBuildTargetFromPointer,
  pickHazardTargetFromPointer,
  pickPokemonIdFromPointer,
  setRaycasterFromPointer,
} from '~/utils/isometric/interactionTargets'

const makeRenderer = (bounds = { left: 10, top: 20, width: 100, height: 200 }) => {
  const getBoundingClientRect = vi.fn(() => bounds)
  const renderer = {
    domElement: {
      getBoundingClientRect,
    },
  } as unknown as THREE.WebGLRenderer

  return { renderer, getBoundingClientRect }
}

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
      renderer: makeRenderer().renderer,
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
      renderer: makeRenderer().renderer,
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
      renderer: makeRenderer().renderer,
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

  it('caches renderer bounds for repeated pointer normalization until invalidated', () => {
    const cache = createRendererPointerBoundsCache()
    const { renderer, getBoundingClientRect } = makeRenderer()
    const firstRaycaster = makeRaycaster()
    const secondRaycaster = makeRaycaster()

    setRaycasterFromPointer({
      coords: event,
      renderer,
      camera,
      raycaster: firstRaycaster,
      boundsCache: cache,
    })
    setRaycasterFromPointer({
      coords: { clientX: 85, clientY: 170 } as MouseEvent,
      renderer,
      camera,
      raycaster: secondRaycaster,
      boundsCache: cache,
    })

    expect(getBoundingClientRect).toHaveBeenCalledTimes(1)
    expect(firstRaycaster.setFromCamera).toHaveBeenCalledWith(
      expect.objectContaining({ x: 0, y: 0 }),
      camera,
    )
    expect(secondRaycaster.setFromCamera).toHaveBeenCalledWith(
      expect.objectContaining({ x: 0.5, y: -0.5 }),
      camera,
    )
  })

  it('refreshes cached renderer bounds after invalidation and exposes defensive snapshots', () => {
    let bounds = { left: 10, top: 20, width: 100, height: 200 }
    const getBoundingClientRect = vi.fn(() => bounds)
    const renderer = {
      domElement: { getBoundingClientRect },
    } as unknown as THREE.WebGLRenderer
    const cache = createRendererPointerBoundsCache()
    const raycaster = makeRaycaster()

    expect(cache.read(renderer)).toEqual(bounds)
    const snapshot = cache.snapshot()
    if (snapshot) (snapshot as { left: number }).left = 999
    expect(cache.snapshot()).toEqual(bounds)

    bounds = { left: 0, top: 0, width: 50, height: 50 }
    cache.invalidate()
    setRaycasterFromPointer({
      coords: { clientX: 25, clientY: 25 } as MouseEvent,
      renderer,
      camera,
      raycaster,
      boundsCache: cache,
    })

    expect(getBoundingClientRect).toHaveBeenCalledTimes(2)
    expect(raycaster.setFromCamera).toHaveBeenCalledWith(
      expect.objectContaining({ x: 0, y: 0 }),
      camera,
    )
  })
})
