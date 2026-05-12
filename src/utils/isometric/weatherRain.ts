import * as THREE from 'three'
import {
  getWeatherBounds,
  randomRange,
  seededWeatherRandom,
  wrapRange,
  type WeatherEffectRendererInput,
} from './weatherMath'
import { rainDropCountForDimensions } from './weatherVisualConfig'
import type { WeatherVisual } from './weatherVisualTypes'

export const makeRainyWeatherVisual = (
  input: WeatherEffectRendererInput,
  seed: string,
  index: number,
  total: number,
): WeatherVisual => {
  const rand = seededWeatherRandom(seed)
  const bounds = getWeatherBounds(input)
  const group = new THREE.Group()
  group.name = 'weather-rain'

  const count = rainDropCountForDimensions(input.dimensions, total)
  const positions = new Float32Array(count * 2 * 3)
  const drops = Array.from({ length: count }, () => ({
    x: randomRange(rand, bounds.minX, bounds.maxX),
    y: randomRange(rand, bounds.groundY, bounds.topY),
    z: randomRange(rand, bounds.minZ, bounds.maxZ),
    speed: randomRange(rand, 3.8, 6.8),
    length: randomRange(rand, 0.45, 0.95),
    slantX: randomRange(rand, 0.18, 0.34),
    slantZ: randomRange(rand, 0.05, 0.18),
  }))

  const geometry = new THREE.BufferGeometry()
  const positionAttribute = new THREE.BufferAttribute(positions, 3)
  geometry.setAttribute('position', positionAttribute)

  const material = new THREE.LineBasicMaterial({
    color: 0xb8e6ff,
    transparent: true,
    opacity: total > 1 ? 0.48 : 0.66,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const lines = new THREE.LineSegments(geometry, material)
  lines.renderOrder = 26 + index
  lines.frustumCulled = false
  group.add(lines)

  const syncPositions = () => {
    for (let i = 0; i < drops.length; i += 1) {
      const drop = drops[i]
      const offset = i * 6
      positions[offset] = drop.x
      positions[offset + 1] = drop.y
      positions[offset + 2] = drop.z
      positions[offset + 3] = drop.x + drop.slantX
      positions[offset + 4] = drop.y - drop.length
      positions[offset + 5] = drop.z + drop.slantZ
    }
    positionAttribute.needsUpdate = true
  }
  syncPositions()

  return {
    group,
    update: (delta) => {
      for (const drop of drops) {
        drop.y -= drop.speed * delta
        drop.x += 0.72 * delta
        drop.z += 0.28 * delta
        drop.x = wrapRange(drop.x, bounds.minX, bounds.maxX)
        drop.z = wrapRange(drop.z, bounds.minZ, bounds.maxZ)
        if (drop.y < bounds.groundY - 0.25) {
          drop.y = bounds.topY + randomRange(rand, 0, 1.2)
          drop.x = randomRange(rand, bounds.minX, bounds.maxX)
          drop.z = randomRange(rand, bounds.minZ, bounds.maxZ)
        }
      }
      syncPositions()
    },
  }
}
