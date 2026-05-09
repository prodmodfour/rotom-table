import type { LayerVisibility } from '~/types/map'
import type { PokemonRenderObject } from '~/utils/isometric/types'
import { shouldShowMovementGrid } from '~/utils/isometric/sceneState'

export interface IsometricGridVisibilityOptions {
  layers: LayerVisibility
  hasSelectedPokemon: boolean
  buildMode: boolean
  hazardMode?: boolean
  gridRenderer: {
    setVisible: (visibility: { grid: boolean; movement: boolean }) => void
  }
}

export const setIsometricGridVisibility = (options: IsometricGridVisibilityOptions) => {
  options.gridRenderer.setVisible({
    grid: options.layers.grid,
    movement: shouldShowMovementGrid({
      hasSelectedPokemon: options.hasSelectedPokemon,
      buildMode: options.buildMode,
      hazardMode: options.hazardMode,
    }),
  })
}

export interface IsometricLayerVisibilityOptions extends IsometricGridVisibilityOptions {
  voxelRenderer: { setVisible: (visible: boolean) => void }
  fieldEffectRenderer: { setVisible: (visible: boolean) => void }
  hazardRenderer: { setVisible: (visible: boolean) => void }
  renderObjects: Iterable<PokemonRenderObject>
  setTokenLayerVisibility: (renderObject: PokemonRenderObject, layers: LayerVisibility) => void
}

export const applyIsometricLayerVisibility = (options: IsometricLayerVisibilityOptions) => {
  setIsometricGridVisibility(options)
  options.voxelRenderer.setVisible(options.layers.terrain)
  options.fieldEffectRenderer.setVisible(options.layers.fieldEffects)
  options.hazardRenderer.setVisible(options.layers.hazards)

  for (const renderObject of options.renderObjects) {
    options.setTokenLayerVisibility(renderObject, options.layers)
  }
}
