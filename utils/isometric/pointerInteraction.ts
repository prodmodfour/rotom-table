import type { BuildTool } from '~/shared/mapEditor'
import type { SpawnedPokemon } from '~/types/pokemon'

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
  performBuildAction: (event: MouseEvent | PointerEvent, tool: BuildTool) => void
  performHazardAction: (event: MouseEvent | PointerEvent, tool: BuildTool) => void
  hideBuildGhost: () => void
  hideHazardGhost: () => void
  closeTopmostOverlay: () => boolean
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
  performBuildAction,
  performHazardAction,
  hideBuildGhost,
  hideHazardGhost,
  closeTopmostOverlay,
}: IsometricPointerInteractionOptions) => {
  let lastPointerCoords: PointerCoords | null = null

  const handleLeftClick = (event: PointerEvent) => {
    closeContextMenu()
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

    if (!canControlPokemon(hitId)) {
      closeContextMenu()
      return
    }

    openContextMenu(event, hitId)
  }

  const handlePointerDown = (event: PointerEvent) => {
    closeContextMenu()
    pointerTracker.start(event)
  }

  const handlePointerMove = (event: PointerEvent) => {
    pointerTracker.move(event)
    lastPointerCoords = { clientX: event.clientX, clientY: event.clientY }
    updateHoverFromPointer(event)

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

  const handleWheel = (event: WheelEvent) => {
    const selectedPokemon = getSelectedPokemon()

    if (!selectedPokemon || !canControlPokemon(selectedPokemon.id)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    stepPreviewElevation(event.deltaY)
  }

  const handlePointerUp = (event: PointerEvent) => {
    if (!pointerTracker.isClick() || event.button !== 0) {
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

    if (closeTopmostOverlay()) return

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
  }
}
