import { describe, expect, it, vi } from 'vitest'
import { createIsometricPointerInteractionController } from '~/utils/isometric/pointerInteraction'
import type { BuildTool } from '#shared/mapEditor'

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

const createAnimationFrameDriver = () => {
  let nextFrameHandle = 1
  const callbacks = new Map<number, (timestampMs: number) => void>()
  const requestAnimationFrame = vi.fn((callback: (timestampMs: number) => void) => {
    const frameHandle = nextFrameHandle
    nextFrameHandle += 1
    callbacks.set(frameHandle, callback)

    return frameHandle
  })
  const cancelAnimationFrame = vi.fn((frameHandle: number) => {
    callbacks.delete(frameHandle)
  })
  const flushNextFrame = (timestampMs = 0) => {
    const [nextEntry] = callbacks.entries()
    if (!nextEntry) return false

    const [frameHandle, callback] = nextEntry
    callbacks.delete(frameHandle)
    callback(timestampMs)

    return true
  }

  return {
    requestAnimationFrame,
    cancelAnimationFrame,
    flushNextFrame,
    pendingFrameCount: () => callbacks.size,
  }
}

const makeController = () => {
  let selectedId: string | null = null
  let selectedPokemon: { id: string } | null = null
  let buildMode = false
  let hazardMode = false
  let targetingMode = false
  let buildTool: BuildTool = 'pencil'
  let hazardTool: BuildTool | undefined = undefined
  let hitId: string | null = 'token-1'
  let groundItemHitId: string | null = null
  let isClick = true
  const controllableIds = new Set<string>(['token-1'])
  const pointerMoveFrames = createAnimationFrameDriver()

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
    pickGroundItemId: vi.fn(() => groundItemHitId),
    selectGroundItem: vi.fn(),
    closeContextMenu: vi.fn(),
    openContextMenu: vi.fn(),
    updateHoverFromPointer: vi.fn(),
    clearHoveredPokemon: vi.fn(),
    updateBuildPreviewFromPointer: vi.fn(),
    updateHazardPreviewFromPointer: vi.fn(),
    updateMovePreviewFromPointer: vi.fn(),
    getTargetingModeActive: () => targetingMode,
    updateTargetingFromPointer: vi.fn(),
    performTargeting: vi.fn(),
    cancelTargeting: vi.fn(),
    performSelectedMove: vi.fn(),
    stepPreviewElevation: vi.fn(),
    performBuildAction: vi.fn(),
    performHazardAction: vi.fn(),
    hideBuildGhost: vi.fn(),
    hideHazardGhost: vi.fn(),
    closeTopmostOverlay: vi.fn(() => false),
    onPointerMoveFrame: vi.fn(),
    pointerMoveRequestAnimationFrame: pointerMoveFrames.requestAnimationFrame,
    pointerMoveCancelAnimationFrame: pointerMoveFrames.cancelAnimationFrame,
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
    setGroundItemHitId: (id: string | null) => { groundItemHitId = id },
    setBuildMode: (active: boolean) => { buildMode = active },
    setHazardMode: (active: boolean) => { hazardMode = active },
    setTargetingMode: (active: boolean) => { targetingMode = active },
    setBuildTool: (tool: BuildTool) => { buildTool = tool },
    setHazardTool: (tool: BuildTool | undefined) => { hazardTool = tool },
    setClick: (next: boolean) => { isClick = next },
    controllableIds,
    flushPointerMoveFrame: pointerMoveFrames.flushNextFrame,
    pendingPointerMoveFrameCount: pointerMoveFrames.pendingFrameCount,
    pointerMoveFrames,
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

  it('selects a rendered ground item only when no controllable token is selected', () => {
    const {
      controller,
      deps,
      setGroundItemHitId,
      setHitId,
      setSelected,
    } = makeController()
    setHitId(null)
    setGroundItemHitId('ground-item-iron-ball-1')

    controller.handlePointerUp(pointerEvent())
    expect(deps.selectGroundItem).toHaveBeenCalledWith('ground-item-iron-ball-1')
    expect(deps.selectPokemon).not.toHaveBeenCalled()

    vi.clearAllMocks()
    setHitId('token-1')
    controller.handlePointerUp(pointerEvent())
    expect(deps.selectGroundItem).toHaveBeenCalledWith(null)
    expect(deps.selectPokemon).toHaveBeenCalledWith('token-1')
    expect(deps.pickGroundItemId).not.toHaveBeenCalled()

    vi.clearAllMocks()
    setSelected('token-1')
    controller.handlePointerUp(pointerEvent())
    expect(deps.performSelectedMove).toHaveBeenCalledOnce()
    expect(deps.selectGroundItem).not.toHaveBeenCalled()
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

  it('records pointer coordinates immediately while coalescing pointer move preview work by active mode', () => {
    const {
      controller,
      deps,
      flushPointerMoveFrame,
      pendingPointerMoveFrameCount,
      setBuildMode,
      setHazardMode,
      setSelected,
    } = makeController()

    setBuildMode(true)
    controller.handlePointerMove(pointerEvent({ clientX: 30, clientY: 40 }))
    controller.handlePointerMove(pointerEvent({ clientX: 31, clientY: 41 }))

    expect(controller.lastPointerCoords()).toEqual({ clientX: 31, clientY: 41 })
    expect(deps.pointerTracker.move).toHaveBeenCalledTimes(2)
    expect(deps.updateBuildPreviewFromPointer).not.toHaveBeenCalled()
    expect(pendingPointerMoveFrameCount()).toBe(1)

    expect(flushPointerMoveFrame(16)).toBe(true)

    expect(deps.updateHoverFromPointer).toHaveBeenCalledTimes(1)
    expect(deps.updateBuildPreviewFromPointer).toHaveBeenCalledOnce()
    expect(deps.updateBuildPreviewFromPointer).toHaveBeenCalledWith(expect.objectContaining({
      clientX: 31,
      clientY: 41,
    }))
    expect(deps.onPointerMoveFrame).toHaveBeenCalledWith(expect.objectContaining({
      timestampMs: 16,
      coalescedEventCount: 2,
      event: expect.objectContaining({ clientX: 31, clientY: 41 }),
    }))

    setBuildMode(false)
    setHazardMode(true)
    controller.handlePointerMove(pointerEvent({ clientX: 50 }))
    expect(flushPointerMoveFrame(32)).toBe(true)
    expect(deps.updateHazardPreviewFromPointer).toHaveBeenCalledOnce()

    setHazardMode(false)
    setSelected('token-1')
    controller.handlePointerMove(pointerEvent({ clientX: 60 }))
    expect(flushPointerMoveFrame(48)).toBe(true)
    expect(deps.updateMovePreviewFromPointer).toHaveBeenCalledOnce()
  })

  it('flushes the latest coalesced pointer move before committing selected-token movement', () => {
    const { controller, deps, setSelected } = makeController()
    const calls: string[] = []
    deps.updateMovePreviewFromPointer.mockImplementation(() => { calls.push('preview') })
    deps.performSelectedMove.mockImplementation(() => { calls.push('move') })

    setSelected('token-1')
    controller.handlePointerMove(pointerEvent({ clientX: 80, clientY: 90 }))
    expect(deps.updateMovePreviewFromPointer).not.toHaveBeenCalled()

    controller.handlePointerUp(pointerEvent({ clientX: 80, clientY: 90 }))

    expect(calls).toEqual(['preview', 'move'])
    expect(deps.updateMovePreviewFromPointer).toHaveBeenCalledWith(expect.objectContaining({
      clientX: 80,
      clientY: 90,
    }))
  })

  it('disposes pending coalesced pointer move work for unmount cleanup', () => {
    const { controller, deps, flushPointerMoveFrame, pendingPointerMoveFrameCount, setBuildMode } = makeController()

    setBuildMode(true)
    controller.handlePointerMove(pointerEvent({ clientX: 12 }))
    expect(pendingPointerMoveFrameCount()).toBe(1)

    controller.dispose()

    expect(pendingPointerMoveFrameCount()).toBe(0)
    expect(flushPointerMoveFrame(16)).toBe(false)
    expect(deps.updateBuildPreviewFromPointer).not.toHaveBeenCalled()

    controller.handlePointerMove(pointerEvent({ clientX: 13 }))
    expect(pendingPointerMoveFrameCount()).toBe(0)
    expect(deps.updateBuildPreviewFromPointer).not.toHaveBeenCalled()
  })

  it('routes targeting pointer moves, confirmations, and cancellation', () => {
    const { controller, deps, flushPointerMoveFrame, setTargetingMode } = makeController()

    setTargetingMode(true)
    const moveEvent = pointerEvent({ clientX: 60, clientY: 70 })
    controller.handlePointerMove(moveEvent)
    expect(deps.updateTargetingFromPointer).not.toHaveBeenCalled()

    expect(flushPointerMoveFrame(16)).toBe(true)
    expect(deps.updateTargetingFromPointer).toHaveBeenCalledWith(expect.objectContaining({
      clientX: 60,
      clientY: 70,
    }))

    controller.handlePointerUp(pointerEvent())
    expect(deps.performTargeting).toHaveBeenCalledTimes(1)

    const rightClick = mouseEvent()
    controller.handleRightClick(rightClick)
    expect(deps.cancelTargeting).toHaveBeenCalledTimes(1)
  })

  it('handles wheel elevation, pointer leave cleanup, and escape priority', () => {
    const { controller, deps, pendingPointerMoveFrameCount, setSelected, setBuildMode, setHazardMode } = makeController()
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
    expect(pendingPointerMoveFrameCount()).toBe(1)
    controller.handlePointerLeave()
    expect(pendingPointerMoveFrameCount()).toBe(0)
    expect(controller.lastPointerCoords()).toBeNull()
    expect(deps.clearHoveredPokemon).toHaveBeenCalled()
    expect(deps.hideBuildGhost).toHaveBeenCalled()
    expect(deps.hideHazardGhost).toHaveBeenCalled()

    deps.closeTopmostOverlay.mockReturnValueOnce(true)
    controller.handleEscape({ key: 'Escape' } as KeyboardEvent)
    expect(deps.selectPokemon).not.toHaveBeenCalledWith(null)

    controller.handleEscape({ key: 'Escape' } as KeyboardEvent)
    expect(deps.selectGroundItem).toHaveBeenCalledWith(null)
    expect(deps.selectPokemon).toHaveBeenCalledWith(null)
  })
})
