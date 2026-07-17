import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import {
  createBuildHazardPickTargetCache,
  createPointerRaycastScratch,
  createRendererPointerBoundsCache,
  createTokenProxyPickTargetCache,
  getMoveGridIntersectionFromPointer,
  pickBuildTargetFromPointer,
  pickGroundItemIdFromPointer,
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

  it('picks stable map-ground item IDs without exposing item mechanics', () => {
    const marker = new THREE.Mesh()
    marker.userData.groundItemId = 'ground-item-iron-ball-1'
    marker.userData.groundItem = { quantity: 2 }
    const raycaster = makeRaycaster()
    vi.mocked(raycaster.intersectObjects).mockReturnValue([
      { object: marker } as unknown as THREE.Intersection,
    ])

    expect(pickGroundItemIdFromPointer({
      event,
      renderer: makeRenderer().renderer,
      camera,
      raycaster,
      targets: [marker],
    })).toBe('ground-item-iron-ball-1')

    delete marker.userData.groundItemId
    expect(pickGroundItemIdFromPointer({
      event,
      renderer: makeRenderer().renderer,
      camera,
      raycaster,
      targets: [marker],
    })).toBeNull()
    expect(pickGroundItemIdFromPointer({
      event,
      renderer: null,
      camera,
      raycaster,
      targets: [marker],
    })).toBeNull()
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

  it('records pointer raycast metric kinds only after a pointer ray is available', () => {
    const recordRaycast = vi.fn()

    pickPokemonIdFromPointer({
      event,
      renderer: null,
      camera,
      raycaster: makeRaycaster(),
      renderObjects: [],
      recordRaycast,
    })
    expect(recordRaycast).not.toHaveBeenCalled()

    pickPokemonIdFromPointer({
      event,
      renderer: makeRenderer().renderer,
      camera,
      raycaster: makeRaycaster(),
      renderObjects: [],
      recordRaycast,
    })
    getMoveGridIntersectionFromPointer({
      event,
      yLevel: 0,
      renderer: makeRenderer().renderer,
      camera,
      raycaster: makeRaycaster(),
      recordRaycast,
    })
    pickBuildTargetFromPointer({
      event,
      tool: 'pencil',
      renderer: makeRenderer().renderer,
      camera,
      raycaster: makeRaycaster(),
      floorPlane: null,
      voxelMeshes: [],
      dimensions: { x: 4, y: 4, z: 4 },
      pokemons: [],
      allVoxelOccupancy: new Set(),
      mapMovementOccupancy: new Set(),
      recordRaycast,
    })
    pickHazardTargetFromPointer({
      event,
      tool: 'pencil',
      renderer: makeRenderer().renderer,
      camera,
      raycaster: makeRaycaster(),
      hazardMeshes: [],
      voxelMeshes: [],
      hazards: [],
      dimensions: { x: 4, y: 4, z: 4 },
      groundLevelY: 0,
      recordRaycast,
    })

    expect(recordRaycast).toHaveBeenCalledTimes(4)
    expect(recordRaycast.mock.calls.map(([kind]) => kind)).toEqual([
      'token-pick',
      'movement-plane',
      'build-pick',
      'hazard-pick',
    ])
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

  it('reuses explicit pointer scratch while preserving normalized coordinates', () => {
    const scratch = createPointerRaycastScratch()
    const { renderer } = makeRenderer()
    const raycaster = makeRaycaster()

    const firstPointer = setRaycasterFromPointer({
      coords: event,
      renderer,
      camera,
      raycaster,
      scratch,
    })
    expect(firstPointer).toBe(scratch.pointer)
    expect(scratch.pointer.x).toBe(0)
    expect(scratch.pointer.y).toBe(0)
    expect(raycaster.setFromCamera).toHaveBeenLastCalledWith(scratch.pointer, camera)

    const secondPointer = setRaycasterFromPointer({
      coords: { clientX: 85, clientY: 170 } as MouseEvent,
      renderer,
      camera,
      raycaster,
      scratch,
    })
    expect(secondPointer).toBe(firstPointer)
    expect(scratch.pointer.x).toBe(0.5)
    expect(scratch.pointer.y).toBe(-0.5)
    expect(raycaster.setFromCamera).toHaveBeenLastCalledWith(scratch.pointer, camera)
  })

  it('updates cached token proxy targets only when render objects are added or removed', () => {
    const cache = createTokenProxyPickTargetCache()
    const proxyA = new THREE.Mesh()
    const proxyB = new THREE.Mesh()
    const renderObjectA = { proxy: proxyA }
    const renderObjectB = { proxy: proxyB }

    cache.add(renderObjectA)
    cache.add(renderObjectA)
    expect(cache.targets()).toEqual([proxyA])

    cache.add(renderObjectB)
    expect(cache.targets()).toEqual([proxyA, proxyB])
    const snapshot = cache.snapshot()
    snapshot.pop()
    expect(cache.targets()).toEqual([proxyA, proxyB])

    cache.remove(renderObjectA)
    expect(cache.targets()).toEqual([proxyB])
    cache.remove(renderObjectA)
    expect(cache.targets()).toEqual([proxyB])

    cache.clear()
    expect(cache.targets()).toEqual([])
  })

  it('caches build and hazard pick targets until renderer collections change', () => {
    const cache = createBuildHazardPickTargetCache()
    const floorPlane = new THREE.Object3D()
    const nextFloorPlane = new THREE.Object3D()
    const voxelA = new THREE.Object3D()
    const voxelB = new THREE.Object3D()
    const hazardA = new THREE.Object3D()
    const hazardB = new THREE.Object3D()

    cache.setFloorPlane(floorPlane)
    cache.setVoxelMeshes([voxelA])
    cache.setHazardMeshes([hazardA])

    const buildTargets = cache.buildTargets()
    const hazardTargets = cache.hazardTargets()
    expect(buildTargets).toEqual([floorPlane, voxelA])
    expect(hazardTargets).toEqual([hazardA, voxelA])
    expect(cache.buildTargets()).toBe(buildTargets)
    expect(cache.hazardTargets()).toBe(hazardTargets)

    cache.setFloorPlane(floorPlane)
    cache.setVoxelMeshes([voxelA])
    cache.setHazardMeshes([hazardA])
    expect(cache.buildTargets()).toBe(buildTargets)
    expect(cache.hazardTargets()).toBe(hazardTargets)
    expect(buildTargets).toEqual([floorPlane, voxelA])
    expect(hazardTargets).toEqual([hazardA, voxelA])

    cache.setFloorPlane(nextFloorPlane)
    cache.setVoxelMeshes([voxelB])
    cache.setHazardMeshes([hazardB])
    expect(cache.floorPlane()).toBe(nextFloorPlane)
    expect(cache.buildTargets()).toBe(buildTargets)
    expect(cache.hazardTargets()).toBe(hazardTargets)
    expect(buildTargets).toEqual([nextFloorPlane, voxelB])
    expect(hazardTargets).toEqual([hazardB, voxelB])

    const snapshot = cache.snapshot()
    snapshot.voxelMeshes.pop()
    snapshot.hazardTargets.pop()
    expect(cache.snapshot()).toEqual({
      floorPlane: nextFloorPlane,
      voxelMeshes: [voxelB],
      hazardMeshes: [hazardB],
      buildTargets: [nextFloorPlane, voxelB],
      hazardTargets: [hazardB, voxelB],
    })

    cache.clear()
    expect(cache.floorPlane()).toBeNull()
    expect(buildTargets).toEqual([])
    expect(hazardTargets).toEqual([])
    expect(cache.snapshot()).toEqual({
      floorPlane: null,
      voxelMeshes: [],
      hazardMeshes: [],
      buildTargets: [],
      hazardTargets: [],
    })
  })

  it('uses cached token proxy targets without iterating render objects for each pick', () => {
    const scratch = createPointerRaycastScratch()
    const cache = createTokenProxyPickTargetCache()
    const proxy = new THREE.Mesh()
    proxy.userData.pokemonId = 'cached-token'
    cache.add({ proxy })
    const renderObjects = {
      [Symbol.iterator]: vi.fn(function* () {
        throw new Error('render objects should not be rebuilt when proxy targets are cached')
      }),
    } as unknown as Iterable<never>
    const intersectObjects = vi.fn((targets: THREE.Object3D[], _recursive: boolean, optionalTarget?: THREE.Intersection[]) => {
      expect(targets).toBe(cache.targets())
      expect(optionalTarget).toBe(scratch.intersections)
      optionalTarget?.push({ distance: 0, object: proxy, point: new THREE.Vector3() } as THREE.Intersection)
      return optionalTarget ?? []
    })
    const raycaster = {
      setFromCamera: vi.fn(),
      intersectObjects,
      ray: { intersectPlane: vi.fn(() => null) },
    } as unknown as THREE.Raycaster

    expect(pickPokemonIdFromPointer({
      event,
      renderer: makeRenderer().renderer,
      camera,
      raycaster,
      renderObjects,
      tokenProxyTargets: cache,
      scratch,
    })).toBe('cached-token')
    expect(renderObjects[Symbol.iterator]).not.toHaveBeenCalled()
    expect(scratch.pokemonProxyTargets).toEqual([])
  })

  it('reuses token proxy target and intersection arrays when scratch is provided', () => {
    const scratch = createPointerRaycastScratch()
    const proxyA = new THREE.Object3D()
    proxyA.userData.pokemonId = 'alpha'
    const proxyB = new THREE.Object3D()
    proxyB.userData.pokemonId = 'beta'
    const intersectionEntryLengths: number[] = []
    const intersectObjects = vi.fn((targets: THREE.Object3D[], _recursive: boolean, optionalTarget?: THREE.Intersection[]) => {
      expect(optionalTarget).toBe(scratch.intersections)
      intersectionEntryLengths.push(optionalTarget?.length ?? -1)
      optionalTarget?.push({ distance: 0, object: targets[0], point: new THREE.Vector3() } as THREE.Intersection)
      return optionalTarget ?? []
    })
    const raycaster = {
      setFromCamera: vi.fn(),
      intersectObjects,
      ray: { intersectPlane: vi.fn(() => null) },
    } as unknown as THREE.Raycaster

    expect(pickPokemonIdFromPointer({
      event,
      renderer: makeRenderer().renderer,
      camera,
      raycaster,
      renderObjects: [{ proxy: proxyA } as never],
      scratch,
    })).toBe('alpha')
    expect(intersectObjects.mock.calls[0]?.[0]).toBe(scratch.pokemonProxyTargets)
    expect(scratch.pokemonProxyTargets).toEqual([proxyA])

    expect(pickPokemonIdFromPointer({
      event,
      renderer: makeRenderer().renderer,
      camera,
      raycaster,
      renderObjects: [{ proxy: proxyB } as never],
      scratch,
    })).toBe('beta')
    expect(intersectObjects.mock.calls[1]?.[0]).toBe(scratch.pokemonProxyTargets)
    expect(scratch.pokemonProxyTargets).toEqual([proxyB])
    expect(intersectionEntryLengths).toEqual([0, 0])
  })

  it('reuses build and hazard target arrays without retaining stale intersections', () => {
    const scratch = createPointerRaycastScratch()
    const floorPlane = new THREE.Object3D()
    const voxelMesh = new THREE.Object3D()
    const hazardMesh = new THREE.Object3D()
    hazardMesh.userData.hazard = { x: 3, y: 1, z: 2, kind: 'spikes' }
    const intersectionEntryLengths: number[] = []
    const intersectObjects = vi.fn((targets: THREE.Object3D[], _recursive: boolean, optionalTarget?: THREE.Intersection[]) => {
      expect(optionalTarget).toBe(scratch.intersections)
      intersectionEntryLengths.push(optionalTarget?.length ?? -1)
      optionalTarget?.push(targets === scratch.buildTargets
        ? { distance: 0, object: floorPlane, point: { x: 1.2, y: 0, z: 2.8 } } as THREE.Intersection
        : { distance: 0, object: hazardMesh, point: new THREE.Vector3() } as THREE.Intersection)
      return optionalTarget ?? []
    })
    const raycaster = {
      setFromCamera: vi.fn(),
      intersectObjects,
      ray: { intersectPlane: vi.fn(() => null) },
    } as unknown as THREE.Raycaster

    expect(pickBuildTargetFromPointer({
      event,
      tool: 'pencil',
      renderer: makeRenderer().renderer,
      camera,
      raycaster,
      floorPlane,
      voxelMeshes: [voxelMesh],
      dimensions: { x: 4, y: 4, z: 4 },
      pokemons: [],
      allVoxelOccupancy: new Set(),
      mapMovementOccupancy: new Set(),
      scratch,
    })).toEqual({ action: 'place', cell: { x: 1, y: 0, z: 2 }, valid: true })
    expect(intersectObjects.mock.calls[0]?.[0]).toBe(scratch.buildTargets)
    expect(scratch.buildTargets).toEqual([floorPlane, voxelMesh])

    expect(pickHazardTargetFromPointer({
      event,
      tool: 'pencil',
      renderer: makeRenderer().renderer,
      camera,
      raycaster,
      hazardMeshes: [hazardMesh],
      voxelMeshes: [voxelMesh],
      hazards: [],
      dimensions: { x: 4, y: 4, z: 4 },
      groundLevelY: 0,
      scratch,
    })).toEqual({ action: 'place', cell: { x: 3, y: 1, z: 2 }, valid: true })
    expect(intersectObjects.mock.calls[1]?.[0]).toBe(scratch.hazardTargets)
    expect(scratch.hazardTargets).toEqual([hazardMesh, voxelMesh])
    expect(intersectionEntryLengths).toEqual([0, 0])
  })

  it('uses cached build and hazard target lists without rebuilding scratch target arrays', () => {
    const scratch = createPointerRaycastScratch()
    const cache = createBuildHazardPickTargetCache()
    const floorPlane = new THREE.Object3D()
    const voxelMesh = new THREE.Object3D()
    const hazardMesh = new THREE.Object3D()
    hazardMesh.userData.hazard = { x: 3, y: 1, z: 2, kind: 'spikes' }
    cache.setFloorPlane(floorPlane)
    cache.setVoxelMeshes([voxelMesh])
    cache.setHazardMeshes([hazardMesh])

    const intersectObjects = vi.fn((targets: THREE.Object3D[], _recursive: boolean, optionalTarget?: THREE.Intersection[]) => {
      expect(optionalTarget).toBe(scratch.intersections)
      optionalTarget?.push(targets === cache.buildTargets()
        ? { distance: 0, object: floorPlane, point: { x: 1.2, y: 0, z: 2.8 } } as THREE.Intersection
        : { distance: 0, object: hazardMesh, point: new THREE.Vector3() } as THREE.Intersection)
      return optionalTarget ?? []
    })
    const raycaster = {
      setFromCamera: vi.fn(),
      intersectObjects,
      ray: { intersectPlane: vi.fn(() => null) },
    } as unknown as THREE.Raycaster

    expect(pickBuildTargetFromPointer({
      event,
      tool: 'pencil',
      renderer: makeRenderer().renderer,
      camera,
      raycaster,
      pickTargetCache: cache,
      dimensions: { x: 4, y: 4, z: 4 },
      pokemons: [],
      allVoxelOccupancy: new Set(),
      mapMovementOccupancy: new Set(),
      scratch,
    })).toEqual({ action: 'place', cell: { x: 1, y: 0, z: 2 }, valid: true })
    expect(intersectObjects.mock.calls[0]?.[0]).toBe(cache.buildTargets())
    expect(scratch.buildTargets).toEqual([])

    expect(pickHazardTargetFromPointer({
      event,
      tool: 'pencil',
      renderer: makeRenderer().renderer,
      camera,
      raycaster,
      pickTargetCache: cache,
      hazards: [],
      dimensions: { x: 4, y: 4, z: 4 },
      groundLevelY: 0,
      scratch,
    })).toEqual({ action: 'place', cell: { x: 3, y: 1, z: 2 }, valid: true })
    expect(intersectObjects.mock.calls[1]?.[0]).toBe(cache.hazardTargets())
    expect(scratch.hazardTargets).toEqual([])
  })

  it('reuses ground-plane scratch objects for movement-grid intersections', () => {
    const scratch = createPointerRaycastScratch()
    const intersectPlane = vi.fn((_plane: THREE.Plane, target: THREE.Vector3) => {
      target.set(2.25, 3, 4.75)
      return target
    })
    const raycaster = {
      setFromCamera: vi.fn(),
      intersectObjects: vi.fn(() => []),
      ray: { intersectPlane },
    } as unknown as THREE.Raycaster

    const result = getMoveGridIntersectionFromPointer({
      event,
      yLevel: 3,
      renderer: makeRenderer().renderer,
      camera,
      raycaster,
      scratch,
    })

    expect(result).toBe(scratch.groundPoint)
    expect(result).toEqual(expect.objectContaining({ x: 2.25, y: 3, z: 4.75 }))
    expect(intersectPlane).toHaveBeenCalledWith(scratch.groundPlane, scratch.groundPoint)
    expect(scratch.groundPlane.normal.toArray()).toEqual([0, 1, 0])
    expect(scratch.groundPlane.constant).toBe(-3)
  })
})
