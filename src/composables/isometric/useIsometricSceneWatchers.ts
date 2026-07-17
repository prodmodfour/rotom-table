import { watch, type WatchSource } from 'vue'
import type { RenderInvalidationReason } from '~/utils/isometric/renderInvalidation'

export type IsometricSceneWatcherRenderRequest =
  | RenderInvalidationReason
  | readonly RenderInvalidationReason[]

const TOKEN_OBJECT_RENDER_REASONS: readonly RenderInvalidationReason[] = [
  'tokens',
  'token-style',
  'movement-preview',
  'build-preview',
]

const TERRAIN_RENDER_REASONS: readonly RenderInvalidationReason[] = [
  'terrain',
  'movement-preview',
  'build-preview',
  'hazard-preview',
]

const HAZARD_RENDER_REASONS: readonly RenderInvalidationReason[] = [
  'hazards',
  'hazard-preview',
]

const GROUND_ITEM_RENDER_REASONS: readonly RenderInvalidationReason[] = [
  'scene-state',
]

const FIELD_EFFECT_RENDER_REASONS: readonly RenderInvalidationReason[] = [
  'field-effect',
  'weather',
]

const SELECTION_RENDER_REASONS: readonly RenderInvalidationReason[] = [
  'token-style',
  'movement-preview',
  'layer-visibility',
]

const BUILD_MODE_RENDER_REASONS: readonly RenderInvalidationReason[] = [
  'layer-visibility',
  'movement-preview',
  'build-preview',
  'hazard-preview',
]

const HAZARD_MODE_RENDER_REASONS: readonly RenderInvalidationReason[] = [
  'layer-visibility',
  'movement-preview',
  'build-preview',
  'hazard-preview',
]

const GROUND_LEVEL_RENDER_REASONS: readonly RenderInvalidationReason[] = [
  'field-effect',
  'movement-preview',
  'token-style',
]

const DIMENSIONS_RENDER_REASONS: readonly RenderInvalidationReason[] = [
  'resize',
  'camera',
  'terrain',
  'field-effect',
  'movement-preview',
  'build-preview',
  'hazard-preview',
]

export interface IsometricSceneWatcherActions {
  syncPokemonObjects: () => void
  refreshMovementAfterStateChange: () => void
  syncDialogsFromPokemons: () => void
  replayBuildPreview: () => void
  syncVoxelMeshes: () => void
  replayHazardPreview: () => void
  syncHazardMeshes: () => void
  syncGroundItemMeshes?: () => void
  syncFieldEffectMeshes: () => void
  selectPokemon: (id: string | null) => void
  refreshPokemonStyles: () => void
  updateGridVisibility: () => void
  setControlsZoomEnabled: (enabled: boolean) => void
  clearPreviewVisuals: () => void
  closeContextMenu: () => void
  disposePreviewOwner: () => void
  resetMovementForSelectionChange: () => void
  closeUnauthorizedActions: () => void
  applyLayerVisibility: () => void
  hideBuildGhost: () => void
  ensureBuildGhost: () => void
  hideHazardGhost: () => void
  ensureHazardGhost: () => void
  buildGrid: () => void
  alignCameraToGrid: (initial: boolean) => void
  syncRendererSize: () => void
  focusActiveTurnPokemon?: (id: string) => boolean
  requestRender: (reasons: IsometricSceneWatcherRenderRequest) => void
}

export interface IsometricSceneWatcherSources {
  pokemons: WatchSource<unknown>
  terrainVoxelRevision: WatchSource<unknown>
  hazardRevision: WatchSource<unknown>
  groundItemRevision?: WatchSource<unknown>
  fieldEffectsRevision: WatchSource<unknown>
  selectedId: () => string | null | undefined
  selectedPokemon: () => unknown | null | undefined
  controllableIdsKey: WatchSource<unknown>
  canControlPokemon: (id: string | null | undefined) => boolean
  layerVisibility: WatchSource<unknown>
  buildMode: () => boolean
  hazardMode: () => boolean | undefined
  buildSettings: WatchSource<unknown>
  ghostVoxelsFaded: WatchSource<unknown>
  hazardSettings: WatchSource<unknown>
  groundLevelY: WatchSource<unknown>
  dimensionsKey: WatchSource<unknown>
  activeTurnId?: WatchSource<unknown>
  activeTurnRound?: WatchSource<unknown>
  initiativeAutoFocusEnabled?: () => boolean | undefined
  isRendererReady: () => boolean
}

export interface IsometricSceneWatcherOptions {
  sources: IsometricSceneWatcherSources
  actions: IsometricSceneWatcherActions
}

export const useIsometricSceneWatchers = ({ sources, actions }: IsometricSceneWatcherOptions) => {
  watch(
    sources.pokemons,
    () => {
      if (!sources.isRendererReady()) {
        return
      }

      actions.syncPokemonObjects()
      actions.refreshMovementAfterStateChange()
      actions.syncDialogsFromPokemons()
      actions.replayBuildPreview()
      actions.requestRender(TOKEN_OBJECT_RENDER_REASONS)
    },
    { deep: true },
  )

  watch(
    sources.terrainVoxelRevision,
    () => {
      if (!sources.isRendererReady()) {
        return
      }

      actions.syncVoxelMeshes()
      actions.refreshMovementAfterStateChange()
      actions.replayBuildPreview()
      actions.replayHazardPreview()
      actions.requestRender(TERRAIN_RENDER_REASONS)
    },
  )

  watch(
    sources.hazardRevision,
    () => {
      if (!sources.isRendererReady()) return
      actions.syncHazardMeshes()
      actions.replayHazardPreview()
      actions.requestRender(HAZARD_RENDER_REASONS)
    },
  )

  if (sources.groundItemRevision && actions.syncGroundItemMeshes) {
    const syncGroundItemMeshes = actions.syncGroundItemMeshes
    watch(
      sources.groundItemRevision,
      () => {
        if (!sources.isRendererReady()) return
        syncGroundItemMeshes()
        actions.requestRender(GROUND_ITEM_RENDER_REASONS)
      },
    )
  }

  watch(
    sources.fieldEffectsRevision,
    () => {
      if (!sources.isRendererReady()) return
      actions.syncFieldEffectMeshes()
      actions.requestRender(FIELD_EFFECT_RENDER_REASONS)
    },
  )

  watch(
    sources.selectedId,
    (selectedId) => {
      if (selectedId && !sources.canControlPokemon(selectedId)) {
        actions.selectPokemon(null)
        return
      }

      if (!sources.isRendererReady()) {
        return
      }

      actions.refreshPokemonStyles()
      actions.updateGridVisibility()
      actions.setControlsZoomEnabled(!sources.selectedPokemon())

      if (!sources.selectedPokemon()) {
        actions.clearPreviewVisuals()
        actions.closeContextMenu()
        actions.disposePreviewOwner()
        actions.requestRender(SELECTION_RENDER_REASONS)
        return
      }

      actions.resetMovementForSelectionChange()
      actions.requestRender(SELECTION_RENDER_REASONS)
    },
  )

  watch(
    sources.controllableIdsKey,
    () => {
      const selectedId = sources.selectedId()
      if (selectedId && !sources.canControlPokemon(selectedId)) actions.selectPokemon(null)
      actions.closeUnauthorizedActions()
    },
  )

  watch(
    sources.layerVisibility,
    () => {
      if (!sources.isRendererReady()) return
      actions.updateGridVisibility()
      actions.applyLayerVisibility()
      actions.requestRender('layer-visibility')
    },
    { deep: true },
  )

  watch(
    sources.buildMode,
    (active) => {
      if (!sources.isRendererReady()) return

      actions.updateGridVisibility()

      if (active) {
        actions.closeContextMenu()
        actions.clearPreviewVisuals()
        actions.hideHazardGhost()
        actions.ensureBuildGhost()
        actions.replayBuildPreview()
      } else {
        actions.hideBuildGhost()
      }

      actions.requestRender(BUILD_MODE_RENDER_REASONS)
    },
  )

  watch(
    sources.hazardMode,
    (active) => {
      if (!sources.isRendererReady()) return

      actions.updateGridVisibility()

      if (active) {
        actions.closeContextMenu()
        actions.clearPreviewVisuals()
        actions.hideBuildGhost()
        actions.ensureHazardGhost()
        actions.replayHazardPreview()
      } else {
        actions.hideHazardGhost()
      }

      actions.requestRender(HAZARD_MODE_RENDER_REASONS)
    },
  )

  watch(
    sources.buildSettings,
    () => {
      if (!sources.isRendererReady() || !sources.buildMode()) return
      actions.replayBuildPreview()
      actions.requestRender('build-preview')
    },
  )

  watch(
    sources.hazardSettings,
    () => {
      if (!sources.isRendererReady() || !sources.hazardMode()) return
      actions.replayHazardPreview()
      actions.requestRender('hazard-preview')
    },
  )

  watch(
    sources.ghostVoxelsFaded,
    () => {
      if (!sources.isRendererReady()) return
      actions.syncVoxelMeshes()
      actions.requestRender('terrain')
    },
  )

  watch(
    sources.groundLevelY,
    () => {
      if (!sources.isRendererReady()) return
      actions.syncFieldEffectMeshes()
      actions.refreshMovementAfterStateChange()
      actions.requestRender(GROUND_LEVEL_RENDER_REASONS)
    },
  )

  watch(
    sources.dimensionsKey,
    () => {
      if (!sources.isRendererReady()) {
        return
      }

      actions.buildGrid()
      actions.syncFieldEffectMeshes()
      actions.updateGridVisibility()
      actions.alignCameraToGrid(false)
      actions.syncRendererSize()
      actions.refreshMovementAfterStateChange()

      if (sources.buildMode()) {
        actions.hideBuildGhost()
      }
      if (sources.hazardMode()) {
        actions.hideHazardGhost()
      }

      actions.requestRender(DIMENSIONS_RENDER_REASONS)
    },
  )

  if (sources.activeTurnId) {
    const activeTurnSources: WatchSource<unknown>[] = [sources.activeTurnId]
    if (sources.activeTurnRound) activeTurnSources.push(sources.activeTurnRound)

    watch(
      activeTurnSources,
      ([activeTurnId]) => {
        if (!sources.isRendererReady()) return

        actions.requestRender('token-style')

        const tokenId = typeof activeTurnId === 'string' && activeTurnId.length > 0
          ? activeTurnId
          : null
        if (!tokenId || sources.initiativeAutoFocusEnabled?.() !== true) return
        if (actions.focusActiveTurnPokemon?.(tokenId)) {
          actions.requestRender('camera')
        }
      },
    )
  }
}
