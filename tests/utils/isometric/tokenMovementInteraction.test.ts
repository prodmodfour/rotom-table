import { describe, expect, it, vi } from 'vitest'
import { createIsometricTokenMovementInteractionController } from '~/utils/isometric/tokenMovementInteraction'
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
  const occupancy = new Set<string>()
  const renderer = {
    ensure: vi.fn(),
    update: vi.fn(() => true),
    clear: vi.fn(),
    disposeOwner: vi.fn(),
  }
  const emitPreviewChange = vi.fn()
  const movePokemon = vi.fn()
  const getMoveGridIntersection = vi.fn(() => ({ x: 2.5, z: 2.5 }))
  const selectedState = { value: selected as SpawnedPokemon | null }
  const previewLayerY = { value: 0 }

  const controller = createIsometricTokenMovementInteractionController({
    getSelectedPokemon: () => selectedState.value,
    getPokemons: () => pokemons,
    getDimensions: () => dimensions,
    getMapMovementOccupancy: () => occupancy,
    getPreviewLayerY: () => previewLayerY.value,
    getGroundLevelY: () => 0,
    getCamera: () => null,
    getMoveGridIntersection,
    previewRenderer: renderer,
    emitPreviewChange,
    movePokemon,
  })

  return {
    controller,
    selected,
    selectedState,
    previewLayerY,
    dimensions,
    pokemons,
    occupancy,
    renderer,
    emitPreviewChange,
    movePokemon,
    getMoveGridIntersection,
  }
}

describe('isometric token movement interaction', () => {
  it('updates movement previews from pointer intersections and emits preview state', () => {
    const { controller, selected, renderer, emitPreviewChange, getMoveGridIntersection } = makeController()

    controller.updatePreviewFromPointer(pointer)

    expect(getMoveGridIntersection).toHaveBeenCalledWith(pointer, 0)
    expect(renderer.ensure).toHaveBeenCalledWith(selected)
    expect(renderer.update).toHaveBeenCalledWith(expect.objectContaining({
      pokemon: selected,
      anchor: { x: 2, y: 0, z: 2 },
      canForcePlace: true,
      reachable: true,
      groundLevelY: 0,
      camera: null,
    }))
    expect(controller.preview()).toEqual({
      position: { x: 2, y: 0, z: 2 },
      reachable: true,
      pathLength: expect.any(Number),
    })
    expect(emitPreviewChange).toHaveBeenLastCalledWith(controller.preview())
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

  it('commits a selected move only when the active preview is placeable', () => {
    const { controller, movePokemon } = makeController()

    expect(controller.performSelectedMove()).toBe(false)

    controller.updatePreviewAtAnchor({ x: 1, y: 0, z: 1 })

    expect(controller.performSelectedMove()).toBe(true)
    expect(movePokemon).toHaveBeenCalledWith({ id: 'token-a', position: { x: 1, y: 0, z: 1 } })
  })

  it('steps preview elevation within map bounds', () => {
    const { controller, renderer } = makeController()

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
