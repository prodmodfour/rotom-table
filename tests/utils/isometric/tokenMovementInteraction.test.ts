import { describe, expect, it, vi } from 'vitest'
import {
  createIsometricTokenMovementInteractionController,
  type TokenMovementPreviewRenderer,
} from '~/utils/isometric/tokenMovementInteraction'
import type { MapVoxelV2 } from '~/types/map'
import type { GridDimensions, SpawnedPokemon } from '~/types/pokemon'

const makePokemon = (overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  species: 'Bulbasaur',
  slug: 'bulbasaur',
  spriteUrl: '/bulbasaur.png',
  entityKind: 'pokemon',
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  id: 'token-a',
  position: { x: 0, y: 0, z: 0 },
  sheetKind: 'pokemon',
  sheetSlug: 'bulbasaur',
  level: 5,
  currentHp: 20,
  maxHp: 20,
  atk: 5,
  satk: 5,
  def: 5,
  sdef: 5,
  defenderTypes: [],
  movementCapabilities: { overland: 6 },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  conditions: [],
  tokenItems: [],
  ...overrides,
})

const pointer = { clientX: 20, clientY: 30 } as PointerEvent

const makeController = () => {
  const selected = makePokemon()
  const dimensions: GridDimensions = { x: 5, y: 3, z: 5 }
  const pokemons = [selected]
  const voxels: MapVoxelV2[] = []
  const renderer = {
    ensure: vi.fn(),
    update: vi.fn(() => true),
    clear: vi.fn(),
    disposeOwner: vi.fn(),
  }
  const emitPreviewChange = vi.fn()
  const movePokemon = vi.fn()
  const recordPathfindingRequest = vi.fn()
  const getMoveGridIntersection = vi.fn(() => ({ x: 2.5, z: 2.5 }))
  const selectedState = { value: selected as SpawnedPokemon | null }
  const previewLayerY = { value: 0 }
  const terrainRevision = { value: 'terrain-revision-a' as string | number | null }
  const placementRevision = { value: 'placement-revision-a' as string | number | null }
  const getSelectedPokemon = vi.fn(() => selectedState.value)
  const getPokemons = vi.fn(() => pokemons)
  const getDimensions = vi.fn(() => dimensions)
  const getMapVoxels = vi.fn(() => voxels)
  const getMapVoxelsRevision = vi.fn(() => terrainRevision.value)
  const getPokemonPlacementRevision = vi.fn(() => placementRevision.value)

  const controller = createIsometricTokenMovementInteractionController({
    getSelectedPokemon,
    getPokemons,
    getDimensions,
    getMapVoxels,
    getMapVoxelsRevision,
    getPokemonPlacementRevision,
    getPreviewLayerY: () => previewLayerY.value,
    getGroundLevelY: () => 0,
    getCamera: () => null,
    getMoveGridIntersection,
    previewRenderer: renderer,
    emitPreviewChange,
    movePokemon,
    recordPathfindingRequest,
  })

  return {
    controller,
    selected,
    selectedState,
    previewLayerY,
    dimensions,
    pokemons,
    voxels,
    terrainRevision,
    placementRevision,
    renderer,
    emitPreviewChange,
    movePokemon,
    recordPathfindingRequest,
    getMoveGridIntersection,
    getSelectedPokemon,
    getPokemons,
    getDimensions,
    getMapVoxels,
    getMapVoxelsRevision,
    getPokemonPlacementRevision,
  }
}

describe('isometric token movement interaction', () => {
  it('updates movement previews from pointer intersections and emits preview state', () => {
    const {
      controller,
      selected,
      renderer,
      emitPreviewChange,
      getMoveGridIntersection,
      getMapVoxelsRevision,
      recordPathfindingRequest,
    } = makeController()

    controller.updatePreviewFromPointer(pointer)

    expect(getMoveGridIntersection).toHaveBeenCalledWith(pointer, 0)
    expect(recordPathfindingRequest).toHaveBeenCalledOnce()
    expect(getMapVoxelsRevision).toHaveBeenCalledOnce()
    expect(renderer.ensure).toHaveBeenCalledWith(selected)
    expect(renderer.update).toHaveBeenCalledWith(expect.objectContaining({
      pokemon: selected,
      anchor: { x: 2, y: 0, z: 2 },
      canForcePlace: true,
      reachable: true,
      groundLevelY: 0,
      camera: null,
    }))
    expect(controller.preview()).toMatchObject({
      position: { x: 2, y: 0, z: 2 },
      reachable: true,
      pathLength: 3,
      movementLimit: 6,
      movementCapabilityLabel: 'Overland',
    })
    expect(emitPreviewChange).toHaveBeenLastCalledWith(controller.preview())
  })

  it('skips renderer and pathfinding work while the selected token and preview anchor are unchanged', () => {
    const {
      controller,
      renderer,
      emitPreviewChange,
      getMapVoxels,
      getMapVoxelsRevision,
      recordPathfindingRequest,
    } = makeController()

    controller.updatePreviewAtAnchor({ x: 2, y: 0, z: 2 })
    renderer.ensure.mockClear()
    renderer.update.mockClear()
    emitPreviewChange.mockClear()
    getMapVoxels.mockClear()
    getMapVoxelsRevision.mockClear()
    recordPathfindingRequest.mockClear()

    controller.updatePreviewAtAnchor({ x: 2, y: 0, z: 2 })

    expect(renderer.ensure).not.toHaveBeenCalled()
    expect(renderer.update).not.toHaveBeenCalled()
    expect(getMapVoxels).not.toHaveBeenCalled()
    expect(getMapVoxelsRevision).not.toHaveBeenCalled()
    expect(recordPathfindingRequest).not.toHaveBeenCalled()
    expect(emitPreviewChange).not.toHaveBeenCalled()
  })

  it('reuses cached pathfinding results when returning to a previous preview anchor', () => {
    const { controller, renderer, getMapVoxels, recordPathfindingRequest } = makeController()

    controller.updatePreviewAtAnchor({ x: 2, y: 0, z: 2 })
    controller.updatePreviewAtAnchor({ x: 1, y: 0, z: 1 })
    getMapVoxels.mockClear()
    recordPathfindingRequest.mockClear()
    renderer.update.mockClear()

    controller.updatePreviewAtAnchor({ x: 2, y: 0, z: 2 })

    expect(renderer.update).toHaveBeenCalledOnce()
    expect(renderer.update).toHaveBeenLastCalledWith(expect.objectContaining({
      anchor: { x: 2, y: 0, z: 2 },
      reachable: true,
    }))
    expect(getMapVoxels).not.toHaveBeenCalled()
    expect(recordPathfindingRequest).not.toHaveBeenCalled()
  })

  it('misses the movement path cache after placement revision changes', () => {
    const { controller, placementRevision, getMapVoxels, recordPathfindingRequest } = makeController()

    controller.updatePreviewAtAnchor({ x: 2, y: 0, z: 2 })
    controller.updatePreviewAtAnchor({ x: 1, y: 0, z: 1 })
    placementRevision.value = 'placement-revision-b'
    getMapVoxels.mockClear()
    recordPathfindingRequest.mockClear()

    controller.updatePreviewAtAnchor({ x: 2, y: 0, z: 2 })

    expect(getMapVoxels).toHaveBeenCalledOnce()
    expect(recordPathfindingRequest).toHaveBeenCalledOnce()
  })

  it('misses the movement path cache after terrain revision changes', () => {
    const { controller, terrainRevision, getMapVoxels, recordPathfindingRequest } = makeController()

    controller.updatePreviewAtAnchor({ x: 2, y: 0, z: 2 })
    controller.updatePreviewAtAnchor({ x: 1, y: 0, z: 1 })
    terrainRevision.value = 'terrain-revision-b'
    getMapVoxels.mockClear()
    recordPathfindingRequest.mockClear()

    controller.updatePreviewAtAnchor({ x: 2, y: 0, z: 2 })

    expect(getMapVoxels).toHaveBeenCalledOnce()
    expect(recordPathfindingRequest).toHaveBeenCalledOnce()
  })

  it('does not reuse cached paths when terrain revision is unavailable', () => {
    const { controller, terrainRevision, getMapVoxels, recordPathfindingRequest } = makeController()
    terrainRevision.value = null

    controller.updatePreviewAtAnchor({ x: 2, y: 0, z: 2 })
    controller.updatePreviewAtAnchor({ x: 1, y: 0, z: 1 })
    getMapVoxels.mockClear()
    recordPathfindingRequest.mockClear()

    controller.updatePreviewAtAnchor({ x: 2, y: 0, z: 2 })

    expect(getMapVoxels).toHaveBeenCalledOnce()
    expect(recordPathfindingRequest).toHaveBeenCalledOnce()
  })

  it('recomputes cached preview paths when selected token movement capabilities change', () => {
    const { controller, selected, getMapVoxels, recordPathfindingRequest } = makeController()

    controller.updatePreviewAtAnchor({ x: 2, y: 0, z: 2 })
    selected.movementCapabilities = { overland: 2 }
    getMapVoxels.mockClear()
    recordPathfindingRequest.mockClear()

    controller.refreshAfterStateChange()

    expect(getMapVoxels).toHaveBeenCalledOnce()
    expect(recordPathfindingRequest).toHaveBeenCalledOnce()
    expect(controller.preview()).toMatchObject({
      position: { x: 2, y: 0, z: 2 },
      reachable: false,
      pathLength: 3,
      movementLimit: 2,
      movementCapabilityLabel: 'Overland',
    })
    expect(controller.canPlacePreview()).toBe(false)
  })

  it('protects cached movement paths from renderer mutation between preview anchors', () => {
    const { controller, renderer, getMapVoxels, recordPathfindingRequest } = makeController()

    controller.updatePreviewAtAnchor({ x: 2, y: 0, z: 2 })
    const firstUpdateCalls = renderer.update.mock.calls as unknown as Array<
      Parameters<TokenMovementPreviewRenderer['update']>
    >
    const firstPath = firstUpdateCalls[0]?.[0].path
    expect(firstPath).toHaveLength(3)
    firstPath?.push({ x: 9, y: 9, z: 9 })

    controller.updatePreviewAtAnchor({ x: 1, y: 0, z: 1 })
    getMapVoxels.mockClear()
    recordPathfindingRequest.mockClear()
    renderer.update.mockClear()

    controller.updatePreviewAtAnchor({ x: 2, y: 0, z: 2 })

    const cachedUpdateCalls = renderer.update.mock.calls as unknown as Array<
      Parameters<TokenMovementPreviewRenderer['update']>
    >
    const path = cachedUpdateCalls[0]?.[0].path
    expect(getMapVoxels).not.toHaveBeenCalled()
    expect(recordPathfindingRequest).not.toHaveBeenCalled()
    expect(path).toHaveLength(3)
    expect(path?.some((anchor) => anchor.x === 9 && anchor.y === 9 && anchor.z === 9)).toBe(false)
    expect(path?.[path.length - 1]).toEqual({ x: 2, y: 0, z: 2 })
  })

  it('refreshes the same movement preview anchor when selected token changes and reuses cached paths for unchanged state', () => {
    const { controller, selectedState, renderer, getMapVoxels } = makeController()

    controller.updatePreviewAtAnchor({ x: 2, y: 0, z: 2 })
    renderer.update.mockClear()
    getMapVoxels.mockClear()

    selectedState.value = makePokemon({ id: 'token-b' })
    controller.updatePreviewAtAnchor({ x: 2, y: 0, z: 2 })

    expect(renderer.update).toHaveBeenCalledOnce()
    expect(renderer.update).toHaveBeenLastCalledWith(expect.objectContaining({
      pokemon: selectedState.value,
      anchor: { x: 2, y: 0, z: 2 },
    }))
    expect(getMapVoxels).toHaveBeenCalledOnce()

    renderer.update.mockClear()
    getMapVoxels.mockClear()
    controller.refreshAfterStateChange()

    expect(renderer.update).toHaveBeenCalledOnce()
    expect(renderer.update).toHaveBeenLastCalledWith(expect.objectContaining({
      pokemon: selectedState.value,
      anchor: { x: 2, y: 0, z: 2 },
    }))
    expect(getMapVoxels).not.toHaveBeenCalled()
  })

  it('resets the movement preview anchor cache when visuals are cleared', () => {
    const { controller, renderer } = makeController()

    controller.updatePreviewAtAnchor({ x: 2, y: 0, z: 2 })
    controller.clearPreviewVisuals()
    renderer.update.mockClear()

    controller.updatePreviewAtAnchor({ x: 2, y: 0, z: 2 })

    expect(renderer.update).toHaveBeenCalledOnce()
  })

  it('clears visuals when there is no selected token or the renderer rejects an update', () => {
    const { controller, selectedState, renderer, emitPreviewChange } = makeController()
    selectedState.value = null

    controller.updatePreviewFromPointer(pointer)

    expect(renderer.clear).toHaveBeenCalledOnce()
    expect(emitPreviewChange).toHaveBeenCalledWith({ position: null, reachable: false, pathLength: 0 })

    selectedState.value = makePokemon()
    renderer.update.mockReturnValue(false)
    controller.updatePreviewAtAnchor({ x: 1, y: 0, z: 1 })

    expect(renderer.clear).toHaveBeenCalledTimes(2)
    expect(controller.preview()).toEqual({ position: null, reachable: false, pathLength: 0 })
  })

  it('tracks blocked previews and suppresses movement commits', () => {
    const { controller, pokemons, movePokemon } = makeController()
    pokemons.push(makePokemon({ id: 'blocker', position: { x: 2, y: 0, z: 2 } }))

    controller.updatePreviewAtAnchor({ x: 2, y: 0, z: 2 })

    expect(controller.canPlacePreview()).toBe(false)
    expect(controller.preview()).toEqual({
      position: { x: 2, y: 0, z: 2 },
      reachable: false,
      pathLength: 0,
    })
    expect(controller.performSelectedMove()).toBe(false)
    expect(movePokemon).not.toHaveBeenCalled()
  })

  it('commits a selected move only when the active preview is placeable and within capability', () => {
    const { controller, movePokemon } = makeController()

    expect(controller.performSelectedMove()).toBe(false)

    controller.updatePreviewAtAnchor({ x: 1, y: 0, z: 1 })

    expect(controller.performSelectedMove()).toBe(true)
    expect(movePokemon).toHaveBeenCalledWith({ id: 'token-a', position: { x: 1, y: 0, z: 1 } })
  })

  it('rejects movement previews that exceed the active movement capability', () => {
    const { controller, selected, movePokemon } = makeController()
    selected.movementCapabilities = { overland: 2 }

    controller.updatePreviewAtAnchor({ x: 2, y: 0, z: 2 })

    expect(controller.preview()).toMatchObject({
      position: { x: 2, y: 0, z: 2 },
      reachable: false,
      pathLength: 3,
      movementLimit: 2,
      movementCapabilityLabel: 'Overland',
    })
    expect(controller.canPlacePreview()).toBe(false)
    expect(controller.performSelectedMove()).toBe(false)
    expect(movePokemon).not.toHaveBeenCalled()
  })

  it('steps preview elevation within map bounds for aerial movement', () => {
    const { controller, renderer, selected } = makeController()
    selected.movementCapabilities = { overland: 6, sky: 6 }

    expect(controller.stepPreviewElevation(-1)).toBe(true)
    expect(renderer.update).toHaveBeenLastCalledWith(expect.objectContaining({
      anchor: { x: 0, y: 1, z: 0 },
    }))

    expect(controller.stepPreviewElevation(1)).toBe(true)
    expect(renderer.update).toHaveBeenLastCalledWith(expect.objectContaining({
      anchor: { x: 0, y: 0, z: 0 },
    }))

    expect(controller.stepPreviewElevation(1)).toBe(false)
  })

  it('refreshes and resets preview state around selected-token changes', () => {
    const { controller, renderer, emitPreviewChange } = makeController()
    controller.updatePreviewAtAnchor({ x: 1, y: 0, z: 1 })
    renderer.update.mockClear()

    controller.refreshAfterStateChange()
    expect(renderer.update).toHaveBeenCalledWith(expect.objectContaining({
      anchor: { x: 1, y: 0, z: 1 },
    }))

    controller.resetForSelectionChange()
    expect(controller.activeAnchor()).toBeNull()
    expect(emitPreviewChange).toHaveBeenLastCalledWith({ position: null, reachable: false, pathLength: 0 })
  })
})
