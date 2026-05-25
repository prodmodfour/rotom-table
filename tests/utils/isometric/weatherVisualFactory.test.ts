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

interface WeatherRenderResourceSnapshot {
  objects: THREE.Object3D[]
  geometries: THREE.BufferGeometry[]
  materials: THREE.Material[]
  attributes: unknown[]
  attributeArrays: unknown[]
  instanceMatrixArrays: unknown[]
  textureMaps: THREE.Texture[]
}

const materialList = (
  material: THREE.Material | THREE.Material[] | undefined,
): THREE.Material[] => {
  if (!material) return []
  return Array.isArray(material) ? material : [material]
}

const captureWeatherRenderResources = (
  group: THREE.Group,
): WeatherRenderResourceSnapshot => {
  const snapshot: WeatherRenderResourceSnapshot = {
    objects: [],
    geometries: [],
    materials: [],
    attributes: [],
    attributeArrays: [],
    instanceMatrixArrays: [],
    textureMaps: [],
  }

  group.traverse((object) => {
    const renderObject = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry
      material?: THREE.Material | THREE.Material[]
      instanceMatrix?: { array?: unknown }
    }
    snapshot.objects.push(object)
    if (renderObject.geometry) {
      snapshot.geometries.push(renderObject.geometry)
      const positionAttribute = renderObject.geometry.getAttribute('position')
      if (positionAttribute) {
        snapshot.attributes.push(positionAttribute)
        const maybeArrayAttribute = positionAttribute as { array?: unknown }
        if (maybeArrayAttribute.array) {
          snapshot.attributeArrays.push(maybeArrayAttribute.array)
        }
      }
    }
    if (renderObject.instanceMatrix?.array) {
      snapshot.instanceMatrixArrays.push(renderObject.instanceMatrix.array)
    }
    for (const material of materialList(renderObject.material)) {
      snapshot.materials.push(material)
      const mappedMaterial = material as THREE.Material & {
        map?: THREE.Texture | null
      }
      if (mappedMaterial.map) snapshot.textureMaps.push(mappedMaterial.map)
    }
  })

  return snapshot
}

const expectSameReferences = <T>(actual: T[], expected: T[]) => {
  expect(actual).toHaveLength(expected.length)
  for (let i = 0; i < expected.length; i += 1) {
    expect(actual[i]).toBe(expected[i])
  }
}

const expectSameWeatherRenderResources = (
  actual: WeatherRenderResourceSnapshot,
  expected: WeatherRenderResourceSnapshot,
) => {
  expectSameReferences(actual.objects, expected.objects)
  expectSameReferences(actual.geometries, expected.geometries)
  expectSameReferences(actual.materials, expected.materials)
  expectSameReferences(actual.attributes, expected.attributes)
  expectSameReferences(actual.attributeArrays, expected.attributeArrays)
  expectSameReferences(actual.instanceMatrixArrays, expected.instanceMatrixArrays)
  expectSameReferences(actual.textureMaps, expected.textureMaps)
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

  it('updates weather visuals without recreating render resources', () => {
    const textures = fakeTextureCache()
    const kinds: MapWeatherKind[] = ['sunny', 'rainy', 'hail', 'sandstorm']

    for (const kind of kinds) {
      const visual = makeWeatherVisual(input, kind, 0, 1, textures)
      const resourcesBeforeUpdate = captureWeatherRenderResources(visual.group)

      visual.update(0.016, 1.25)
      visual.update(0.032, 2.5)

      expectSameWeatherRenderResources(
        captureWeatherRenderResources(visual.group),
        resourcesBeforeUpdate,
      )
      disposeGroup(visual.group)
    }

    textures.disposeTextureCache()
  })
})
