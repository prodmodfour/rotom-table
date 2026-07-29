import type * as THREE from 'three'
import type { GridAnchor, GridDimensions, SpawnedPokemon } from '~/types/pokemon'
import type { PreviewState } from '~/utils/gridPreview'
import { canPlacePokemon } from '~/utils/gridPlacement'
import {
  getSendOutThrowDistance,
  isSendOutPositionWithinThrowRange,
} from '~/utils/mapTokenSendOut'
import {
  EMPTY_MOVE_PREVIEW,
  getMovePreviewAnchor,
  getNextMovePreviewElevationAnchor,
} from '~/utils/isometric/movementPreview'

export type TokenSendOutPointerEvent = MouseEvent | PointerEvent

export interface TokenSendOutRequest {
  trainerId: string
  pokemonSlug: string
  trainer: SpawnedPokemon
  pokemon: SpawnedPokemon
  range: number
}

export interface TokenSendOutPreviewRenderer {
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
}

export interface TokenSendOutInteractionDependencies {
  getActiveRequest: () => TokenSendOutRequest | null
  getPokemons: () => SpawnedPokemon[]
  getDimensions: () => GridDimensions
  getMapMovementOccupancy: () => ReadonlySet<string>
  getGroundLevelY: () => number
  getCamera: () => THREE.Camera | null
  getMoveGridIntersection: (event: TokenSendOutPointerEvent, yLevel: number) => Pick<GridAnchor, 'x' | 'z'> | null
  previewRenderer: TokenSendOutPreviewRenderer
  emitPreviewChange: (preview: PreviewState) => void
  sendOutPokemon: (payload: { trainerId: string; pokemonSlug: string; position: GridAnchor }) => void
  clearActiveRequest: () => void
}

const emptyPreview = (): PreviewState => ({ ...EMPTY_MOVE_PREVIEW })

export const createIsometricTokenSendOutInteractionController = (
  dependencies: TokenSendOutInteractionDependencies,
) => {
  let activePreview: PreviewState = emptyPreview()
  let activePreviewCanCommit = false
  let activePreviewAnchor: GridAnchor | null = null

  const activeRequest = () => dependencies.getActiveRequest()
  const activePokemon = () => activeRequest()?.pokemon ?? null
  const preview = () => activePreview
  const canCommitPreview = () => activePreviewCanCommit
  const activeAnchor = () => activePreviewAnchor
  const previewPositionY = () =>
    activePreview.position?.y ?? activeRequest()?.trainer.position.y ?? null

  const emitPreview = () => dependencies.emitPreviewChange({ ...activePreview })

  const ensurePreviewObjects = () => {
    const request = activeRequest()
    if (request) dependencies.previewRenderer.ensure(request.pokemon)
  }

  const clearPreviewVisuals = () => {
    activePreview = emptyPreview()
    activePreviewCanCommit = false
    activePreviewAnchor = null
    dependencies.previewRenderer.clear()
    emitPreview()
  }

  const cancel = () => {
    clearPreviewVisuals()
    dependencies.clearActiveRequest()
    return true
  }

  const updatePreviewAtAnchor = (anchor: GridAnchor | null) => {
    const request = activeRequest()
    if (!request) {
      clearPreviewVisuals()
      return
    }

    ensurePreviewObjects()

    if (!anchor) {
      clearPreviewVisuals()
      return
    }

    const range = request.range
    const canPlace = canPlacePokemon(
      request.pokemon,
      anchor,
      dependencies.getPokemons(),
      dependencies.getDimensions(),
      null,
      dependencies.getMapMovementOccupancy(),
    )
    const distance = getSendOutThrowDistance({
      trainer: request.trainer,
      pokemon: request.pokemon,
      position: anchor,
    })
    const reachable = canPlace && isSendOutPositionWithinThrowRange({
      trainer: request.trainer,
      pokemon: request.pokemon,
      position: anchor,
      range,
    })
    const previewUpdated = dependencies.previewRenderer.update({
      pokemon: request.pokemon,
      anchor,
      canForcePlace: reachable,
      reachable,
      path: null,
      groundLevelY: dependencies.getGroundLevelY(),
      camera: dependencies.getCamera(),
    })

    if (!previewUpdated) {
      clearPreviewVisuals()
      return
    }

    activePreviewAnchor = anchor
    activePreviewCanCommit = reachable
    activePreview = {
      position: anchor,
      reachable,
      pathLength: Math.ceil(distance),
    }
    emitPreview()
  }

  const updatePreviewFromPointer = (event: TokenSendOutPointerEvent) => {
    const request = activeRequest()
    if (!request) {
      clearPreviewVisuals()
      return
    }

    const previewLayerY = activePreview.position?.y ?? request.trainer.position.y
    const point = dependencies.getMoveGridIntersection(event, previewLayerY)
    const anchor = getMovePreviewAnchor({
      point,
      pokemon: request.pokemon,
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
    const request = activeRequest()
    if (!request) return false

    const nextAnchor = getNextMovePreviewElevationAnchor({
      currentAnchor: activePreview.position ?? request.trainer.position,
      pokemon: request.pokemon,
      dimensions: dependencies.getDimensions(),
      deltaY,
    })

    if (!nextAnchor) return false
    updatePreviewAtAnchor(nextAnchor)
    return true
  }

  const performSendOut = () => {
    const request = activeRequest()
    if (!request || !activePreview.position || !activePreviewCanCommit) return false

    dependencies.sendOutPokemon({
      trainerId: request.trainerId,
      pokemonSlug: request.pokemonSlug,
      position: activePreview.position,
    })
    cancel()
    return true
  }

  const refreshAfterStateChange = () => {
    if (activeRequest() && activePreviewAnchor) {
      updatePreviewAtAnchor(activePreviewAnchor)
      return
    }

    if (!activeRequest()) {
      clearPreviewVisuals()
    }
  }

  const resetForRequestChange = () => {
    activePreviewAnchor = null
    activePreview = emptyPreview()
    activePreviewCanCommit = false
    ensurePreviewObjects()
    emitPreview()
  }

  return {
    activePokemon,
    preview,
    canCommitPreview,
    activeAnchor,
    previewPositionY,
    ensurePreviewObjects,
    clearPreviewVisuals,
    updatePreviewAtAnchor,
    updatePreviewFromPointer,
    stepPreviewElevation,
    performSendOut,
    refreshAfterStateChange,
    resetForRequestChange,
    cancel,
  }
}
