import { describe, expect, it, vi } from 'vitest'
import type { LayerVisibility } from '~/types/map'
import {
  applyIsometricLayerVisibility,
  setIsometricGridVisibility,
} from '~/utils/isometric/layerVisibility'
import type { PokemonRenderObject } from '~/utils/isometric/types'

const visibleLayers: LayerVisibility = {
  terrain: true,
  shadows: true,
  tokens: true,
  grid: true,
  hazards: false,
  fieldEffects: true,
}

describe('isometric layer visibility', () => {
  it('shows movement grid when token, build, or hazard modes need targeting help', () => {
    const gridRenderer = { setVisible: vi.fn() }

    setIsometricGridVisibility({
      layers: visibleLayers,
      hasSelectedPokemon: false,
      buildMode: false,
      hazardMode: true,
      gridRenderer,
    })

    expect(gridRenderer.setVisible).toHaveBeenCalledWith({ grid: true, movement: true })
  })

  it('applies layer visibility to render subsystems and token objects', () => {
    const gridRenderer = { setVisible: vi.fn() }
    const voxelRenderer = { setVisible: vi.fn() }
    const fieldEffectRenderer = { setVisible: vi.fn() }
    const hazardRenderer = { setVisible: vi.fn() }
    const tokenA = {} as PokemonRenderObject
    const tokenB = {} as PokemonRenderObject
    const setTokenLayerVisibility = vi.fn()

    applyIsometricLayerVisibility({
      layers: visibleLayers,
      hasSelectedPokemon: false,
      buildMode: false,
      hazardMode: false,
      gridRenderer,
      voxelRenderer,
      fieldEffectRenderer,
      hazardRenderer,
      renderObjects: [tokenA, tokenB],
      setTokenLayerVisibility,
    })

    expect(gridRenderer.setVisible).toHaveBeenCalledWith({ grid: true, movement: false })
    expect(voxelRenderer.setVisible).toHaveBeenCalledWith(true)
    expect(fieldEffectRenderer.setVisible).toHaveBeenCalledWith(true)
    expect(hazardRenderer.setVisible).toHaveBeenCalledWith(false)
    expect(setTokenLayerVisibility).toHaveBeenNthCalledWith(1, tokenA, visibleLayers)
    expect(setTokenLayerVisibility).toHaveBeenNthCalledWith(2, tokenB, visibleLayers)
  })
})
