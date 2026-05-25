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

export interface ResolvedIsometricGridVisibilityState {
  grid: boolean
  movement: boolean
}

export interface ResolvedIsometricLayerVisibilityState extends ResolvedIsometricGridVisibilityState {
  terrain: boolean
  shadows: boolean
  tokens: boolean
  hazards: boolean
  fieldEffects: boolean
}

export const resolveIsometricGridVisibilityState = (
  options: Omit<IsometricGridVisibilityOptions, 'gridRenderer'>,
): ResolvedIsometricGridVisibilityState => ({
  grid: options.layers.grid,
  movement: shouldShowMovementGrid({
    hasSelectedPokemon: options.hasSelectedPokemon,
    buildMode: options.buildMode,
    hazardMode: options.hazardMode,
  }),
})

export const setIsometricGridVisibility = (options: IsometricGridVisibilityOptions) => {
  options.gridRenderer.setVisible(resolveIsometricGridVisibilityState(options))
}

export interface IsometricLayerVisibilityOptions extends IsometricGridVisibilityOptions {
  voxelRenderer: { setVisible: (visible: boolean) => void }
  fieldEffectRenderer: { setVisible: (visible: boolean) => void }
  hazardRenderer: { setVisible: (visible: boolean) => void }
  renderObjects: Iterable<PokemonRenderObject>
  setTokenLayerVisibility: (renderObject: PokemonRenderObject, layers: LayerVisibility) => void
}

export const resolveIsometricLayerVisibilityState = (
  options: Omit<IsometricLayerVisibilityOptions, 'gridRenderer' | 'voxelRenderer' | 'fieldEffectRenderer' | 'hazardRenderer' | 'renderObjects' | 'setTokenLayerVisibility'>,
): ResolvedIsometricLayerVisibilityState => ({
  ...resolveIsometricGridVisibilityState(options),
  terrain: options.layers.terrain,
  shadows: options.layers.shadows,
  tokens: options.layers.tokens,
  hazards: options.layers.hazards,
  fieldEffects: options.layers.fieldEffects,
})

export const isSameIsometricLayerVisibilityState = (
  left: ResolvedIsometricLayerVisibilityState,
  right: ResolvedIsometricLayerVisibilityState,
): boolean => left.grid === right.grid
  && left.movement === right.movement
  && left.terrain === right.terrain
  && left.shadows === right.shadows
  && left.tokens === right.tokens
  && left.hazards === right.hazards
  && left.fieldEffects === right.fieldEffects

const cloneIsometricLayerVisibilityState = (
  state: ResolvedIsometricLayerVisibilityState,
): ResolvedIsometricLayerVisibilityState => ({ ...state })

export const applyIsometricLayerVisibility = (options: IsometricLayerVisibilityOptions) => {
  setIsometricGridVisibility(options)
  options.voxelRenderer.setVisible(options.layers.terrain)
  options.fieldEffectRenderer.setVisible(options.layers.fieldEffects)
  options.hazardRenderer.setVisible(options.layers.hazards)

  for (const renderObject of options.renderObjects) {
    options.setTokenLayerVisibility(renderObject, options.layers)
  }
}

export const createIsometricLayerVisibilityApplicator = () => {
  let previousState: ResolvedIsometricLayerVisibilityState | null = null

  return {
    apply(options: IsometricLayerVisibilityOptions): boolean {
      const nextState = resolveIsometricLayerVisibilityState(options)
      if (previousState && isSameIsometricLayerVisibilityState(previousState, nextState)) {
        return false
      }

      applyIsometricLayerVisibility(options)
      previousState = cloneIsometricLayerVisibilityState(nextState)
      return true
    },

    invalidate() {
      previousState = null
    },

    snapshot(): ResolvedIsometricLayerVisibilityState | null {
      return previousState ? cloneIsometricLayerVisibilityState(previousState) : null
    },
  }
}
