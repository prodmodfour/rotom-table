import type { BuildTool } from '#shared/mapEditor'
import type { SpawnedPokemon } from '~/types/pokemon'
import {
  createPointerEventCoalescer,
  type CoalescedPointerEventFrame,
  type PointerEventCoalescerCancelAnimationFrame,
  type PointerEventCoalescerRequestAnimationFrame,
} from '~/utils/isometric/pointerEventCoalescer'

export interface PointerTravelTrackerLike {
  start(event: PointerEvent): void
  move(event: PointerEvent): void
  isClick(): boolean
}

export interface IsometricPointerInteractionOptions {
  pointerTracker: PointerTravelTrackerLike
  getSelectedId: () => string | null | undefined
  getSelectedPokemon: () => Pick<SpawnedPokemon, 'id'> | null | undefined
  getBuildMode: () => boolean
  getBuildTool: () => BuildTool
  getHazardMode: () => boolean | undefined
  getHazardTool: () => BuildTool | undefined
  canControlPokemon: (id: string | null | undefined) => boolean
  pickPokemonId: (event: MouseEvent | PointerEvent) => string | null
  selectPokemon: (id: string | null) => void
  closeContextMenu: () => void
  openContextMenu: (event: MouseEvent, id: string) => void
  updateHoverFromPointer: (event: PointerEvent) => void
  clearHoveredPokemon: () => void
  updateBuildPreviewFromPointer: (event: PointerEvent) => void
  updateHazardPreviewFromPointer: (event: PointerEvent) => void
  updateMovePreviewFromPointer: (event: PointerEvent) => void
  performSelectedMove: () => void
  stepPreviewElevation: (deltaY: number) => void
  getPlacementModeActive?: () => boolean
  updatePlacementPreviewFromPointer?: (event: PointerEvent) => void
  performPlacement?: () => boolean | void
  stepPlacementElevation?: (deltaY: number) => boolean | void
  cancelPlacement?: () => boolean | void
  getTargetingModeActive?: () => boolean
  updateTargetingFromPointer?: (event: PointerEvent) => void
  performTargeting?: (event: MouseEvent | PointerEvent) => boolean | void
  cancelTargeting?: () => boolean | void
  performBuildAction: (event: MouseEvent | PointerEvent, tool: BuildTool) => void
  performHazardAction: (event: MouseEvent | PointerEvent, tool: BuildTool) => void
  hideBuildGhost: () => void
  hideHazardGhost: () => void
  closeTopmostOverlay: () => boolean
  onPointerMoveFrame?: (frame: CoalescedPointerEventFrame) => void
  pointerMoveRequestAnimationFrame?: PointerEventCoalescerRequestAnimationFrame
  pointerMoveCancelAnimationFrame?: PointerEventCoalescerCancelAnimationFrame
}

export interface PointerCoords {
  clientX: number
  clientY: number
}

export const createIsometricPointerInteractionController = ({
  pointerTracker,
  getSelectedId,
  getSelectedPokemon,
  getBuildMode,
  getBuildTool,
  getHazardMode,
  getHazardTool,
  canControlPokemon,
  pickPokemonId,
  selectPokemon,
  closeContextMenu,
  openContextMenu,
  updateHoverFromPointer,
  clearHoveredPokemon,
  updateBuildPreviewFromPointer,
  updateHazardPreviewFromPointer,
  updateMovePreviewFromPointer,
  performSelectedMove,
  stepPreviewElevation,
  getPlacementModeActive = () => false,
  updatePlacementPreviewFromPointer = () => {},
  performPlacement = () => false,
  stepPlacementElevation = () => false,
  cancelPlacement = () => false,
  getTargetingModeActive = () => false,
  updateTargetingFromPointer = () => {},
  performTargeting = () => false,
  cancelTargeting = () => false,
  performBuildAction,
  performHazardAction,
  hideBuildGhost,
  hideHazardGhost,
  closeTopmostOverlay,
  onPointerMoveFrame = () => {},
  pointerMoveRequestAnimationFrame,
  pointerMoveCancelAnimationFrame,
}: IsometricPointerInteractionOptions) => {
  let lastPointerCoords: PointerCoords | null = null

  const handleLeftClick = (event: PointerEvent) => {
    closeContextMenu()

    if (getPlacementModeActive()) {
      performPlacement()
      return
    }

    if (getTargetingModeActive()) {
      performTargeting(event)
      return
    }

    const hitId = pickPokemonId(event)
    const selectedId = getSelectedId()

    if (!selectedId) {
      if (canControlPokemon(hitId)) {
        selectPokemon(hitId)
      }

      return
    }

    if (!canControlPokemon(selectedId)) {
      selectPokemon(null)
      return
    }

    performSelectedMove()
  }

  const handleRightClick = (event: MouseEvent) => {
    event.preventDefault()
    flushPointerMove()

    if (getPlacementModeActive()) {
      cancelPlacement()
      return
    }

    if (getTargetingModeActive()) {
      cancelTargeting()
      return
    }

    if (getBuildMode()) {
      if (pointerTracker.isClick()) {
        performBuildAction(event, 'eraser')
      }
      return
    }

    if (getHazardMode()) {
      if (pointerTracker.isClick()) {
        performHazardAction(event, 'eraser')
      }
      return
    }

    const hitId = pickPokemonId(event)

    if (!hitId || !canControlPokemon(hitId)) {
      closeContextMenu()
      return
    }

    openContextMenu(event, hitId)
  }

  const handlePointerDown = (event: PointerEvent) => {
    closeContextMenu()
    pointerTracker.start(event)
  }

  const processPointerMove = (event: PointerEvent) => {
    updateHoverFromPointer(event)

    if (getPlacementModeActive()) {
      updatePlacementPreviewFromPointer(event)
      return
    }

    if (getTargetingModeActive()) {
      updateTargetingFromPointer(event)
      return
    }

    if (getBuildMode()) {
      updateBuildPreviewFromPointer(event)
      return
    }

    if (getHazardMode()) {
      updateHazardPreviewFromPointer(event)
      return
    }

    const selectedPokemon = getSelectedPokemon()

    if (selectedPokemon && canControlPokemon(selectedPokemon.id)) {
      updateMovePreviewFromPointer(event)
    }
  }

  const pointerMoveCoalescer = createPointerEventCoalescer({
    processFrame: (frame) => {
      processPointerMove(frame.event as unknown as PointerEvent)
      onPointerMoveFrame(frame)
    },
    requestAnimationFrame: pointerMoveRequestAnimationFrame,
    cancelAnimationFrame: pointerMoveCancelAnimationFrame,
  })

  const flushPointerMove = () => pointerMoveCoalescer.flush()
  const cancelPointerMove = () => pointerMoveCoalescer.cancel()

  const handlePointerMove = (event: PointerEvent) => {
    pointerTracker.move(event)
    lastPointerCoords = { clientX: event.clientX, clientY: event.clientY }
    pointerMoveCoalescer.queue(event)
  }

  const handleWheel = (event: WheelEvent) => {
    flushPointerMove()
    const selectedPokemon = getSelectedPokemon()

    if (getPlacementModeActive()) {
      event.preventDefault()
      event.stopPropagation()
      stepPlacementElevation(event.deltaY)
      return
    }

    if (getTargetingModeActive()) {
      return
    }

    if (!selectedPokemon || !canControlPokemon(selectedPokemon.id)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    stepPreviewElevation(event.deltaY)
  }

  const handlePointerUp = (event: PointerEvent) => {
    flushPointerMove()

    if (!pointerTracker.isClick() || event.button !== 0) {
      return
    }

    if (getPlacementModeActive()) {
      performPlacement()
      return
    }

    if (getTargetingModeActive()) {
      performTargeting(event)
      return
    }

    if (getBuildMode()) {
      performBuildAction(event, getBuildTool())
      return
    }

    if (getHazardMode()) {
      performHazardAction(event, getHazardTool() ?? 'pencil')
      return
    }

    handleLeftClick(event)
  }

  const handlePointerLeave = () => {
    cancelPointerMove()
    lastPointerCoords = null
    clearHoveredPokemon()
    if (getBuildMode()) {
      hideBuildGhost()
    }
    if (getHazardMode()) {
      hideHazardGhost()
    }
  }

  const handleEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') {
      return
    }

    cancelPointerMove()

    if (closeTopmostOverlay()) return
    if (getPlacementModeActive()) {
      cancelPlacement()
      return
    }

    if (getTargetingModeActive()) {
      cancelTargeting()
      return
    }

    selectPokemon(null)
  }

  return {
    lastPointerCoords: () => lastPointerCoords,
    handleLeftClick,
    handleRightClick,
    handlePointerDown,
    handlePointerMove,
    handleWheel,
    handlePointerUp,
    handlePointerLeave,
    handleEscape,
    flushPointerMove,
    cancelPointerMove,
    dispose: () => pointerMoveCoalescer.dispose(),
  }
}
