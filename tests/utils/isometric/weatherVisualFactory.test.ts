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

const visualRegressionInput: WeatherEffectRendererInput = {
  dimensions: { x: 8, y: 4, z: 8 },
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

const positionAttributeCount = (geometry: THREE.BufferGeometry): number => {
  const position = geometry.getAttribute('position')
  expect(position).toBeDefined()
  return position.count
}

const expectBaseMaterialConfig = (
  material: THREE.Material,
  expected: {
    color: number
    opacity: number
    depthTest: boolean
    depthWrite: boolean
    blending?: THREE.Blending
  },
) => {
  const materialWithColor = material as THREE.Material & { color: THREE.Color }
  expect(material.transparent).toBe(true)
  expect(material.opacity).toBeCloseTo(expected.opacity)
  expect(material.depthTest).toBe(expected.depthTest)
  expect(material.depthWrite).toBe(expected.depthWrite)
  expect(materialWithColor.color.getHex()).toBe(expected.color)
  if (typeof expected.blending === 'number') {
    expect(material.blending).toBe(expected.blending)
  }
}

const expectSpriteWeatherConfig = (
  object: THREE.Object3D,
  expected: {
    color: number
    depthTest: boolean
    depthWrite: boolean
    renderOrder: number
    texture: THREE.Texture
    blending?: THREE.Blending
  },
): THREE.Sprite => {
  expect(object).toBeInstanceOf(THREE.Sprite)
  const sprite = object as THREE.Sprite
  expect(sprite.renderOrder).toBe(expected.renderOrder)
  expect(sprite.frustumCulled).toBe(false)
  const material = sprite.material as THREE.SpriteMaterial
  expect(material.map).toBe(expected.texture)
  expectBaseMaterialConfig(material, {
    color: expected.color,
    opacity: material.opacity,
    depthTest: expected.depthTest,
    depthWrite: expected.depthWrite,
    blending: expected.blending,
  })
  return sprite
}

const rainDropCount = (visual: ReturnType<typeof makeWeatherVisual>): number => {
  expect(visual.group.children).toHaveLength(1)
  expect(visual.group.children[0]).toBeInstanceOf(THREE.LineSegments)
  const lines = visual.group.children[0] as THREE.LineSegments<
    THREE.BufferGeometry,
    THREE.LineBasicMaterial
  >
  return positionAttributeCount(lines.geometry) / 2
}

const hailParticleCount = (
  visual: ReturnType<typeof makeWeatherVisual>,
): number => {
  expect(visual.group.children).toHaveLength(1)
  expect(visual.group.children[0]).toBeInstanceOf(THREE.InstancedMesh)
  const mesh = visual.group.children[0] as THREE.InstancedMesh<
    THREE.BufferGeometry,
    THREE.MeshBasicMaterial
  >
  return mesh.count
}

const sandMoteCount = (
  visual: ReturnType<typeof makeWeatherVisual>,
): number => {
  expect(visual.group.children).toHaveLength(5)
  expect(visual.group.children[4]).toBeInstanceOf(THREE.Points)
  const points = visual.group.children[4] as THREE.Points<
    THREE.BufferGeometry,
    THREE.PointsMaterial
  >
  return positionAttributeCount(points.geometry)
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

  it('guards no-quality-loss weather particle counts for single and layered effects', () => {
    const textures = fakeTextureCache()

    const sunny = makeWeatherVisual(
      visualRegressionInput,
      'sunny',
      0,
      1,
      textures,
    )
    const layeredSunny = makeWeatherVisual(
      visualRegressionInput,
      'sunny',
      0,
      2,
      textures,
    )
    const rainy = makeWeatherVisual(
      visualRegressionInput,
      'rainy',
      0,
      1,
      textures,
    )
    const layeredRainy = makeWeatherVisual(
      visualRegressionInput,
      'rainy',
      0,
      2,
      textures,
    )
    const hail = makeWeatherVisual(
      visualRegressionInput,
      'hail',
      0,
      1,
      textures,
    )
    const layeredHail = makeWeatherVisual(
      visualRegressionInput,
      'hail',
      0,
      2,
      textures,
    )
    const sandstorm = makeWeatherVisual(
      visualRegressionInput,
      'sandstorm',
      0,
      1,
      textures,
    )
    const layeredSandstorm = makeWeatherVisual(
      visualRegressionInput,
      'sandstorm',
      0,
      2,
      textures,
    )

    expect(sunny.group.children).toHaveLength(7)
    expect(layeredSunny.group.children).toHaveLength(7)
    expect(rainDropCount(rainy)).toBe(218)
    expect(rainDropCount(layeredRainy)).toBe(157)
    expect(hailParticleCount(hail)).toBe(99)
    expect(hailParticleCount(layeredHail)).toBe(74)
    expect(
      sandstorm.group.children
        .slice(0, 4)
        .every((child) => child instanceof THREE.Sprite),
    ).toBe(true)
    expect(
      layeredSandstorm.group.children
        .slice(0, 4)
        .every((child) => child instanceof THREE.Sprite),
    ).toBe(true)
    expect(sandMoteCount(sandstorm)).toBe(138)
    expect(sandMoteCount(layeredSandstorm)).toBe(103)

    for (const visual of [
      sunny,
      layeredSunny,
      rainy,
      layeredRainy,
      hail,
      layeredHail,
      sandstorm,
      layeredSandstorm,
    ]) {
      disposeGroup(visual.group)
    }
    textures.disposeTextureCache()
  })

  it('guards no-quality-loss weather material and render-order baselines', () => {
    const textures = fakeTextureCache()

    const sunny = makeWeatherVisual(visualRegressionInput, 'sunny', 0, 1, textures)
    const firstRay = expectSpriteWeatherConfig(sunny.group.children[0], {
      color: 0xffe9a6,
      depthTest: false,
      depthWrite: false,
      renderOrder: 24,
      texture: textures.getSunRayTexture(),
      blending: THREE.AdditiveBlending,
    })
    expect(firstRay.center.x).toBeCloseTo(0.5)
    expect(firstRay.center.y).toBeCloseTo(0.52)
    expect(firstRay.material.opacity).toBeGreaterThanOrEqual(0.22)
    expect(firstRay.material.opacity).toBeLessThanOrEqual(0.38)

    const rainy = makeWeatherVisual(visualRegressionInput, 'rainy', 0, 1, textures)
    const lines = rainy.group.children[0] as THREE.LineSegments<
      THREE.BufferGeometry,
      THREE.LineBasicMaterial
    >
    expect(lines.renderOrder).toBe(26)
    expect(lines.frustumCulled).toBe(false)
    expectBaseMaterialConfig(lines.material, {
      color: 0xb8e6ff,
      opacity: 0.66,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    const hail = makeWeatherVisual(visualRegressionInput, 'hail', 0, 1, textures)
    const hailMesh = hail.group.children[0] as THREE.InstancedMesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >
    expect(hailMesh.renderOrder).toBe(27)
    expect(hailMesh.frustumCulled).toBe(false)
    expect(hailMesh.geometry.type).toBe('OctahedronGeometry')
    expectBaseMaterialConfig(hailMesh.material, {
      color: 0xeafaff,
      opacity: 0.88,
      depthTest: false,
      depthWrite: false,
    })

    const sandstorm = makeWeatherVisual(
      visualRegressionInput,
      'sandstorm',
      0,
      1,
      textures,
    )
    const firstRibbon = expectSpriteWeatherConfig(sandstorm.group.children[0], {
      color: 0xffddb1,
      depthTest: false,
      depthWrite: false,
      renderOrder: 25,
      texture: textures.getSandstreamTexture(),
    })
    expect(firstRibbon.material.opacity).toBeGreaterThanOrEqual(0.2)
    expect(firstRibbon.material.opacity).toBeLessThanOrEqual(0.34)

    const sandMotes = sandstorm.group.children[4] as THREE.Points<
      THREE.BufferGeometry,
      THREE.PointsMaterial
    >
    expect(sandMotes.renderOrder).toBe(28)
    expect(sandMotes.frustumCulled).toBe(false)
    expect(sandMotes.material.size).toBeCloseTo(0.075)
    expect(sandMotes.material.sizeAttenuation).toBe(true)
    expectBaseMaterialConfig(sandMotes.material, {
      color: 0xf2c46d,
      opacity: 0.48,
      depthTest: false,
      depthWrite: false,
    })

    for (const visual of [sunny, rainy, hail, sandstorm]) {
      disposeGroup(visual.group)
    }
    textures.disposeTextureCache()
  })

  it('guards layered weather visual opacity scales', () => {
    const textures = fakeTextureCache()

    const singleSunny = makeWeatherVisual(
      visualRegressionInput,
      'sunny',
      0,
      1,
      textures,
    )
    const layeredSunny = makeWeatherVisual(
      visualRegressionInput,
      'sunny',
      0,
      2,
      textures,
    )
    const singleRay = singleSunny.group.children[0] as THREE.Sprite
    const layeredRay = layeredSunny.group.children[0] as THREE.Sprite
    expect(layeredRay.material.opacity).toBeCloseTo(
      singleRay.material.opacity * 0.65,
    )

    const singleRain = makeWeatherVisual(
      visualRegressionInput,
      'rainy',
      0,
      1,
      textures,
    )
    const layeredRain = makeWeatherVisual(
      visualRegressionInput,
      'rainy',
      0,
      2,
      textures,
    )
    const singleRainLines = singleRain.group.children[0] as THREE.LineSegments<
      THREE.BufferGeometry,
      THREE.LineBasicMaterial
    >
    const layeredRainLines = layeredRain.group.children[0] as THREE.LineSegments<
      THREE.BufferGeometry,
      THREE.LineBasicMaterial
    >
    expect(singleRainLines.material.opacity).toBeCloseTo(0.66)
    expect(layeredRainLines.material.opacity).toBeCloseTo(0.48)

    const singleHail = makeWeatherVisual(
      visualRegressionInput,
      'hail',
      0,
      1,
      textures,
    )
    const layeredHail = makeWeatherVisual(
      visualRegressionInput,
      'hail',
      0,
      2,
      textures,
    )
    const singleHailMesh = singleHail.group.children[0] as THREE.InstancedMesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >
    const layeredHailMesh = layeredHail.group.children[0] as THREE.InstancedMesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >
    expect(singleHailMesh.material.opacity).toBeCloseTo(0.88)
    expect(layeredHailMesh.material.opacity).toBeCloseTo(0.72)

    const singleSand = makeWeatherVisual(
      visualRegressionInput,
      'sandstorm',
      0,
      1,
      textures,
    )
    const layeredSand = makeWeatherVisual(
      visualRegressionInput,
      'sandstorm',
      0,
      2,
      textures,
    )
    const singleRibbon = singleSand.group.children[0] as THREE.Sprite
    const layeredRibbon = layeredSand.group.children[0] as THREE.Sprite
    expect(layeredRibbon.material.opacity).toBeCloseTo(
      singleRibbon.material.opacity * 0.65,
    )
    const singleSandMotes = singleSand.group.children[4] as THREE.Points<
      THREE.BufferGeometry,
      THREE.PointsMaterial
    >
    const layeredSandMotes = layeredSand.group.children[4] as THREE.Points<
      THREE.BufferGeometry,
      THREE.PointsMaterial
    >
    expect(singleSandMotes.material.opacity).toBeCloseTo(0.48)
    expect(layeredSandMotes.material.opacity).toBeCloseTo(0.34)

    for (const visual of [
      singleSunny,
      layeredSunny,
      singleRain,
      layeredRain,
      singleHail,
      layeredHail,
      singleSand,
      layeredSand,
    ]) {
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
