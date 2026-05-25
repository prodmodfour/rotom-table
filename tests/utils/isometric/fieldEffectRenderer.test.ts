import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  createFieldEffectRenderer,
  type FieldEffectRendererInput,
} from '~/utils/isometric/fieldEffectRenderer'

const baseInput = (): FieldEffectRendererInput => ({
  dimensions: { x: 4, y: 3, z: 4 },
  voxels: [],
  groundLevelY: 0,
  effects: { weather: [], terrains: [], rooms: [] },
})

describe('field effect renderer animation activity', () => {
  it('reports no active animation for empty or static field effects', () => {
    const container = new THREE.Group()
    const renderer = createFieldEffectRenderer(container)

    expect(renderer.getAnimationState()).toEqual({
      visible: true,
      activeAnimatorCount: 0,
    })
    expect(renderer.needsAnimationFrame()).toBe(false)

    renderer.sync({
      ...baseInput(),
      effects: {
        weather: [],
        terrains: [{ kind: 'electric', rounds: 5 }],
        rooms: [{ kind: 'magic', rounds: 5 }],
      },
    })

    expect(renderer.getAnimationState()).toEqual({
      visible: true,
      activeAnimatorCount: 0,
    })
    expect(renderer.needsAnimationFrame()).toBe(false)

    renderer.dispose()
  })

  it('reports visible weather animators as requiring animation frames', () => {
    const container = new THREE.Group()
    const renderer = createFieldEffectRenderer(container)

    renderer.sync({
      ...baseInput(),
      effects: {
        weather: [{ kind: 'rainy', rounds: 5 }],
        terrains: [],
        rooms: [],
      },
    })

    expect(renderer.getAnimationState()).toEqual({
      visible: true,
      activeAnimatorCount: 1,
    })
    expect(renderer.needsAnimationFrame()).toBe(true)

    renderer.setVisible(false)
    expect(renderer.getAnimationState()).toEqual({
      visible: false,
      activeAnimatorCount: 1,
    })
    expect(renderer.needsAnimationFrame()).toBe(false)

    renderer.setVisible(true)
    expect(renderer.needsAnimationFrame()).toBe(true)

    renderer.dispose()
  })

  it('skips update callbacks when no visible animated effects are active', () => {
    const container = new THREE.Group()
    const updateWeather = vi.fn()
    const disposeTextureCache = vi.fn()
    const renderer = createFieldEffectRenderer(container, {
      weatherVisualFactory: {
        makeWeatherVisual: () => ({ group: new THREE.Group(), update: updateWeather }),
        disposeTextureCache,
      },
    })

    renderer.sync({
      ...baseInput(),
      effects: {
        weather: [{ kind: 'rainy', rounds: 5 }],
        terrains: [],
        rooms: [],
      },
    })
    renderer.update(0.016, 1.5)
    expect(updateWeather).toHaveBeenCalledWith(0.016, 1.5)

    renderer.setVisible(false)
    updateWeather.mockClear()
    renderer.update(0.016, 1.75)
    expect(updateWeather).not.toHaveBeenCalled()

    renderer.setVisible(true)
    renderer.sync(baseInput())
    renderer.update(0.016, 2)
    expect(updateWeather).not.toHaveBeenCalled()

    renderer.dispose()
    expect(disposeTextureCache).toHaveBeenCalledOnce()
  })

  it('clears animator activity when weather effects are removed', () => {
    const container = new THREE.Group()
    const renderer = createFieldEffectRenderer(container)

    renderer.sync({
      ...baseInput(),
      effects: {
        weather: [
          { kind: 'rainy', rounds: 5 },
          { kind: 'hail', rounds: 5 },
        ],
        terrains: [],
        rooms: [],
      },
    })
    expect(renderer.getAnimationState().activeAnimatorCount).toBe(2)
    expect(renderer.needsAnimationFrame()).toBe(true)

    renderer.sync(baseInput())

    expect(renderer.getAnimationState()).toEqual({
      visible: true,
      activeAnimatorCount: 0,
    })
    expect(renderer.needsAnimationFrame()).toBe(false)

    renderer.dispose()
  })
})
