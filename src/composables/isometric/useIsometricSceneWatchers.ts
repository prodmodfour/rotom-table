import { watch, type WatchSource } from 'vue'

export interface IsometricSceneWatcherActions {
  syncPokemonObjects: () => void
  refreshMovementAfterStateChange: () => void
  syncDialogsFromPokemons: () => void
  replayBuildPreview: () => void
  syncVoxelMeshes: () => void
  replayHazardPreview: () => void
  syncHazardMeshes: () => void
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
}

export interface IsometricSceneWatcherSources {
  pokemons: WatchSource<unknown>
  terrainVoxelRevision: WatchSource<unknown>
  hazardRevision: WatchSource<unknown>
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
    },
  )

  watch(
    sources.hazardRevision,
    () => {
      if (!sources.isRendererReady()) return
      actions.syncHazardMeshes()
      actions.replayHazardPreview()
    },
  )

  watch(
    sources.fieldEffectsRevision,
    () => {
      if (!sources.isRendererReady()) return
      actions.syncFieldEffectMeshes()
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
        return
      }

      actions.resetMovementForSelectionChange()
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
    },
  )

  watch(
    sources.buildSettings,
    () => {
      if (!sources.isRendererReady() || !sources.buildMode()) return
      actions.replayBuildPreview()
    },
  )

  watch(
    sources.hazardSettings,
    () => {
      if (!sources.isRendererReady() || !sources.hazardMode()) return
      actions.replayHazardPreview()
    },
  )

  watch(
    sources.ghostVoxelsFaded,
    () => {
      if (!sources.isRendererReady()) return
      actions.syncVoxelMeshes()
    },
  )

  watch(
    sources.groundLevelY,
    () => {
      if (!sources.isRendererReady()) return
      actions.syncFieldEffectMeshes()
      actions.refreshMovementAfterStateChange()
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
    },
  )
}
