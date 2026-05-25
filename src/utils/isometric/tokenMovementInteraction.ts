import type * as THREE from 'three'
import type { GridAnchor, GridDimensions, SpawnedPokemon } from '~/types/pokemon'
import type { MapVoxelV2 } from '~/types/map'
import type { PreviewState } from '~/utils/gridPreview'
import { canPlacePokemon } from '~/utils/gridPlacement'
import {
  findMovementPathForPokemon,
  movementPathFailureMessage,
  type MovementPathResult,
} from '~/utils/mapMovementPathfinding'
import {
  createMapMovementPathCache,
  movementPathCacheKey,
  movementPathPlacementRevision,
  type MovementPathRevision,
} from '~/utils/mapMovementPathCache'
import {
  EMPTY_MOVE_PREVIEW,
  getMovePreviewAnchor,
  getNextMovePreviewElevationAnchor,
  movementPreviewAnchorKey,
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
  getMapVoxels: () => readonly MapVoxelV2[]
  getMapVoxelsRevision?: () => string | number | null
  getPokemonPlacementRevision?: () => MovementPathRevision
  getPreviewLayerY: () => number
  getGroundLevelY: () => number
  getCamera: () => THREE.Camera | null
  getMoveGridIntersection: (event: TokenMovementPointerEvent, yLevel: number) => Pick<GridAnchor, 'x' | 'z'> | null
  previewRenderer: TokenMovementPreviewRenderer
  emitPreviewChange: (preview: PreviewState) => void
  movePokemon: (payload: { id: string; position: GridAnchor }) => void
  recordPathfindingRequest?: () => void
}

const emptyPreview = (): PreviewState => ({ ...EMPTY_MOVE_PREVIEW })

export const createIsometricTokenMovementInteractionController = (
  dependencies: TokenMovementInteractionDependencies,
) => {
  let activePreview: PreviewState = emptyPreview()
  let activePreviewCanPlace = false
  let activePreviewAnchor: GridAnchor | null = null
  let lastPreviewAnchorKey: string | null = null
  const movementPathCache = createMapMovementPathCache()

  const resetPreviewAnchorCache = () => {
    lastPreviewAnchorKey = null
  }

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
    resetPreviewAnchorCache()
    dependencies.previewRenderer.clear()
    emitPreview()
  }

  const updatePreviewAtAnchor = (anchor: GridAnchor | null, options: { force?: boolean } = {}) => {
    const selected = dependencies.getSelectedPokemon()
    if (!selected) {
      clearPreviewVisuals()
      return
    }

    if (!anchor) {
      clearPreviewVisuals()
      return
    }

    const nextAnchorKey = movementPreviewAnchorKey(selected, anchor)
    if (!options.force && nextAnchorKey && nextAnchorKey === lastPreviewAnchorKey) return

    ensurePreviewObjects()

    const pokemons = dependencies.getPokemons()
    const dimensions = dependencies.getDimensions()
    const groundLevelY = dependencies.getGroundLevelY()
    const canForcePlace = canPlacePokemon(
      selected,
      anchor,
      pokemons,
      dimensions,
      selected.id,
    )
    let movementPath: MovementPathResult | null = null
    if (canForcePlace) {
      const terrainRevision = dependencies.getMapVoxelsRevision?.() ?? null
      const placementRevision = dependencies.getPokemonPlacementRevision?.()
        ?? movementPathPlacementRevision(pokemons)
      const cacheKey = terrainRevision == null
        ? null
        : movementPathCacheKey({
            selectedToken: selected,
            start: selected.position,
            goal: anchor,
            dimensions,
            groundLevelY,
            terrainRevision,
            placementRevision,
          })
      movementPath = movementPathCache.getOrCompute(cacheKey, () => {
        dependencies.recordPathfindingRequest?.()
        return findMovementPathForPokemon({
          pokemon: selected,
          start: selected.position,
          goal: anchor,
          pokemons,
          dimensions,
          exceptId: selected.id,
          voxels: dependencies.getMapVoxels(),
          groundLevelY,
          terrainRevision,
        })
      }).result
    }
    const path = movementPath?.path ?? null
    const reachable = Boolean(movementPath?.legal)
    const previewUpdated = dependencies.previewRenderer.update({
      pokemon: selected,
      anchor,
      canForcePlace,
      reachable,
      path,
      groundLevelY,
      camera: dependencies.getCamera(),
    })

    if (!previewUpdated) {
      clearPreviewVisuals()
      return
    }

    activePreviewAnchor = anchor
    lastPreviewAnchorKey = nextAnchorKey
    activePreviewCanPlace = canForcePlace && reachable
    activePreview = {
      position: anchor,
      reachable,
      pathLength: movementPath?.distance ?? 0,
      ...(movementPath
        ? {
            movementDistance: movementPath.distance,
            movementLimit: movementPath.movementLimit,
            movementCapabilities: movementPath.capabilityLabels,
            movementCapabilityLabel: movementPath.capabilityLabel,
            movementFailureReason: movementPathFailureMessage(movementPath),
          }
        : {}),
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
      updatePreviewAtAnchor(activePreviewAnchor, { force: true })
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
    resetPreviewAnchorCache()
    movementPathCache.clear()
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
    disposeOwner: () => {
      movementPathCache.clear()
      dependencies.previewRenderer.disposeOwner()
    },
  }
}
