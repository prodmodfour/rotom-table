import * as THREE from 'three'
import {
  getWeatherBounds,
  randomRange,
  seededWeatherRandom,
  type WeatherEffectRendererInput,
} from './weatherMath'
import {
  layeredSunRayOpacityScale,
  sunRayCountForDimensions,
} from './weatherVisualConfig'
import type { WeatherTextureCache } from './weatherTextures'
import type { WeatherVisual } from './weatherVisualTypes'

export const makeSunnyWeatherVisual = (
  input: WeatherEffectRendererInput,
  seed: string,
  index: number,
  total: number,
  weatherTextures: WeatherTextureCache,
): WeatherVisual => {
  const rand = seededWeatherRandom(seed)
  const bounds = getWeatherBounds(input)
  const group = new THREE.Group()
  group.name = 'weather-sun-rays'

  const texture = weatherTextures.getSunRayTexture()
  const rayCount = sunRayCountForDimensions(input.dimensions)
  const opacityScale = layeredSunRayOpacityScale(total)
  const rays: Array<{
    sprite: THREE.Sprite
    baseX: number
    baseY: number
    baseZ: number
    baseOpacity: number
    phase: number
    drift: number
  }> = []

  for (let i = 0; i < rayCount; i += 1) {
    const material = new THREE.SpriteMaterial({
      map: texture,
      color: 0xffe9a6,
      transparent: true,
      opacity: randomRange(rand, 0.22, 0.38) * opacityScale,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    material.rotation = THREE.MathUtils.degToRad(-23)

    const sprite = new THREE.Sprite(material)
    sprite.renderOrder = 24 + index
    sprite.frustumCulled = false
    sprite.center.set(0.5, 0.52)

    const lane = (i + 0.5) / rayCount
    const baseX =
      bounds.minX + lane * bounds.width + randomRange(rand, -0.42, 0.42)
    const baseY =
      bounds.groundY + bounds.height * randomRange(rand, 0.48, 0.72)
    const baseZ =
      bounds.centerZ +
      randomRange(rand, -bounds.depth * 0.22, bounds.depth * 0.22)
    const rayWidth =
      randomRange(rand, 0.55, 1.25) * Math.max(1, input.dimensions.x / 9)
    const rayHeight = bounds.height * randomRange(rand, 0.92, 1.42)

    sprite.position.set(baseX, baseY, baseZ)
    sprite.scale.set(rayWidth, rayHeight, 1)
    group.add(sprite)
    rays.push({
      sprite,
      baseX,
      baseY,
      baseZ,
      baseOpacity: material.opacity,
      phase: randomRange(rand, 0, Math.PI * 2),
      drift: randomRange(rand, 0.08, 0.24),
    })
  }

  return {
    group,
    update: (_delta, elapsed) => {
      for (let i = 0; i < rays.length; i += 1) {
        const ray = rays[i]
        ray.sprite.position.set(
          ray.baseX + Math.sin(elapsed * 0.18 + ray.phase) * ray.drift,
          ray.baseY + Math.sin(elapsed * 0.14 + ray.phase * 0.7) * 0.06,
          ray.baseZ,
        )
        ray.sprite.material.opacity =
          ray.baseOpacity *
          (0.82 + Math.sin(elapsed * 0.62 + ray.phase) * 0.18)
      }
    },
  }
}
