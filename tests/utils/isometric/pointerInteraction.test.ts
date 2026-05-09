import { describe, expect, it, vi } from 'vitest'
import { createIsometricPointerInteractionController } from '~/utils/isometric/pointerInteraction'
import type { BuildTool } from '~/shared/mapEditor'

const pointerEvent = (overrides: Partial<PointerEvent> = {}) => ({
  button: 0,
  clientX: 10,
  clientY: 20,
  pointerType: 'mouse',
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  ...overrides,
} as unknown as PointerEvent)

const mouseEvent = (overrides: Partial<MouseEvent> = {}) => ({
  clientX: 10,
  clientY: 20,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  ...overrides,
} as unknown as MouseEvent)

const wheelEvent = (overrides: Partial<WheelEvent> = {}) => ({
  deltaY: 0,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  ...overrides,
} as unknown as WheelEvent)

const makeController = () => {
  let selectedId: string | null = null
  let selectedPokemon: { id: string } | null = null
  let buildMode = false
  let hazardMode = false
  let buildTool: BuildTool = 'pencil'
  let hazardTool: BuildTool | undefined = undefined
  let hitId: string | null = 'token-1'
  let isClick = true
  const controllableIds = new Set<string>(['token-1'])

  const deps = {
    pointerTracker: {
      start: vi.fn(),
      move: vi.fn(),
      isClick: vi.fn(() => isClick),
    },
    getSelectedId: () => selectedId,
    getSelectedPokemon: () => selectedPokemon,
    getBuildMode: () => buildMode,
    getBuildTool: () => buildTool,
    getHazardMode: () => hazardMode,
    getHazardTool: () => hazardTool,
    canControlPokemon: (id: string | null | undefined) => Boolean(id && controllableIds.has(id)),
    pickPokemonId: vi.fn(() => hitId),
    selectPokemon: vi.fn((id: string | null) => { selectedId = id }),
    closeContextMenu: vi.fn(),
    openContextMenu: vi.fn(),
    updateHoverFromPointer: vi.fn(),
    clearHoveredPokemon: vi.fn(),
    updateBuildPreviewFromPointer: vi.fn(),
    updateHazardPreviewFromPointer: vi.fn(),
    updateMovePreviewFromPointer: vi.fn(),
    performSelectedMove: vi.fn(),
    stepPreviewElevation: vi.fn(),
    performBuildAction: vi.fn(),
    performHazardAction: vi.fn(),
    hideBuildGhost: vi.fn(),
    hideHazardGhost: vi.fn(),
    closeTopmostOverlay: vi.fn(() => false),
  }

  const controller = createIsometricPointerInteractionController(deps)

  return {
    controller,
    deps,
    setSelected: (id: string | null) => {
      selectedId = id
      selectedPokemon = id ? { id } : null
    },
    setHitId: (id: string | null) => { hitId = id },
    setBuildMode: (active: boolean) => { buildMode = active },
    setHazardMode: (active: boolean) => { hazardMode = active },
    setBuildTool: (tool: BuildTool) => { buildTool = tool },
    setHazardTool: (tool: BuildTool | undefined) => { hazardTool = tool },
    setClick: (next: boolean) => { isClick = next },
    controllableIds,
  }
}

describe('isometric pointer interaction controller', () => {
  it('selects controllable tokens and commits selected-token movement on left click', () => {
    const { controller, deps, setSelected } = makeController()

    controller.handlePointerUp(pointerEvent())
    expect(deps.selectPokemon).toHaveBeenCalledWith('token-1')

    setSelected('token-1')
    controller.handlePointerUp(pointerEvent())
    expect(deps.performSelectedMove).toHaveBeenCalledTimes(1)
  })

  it('routes build and hazard clicks to their active tools', () => {
    const { controller, deps, setBuildMode, setHazardMode, setBuildTool, setHazardTool } = makeController()

    setBuildMode(true)
    setBuildTool('eraser')
    controller.handlePointerUp(pointerEvent())
    expect(deps.performBuildAction).toHaveBeenCalledWith(expect.anything(), 'eraser')

    setBuildMode(false)
    setHazardMode(true)
    setHazardTool(undefined)
    controller.handlePointerUp(pointerEvent())
    expect(deps.performHazardAction).toHaveBeenCalledWith(expect.anything(), 'pencil')
  })

  it('uses right-click erasers in edit modes and opens token menus otherwise', () => {
    const { controller, deps, setBuildMode, setHazardMode } = makeController()
    const buildEvent = mouseEvent()

    setBuildMode(true)
    controller.handleRightClick(buildEvent)
    expect(buildEvent.preventDefault).toHaveBeenCalled()
    expect(deps.performBuildAction).toHaveBeenCalledWith(buildEvent, 'eraser')

    setBuildMode(false)
    setHazardMode(true)
    const hazardEvent = mouseEvent()
    controller.handleRightClick(hazardEvent)
    expect(deps.performHazardAction).toHaveBeenCalledWith(hazardEvent, 'eraser')

    setHazardMode(false)
    const menuEvent = mouseEvent()
    controller.handleRightClick(menuEvent)
    expect(deps.openContextMenu).toHaveBeenCalledWith(menuEvent, 'token-1')
  })

  it('records pointer coordinates and routes pointer move previews by active mode', () => {
    const { controller, deps, setBuildMode, setHazardMode, setSelected } = makeController()

    setBuildMode(true)
    controller.handlePointerMove(pointerEvent({ clientX: 30, clientY: 40 }))
    expect(controller.lastPointerCoords()).toEqual({ clientX: 30, clientY: 40 })
    expect(deps.updateBuildPreviewFromPointer).toHaveBeenCalledTimes(1)

    setBuildMode(false)
    setHazardMode(true)
    controller.handlePointerMove(pointerEvent())
    expect(deps.updateHazardPreviewFromPointer).toHaveBeenCalledTimes(1)

    setHazardMode(false)
    setSelected('token-1')
    controller.handlePointerMove(pointerEvent())
    expect(deps.updateMovePreviewFromPointer).toHaveBeenCalledTimes(1)
  })

  it('handles wheel elevation, pointer leave cleanup, and escape priority', () => {
    const { controller, deps, setSelected, setBuildMode, setHazardMode } = makeController()
    const wheel = wheelEvent({ deltaY: 100 })

    controller.handleWheel(wheel)
    expect(deps.stepPreviewElevation).not.toHaveBeenCalled()

    setSelected('token-1')
    controller.handleWheel(wheel)
    expect(wheel.preventDefault).toHaveBeenCalled()
    expect(wheel.stopPropagation).toHaveBeenCalled()
    expect(deps.stepPreviewElevation).toHaveBeenCalledWith(100)

    setBuildMode(true)
    setHazardMode(true)
    controller.handlePointerMove(pointerEvent({ clientX: 4, clientY: 5 }))
    controller.handlePointerLeave()
    expect(controller.lastPointerCoords()).toBeNull()
    expect(deps.clearHoveredPokemon).toHaveBeenCalled()
    expect(deps.hideBuildGhost).toHaveBeenCalled()
    expect(deps.hideHazardGhost).toHaveBeenCalled()

    deps.closeTopmostOverlay.mockReturnValueOnce(true)
    controller.handleEscape({ key: 'Escape' } as KeyboardEvent)
    expect(deps.selectPokemon).not.toHaveBeenCalledWith(null)

    controller.handleEscape({ key: 'Escape' } as KeyboardEvent)
    expect(deps.selectPokemon).toHaveBeenCalledWith(null)
  })
})
