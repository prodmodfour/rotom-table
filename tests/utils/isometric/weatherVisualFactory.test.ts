import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { MapWeatherKind } from '~/types/map'
import {
  makeWeatherVisual,
  weatherVisualSeed,
} from '~/utils/isometric/weatherVisualFactory'
import type { WeatherEffectRendererInput } from '~/utils/isometric/weatherMath'
import type { WeatherTextureCache } from '~/utils/isometric/weatherTextures'

const input: WeatherEffectRendererInput = {
  dimensions: { x: 6, y: 4, z: 5 },
  groundLevelY: 0,
  voxels: [],
}

const disposeGroup = (group: THREE.Group) => {
  group.traverse((object) => {
    const maybeWithGeometry = object as THREE.Object3D & {
      geometry?: { dispose?: () => void }
      material?: THREE.Material | THREE.Material[]
    }
    maybeWithGeometry.geometry?.dispose?.()
    const materials = Array.isArray(maybeWithGeometry.material)
      ? maybeWithGeometry.material
      : maybeWithGeometry.material
        ? [maybeWithGeometry.material]
        : []
    for (const material of materials) material.dispose()
  })
}

const fakeTextureCache = (): WeatherTextureCache => {
  const sunRayTexture = new THREE.Texture() as THREE.CanvasTexture
  const sandstreamTexture = new THREE.Texture() as THREE.CanvasTexture
  return {
    getSunRayTexture: () => sunRayTexture,
    getSandstreamTexture: () => sandstreamTexture,
    disposeTextureCache: () => {
      sunRayTexture.dispose()
      sandstreamTexture.dispose()
    },
  }
}

describe('weather visual factory', () => {
  it('keeps deterministic weather visual seed formatting compatible', () => {
    expect(weatherVisualSeed('rainy', input, 2)).toBe('rainy:6x4x5:2')
  })

  it('dispatches every weather kind to a focused visual maker', () => {
    const expectedNames: Record<MapWeatherKind, string> = {
      sunny: 'weather-sun-rays',
      rainy: 'weather-rain',
      hail: 'weather-hail',
      sandstorm: 'weather-sandstream',
    }
    const textures = fakeTextureCache()

    for (const kind of Object.keys(expectedNames) as MapWeatherKind[]) {
      const visual = makeWeatherVisual(input, kind, 1, 2, textures)
      expect(visual.group.name).toBe(expectedNames[kind])
      expect(visual.group.children.length).toBeGreaterThan(0)
      expect(() => visual.update(0.016, 1.25)).not.toThrow()
      disposeGroup(visual.group)
    }

    textures.disposeTextureCache()
  })
})
