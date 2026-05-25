import { describe, expect, it, vi } from 'vitest'
import type { LayerVisibility } from '~/types/map'
import {
  applyIsometricLayerVisibility,
  createIsometricLayerVisibilityApplicator,
  isSameIsometricLayerVisibilityState,
  resolveIsometricLayerVisibilityState,
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
  it('resolves stable layer visibility state including derived movement-grid visibility', () => {
    const inactiveState = resolveIsometricLayerVisibilityState({
      layers: visibleLayers,
      hasSelectedPokemon: false,
      buildMode: false,
      hazardMode: false,
    })
    const selectedState = resolveIsometricLayerVisibilityState({
      layers: { ...visibleLayers },
      hasSelectedPokemon: true,
      buildMode: false,
      hazardMode: false,
    })

    expect(inactiveState).toEqual({
      terrain: true,
      shadows: true,
      tokens: true,
      grid: true,
      movement: false,
      hazards: false,
      fieldEffects: true,
    })
    expect(selectedState).toEqual({
      ...inactiveState,
      movement: true,
    })
    expect(isSameIsometricLayerVisibilityState(inactiveState, { ...inactiveState })).toBe(true)
    expect(isSameIsometricLayerVisibilityState(inactiveState, selectedState)).toBe(false)
  })

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

  it('skips repeated applications until resolved state changes or is invalidated', () => {
    const gridRenderer = { setVisible: vi.fn() }
    const voxelRenderer = { setVisible: vi.fn() }
    const fieldEffectRenderer = { setVisible: vi.fn() }
    const hazardRenderer = { setVisible: vi.fn() }
    const tokenA = {} as PokemonRenderObject
    const setTokenLayerVisibility = vi.fn()
    const applicator = createIsometricLayerVisibilityApplicator()
    const options = {
      layers: visibleLayers,
      hasSelectedPokemon: false,
      buildMode: false,
      hazardMode: false,
      gridRenderer,
      voxelRenderer,
      fieldEffectRenderer,
      hazardRenderer,
      renderObjects: [tokenA],
      setTokenLayerVisibility,
    }

    expect(applicator.apply(options)).toBe(true)
    expect(applicator.apply({
      ...options,
      layers: { ...visibleLayers },
    })).toBe(false)

    expect(gridRenderer.setVisible).toHaveBeenCalledTimes(1)
    expect(voxelRenderer.setVisible).toHaveBeenCalledTimes(1)
    expect(fieldEffectRenderer.setVisible).toHaveBeenCalledTimes(1)
    expect(hazardRenderer.setVisible).toHaveBeenCalledTimes(1)
    expect(setTokenLayerVisibility).toHaveBeenCalledTimes(1)
    expect(applicator.snapshot()).toEqual({
      terrain: true,
      shadows: true,
      tokens: true,
      grid: true,
      movement: false,
      hazards: false,
      fieldEffects: true,
    })

    expect(applicator.apply({
      ...options,
      hasSelectedPokemon: true,
    })).toBe(true)
    expect(gridRenderer.setVisible).toHaveBeenLastCalledWith({ grid: true, movement: true })
    expect(setTokenLayerVisibility).toHaveBeenCalledTimes(2)

    applicator.invalidate()
    expect(applicator.apply({
      ...options,
      hasSelectedPokemon: true,
    })).toBe(true)
    expect(setTokenLayerVisibility).toHaveBeenCalledTimes(3)
  })
})
