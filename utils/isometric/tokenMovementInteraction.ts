import type * as THREE from 'three'
import type { GridAnchor, GridDimensions, SpawnedPokemon } from '~/types/pokemon'
import type { PreviewState } from '~/utils/gridPreview'
import { canPlacePokemon } from '~/utils/gridPlacement'
import { findPathForPokemon } from '~/utils/gridPathfinding'
import {
  EMPTY_MOVE_PREVIEW,
  getMovePreviewAnchor,
  getNextMovePreviewElevationAnchor,
} from '~/utils/isometric/movementPreview'

export type TokenMovementPointerEvent = MouseEvent | PointerEvent

export interface TokenMovementPreviewRenderer {
  ensure: (pokemon: SpawnedPokemon) => boolean | void
  update: (options: {
    pokemon: SpawnedPokemon
    anchor: GridAnchor
    canForcePlace: boolean
    reachable: boolean
    path: GridAnchor[] | null
    groundLevelY: number
    camera: THREE.Camera | null
  }) => boolean
  clear: () => void
  disposeOwner: () => void
}

export interface TokenMovementInteractionDependencies {
  getSelectedPokemon: () => SpawnedPokemon | null
  getPokemons: () => SpawnedPokemon[]
  getDimensions: () => GridDimensions
  getMapMovementOccupancy: () => ReadonlySet<string>
  getPreviewLayerY: () => number
  getGroundLevelY: () => number
  getCamera: () => THREE.Camera | null
  getMoveGridIntersection: (event: TokenMovementPointerEvent, yLevel: number) => Pick<GridAnchor, 'x' | 'z'> | null
  previewRenderer: TokenMovementPreviewRenderer
  emitPreviewChange: (preview: PreviewState) => void
  movePokemon: (payload: { id: string; position: GridAnchor }) => void
}

const emptyPreview = (): PreviewState => ({ ...EMPTY_MOVE_PREVIEW })

export const createIsometricTokenMovementInteractionController = (
  dependencies: TokenMovementInteractionDependencies,
) => {
  let activePreview: PreviewState = emptyPreview()
  let activePreviewCanPlace = false
  let activePreviewAnchor: GridAnchor | null = null

  const preview = () => activePreview
  const canPlacePreview = () => activePreviewCanPlace
  const activeAnchor = () => activePreviewAnchor
  const previewPositionY = () =>
    activePreview.position?.y ?? dependencies.getSelectedPokemon()?.position.y ?? null

  const emitPreview = () => dependencies.emitPreviewChange({ ...activePreview })

  const ensurePreviewObjects = () => {
    const selected = dependencies.getSelectedPokemon()
    if (selected) dependencies.previewRenderer.ensure(selected)
  }

  const clearPreviewVisuals = () => {
    activePreview = emptyPreview()
    activePreviewCanPlace = false
    activePreviewAnchor = null
    dependencies.previewRenderer.clear()
    emitPreview()
  }

  const updatePreviewAtAnchor = (anchor: GridAnchor | null) => {
    const selected = dependencies.getSelectedPokemon()
    if (!selected) {
      clearPreviewVisuals()
      return
    }

    ensurePreviewObjects()

    if (!anchor) {
      clearPreviewVisuals()
      return
    }

    // Destination placement ignores terrain occupancy so the table can be used
    // as a free-positioning tool, but pathfinding below still treats terrain as
    // blocking and therefore won't show a legal route through/into blocks.
    const canForcePlace = canPlacePokemon(
      selected,
      anchor,
      dependencies.getPokemons(),
      dependencies.getDimensions(),
      selected.id,
    )
    const path = canForcePlace
      ? findPathForPokemon(
          selected,
          selected.position,
          anchor,
          dependencies.getPokemons(),
          dependencies.getDimensions(),
          selected.id,
          dependencies.getMapMovementOccupancy(),
        )
      : null
    const reachable = Boolean(path)
    const previewUpdated = dependencies.previewRenderer.update({
      pokemon: selected,
      anchor,
      canForcePlace,
      reachable,
      path,
      groundLevelY: dependencies.getGroundLevelY(),
      camera: dependencies.getCamera(),
    })

    if (!previewUpdated) {
      clearPreviewVisuals()
      return
    }

    activePreviewAnchor = anchor
    activePreviewCanPlace = canForcePlace
    activePreview = {
      position: anchor,
      reachable,
      pathLength: path ? Math.max(path.length - 1, 0) : 0,
    }
    emitPreview()
  }

  const updatePreviewFromPointer = (event: TokenMovementPointerEvent) => {
    const selected = dependencies.getSelectedPokemon()
    if (!selected) {
      clearPreviewVisuals()
      return
    }

    const previewLayerY = dependencies.getPreviewLayerY()
    const point = dependencies.getMoveGridIntersection(event, previewLayerY)
    const anchor = getMovePreviewAnchor({
      point,
      pokemon: selected,
      dimensions: dependencies.getDimensions(),
      yLevel: previewLayerY,
    })

    if (!anchor) {
      clearPreviewVisuals()
      return
    }

    updatePreviewAtAnchor(anchor)
  }

  const stepPreviewElevation = (deltaY: number) => {
    const selected = dependencies.getSelectedPokemon()
    if (!selected) return false

    const nextAnchor = getNextMovePreviewElevationAnchor({
      currentAnchor: activePreview.position ?? selected.position,
      pokemon: selected,
      dimensions: dependencies.getDimensions(),
      deltaY,
    })

    if (!nextAnchor) return false
    updatePreviewAtAnchor(nextAnchor)
    return true
  }

  const performSelectedMove = () => {
    const selected = dependencies.getSelectedPokemon()
    if (!selected || !activePreview.position || !activePreviewCanPlace) return false

    dependencies.movePokemon({
      id: selected.id,
      position: activePreview.position,
    })
    return true
  }

  const refreshAfterStateChange = () => {
    if (dependencies.getSelectedPokemon() && activePreviewAnchor) {
      updatePreviewAtAnchor(activePreviewAnchor)
      return
    }

    if (!dependencies.getSelectedPokemon()) {
      clearPreviewVisuals()
    }
  }

  const resetForSelectionChange = () => {
    activePreviewAnchor = null
    activePreview = emptyPreview()
    activePreviewCanPlace = false
    ensurePreviewObjects()
    emitPreview()
  }

  return {
    preview,
    canPlacePreview,
    activeAnchor,
    previewPositionY,
    ensurePreviewObjects,
    clearPreviewVisuals,
    updatePreviewAtAnchor,
    updatePreviewFromPointer,
    stepPreviewElevation,
    performSelectedMove,
    refreshAfterStateChange,
    resetForSelectionChange,
    disposeOwner: dependencies.previewRenderer.disposeOwner,
  }
}
