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
  const dropX = new Float64Array(count)
  const dropY = new Float64Array(count)
  const dropZ = new Float64Array(count)
  const dropSpeed = new Float64Array(count)
  const dropLength = new Float64Array(count)
  const dropSlantX = new Float64Array(count)
  const dropSlantZ = new Float64Array(count)

  for (let i = 0; i < count; i += 1) {
    dropX[i] = randomRange(rand, bounds.minX, bounds.maxX)
    dropY[i] = randomRange(rand, bounds.groundY, bounds.topY)
    dropZ[i] = randomRange(rand, bounds.minZ, bounds.maxZ)
    dropSpeed[i] = randomRange(rand, 3.8, 6.8)
    dropLength[i] = randomRange(rand, 0.45, 0.95)
    dropSlantX[i] = randomRange(rand, 0.18, 0.34)
    dropSlantZ[i] = randomRange(rand, 0.05, 0.18)
  }

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
    for (let i = 0; i < count; i += 1) {
      const offset = i * 6
      const x = dropX[i]
      const y = dropY[i]
      const z = dropZ[i]
      positions[offset] = x
      positions[offset + 1] = y
      positions[offset + 2] = z
      positions[offset + 3] = x + dropSlantX[i]
      positions[offset + 4] = y - dropLength[i]
      positions[offset + 5] = z + dropSlantZ[i]
    }
    positionAttribute.needsUpdate = true
  }
  syncPositions()

  return {
    group,
    update: (delta) => {
      for (let i = 0; i < count; i += 1) {
        let x = dropX[i] + 0.72 * delta
        let y = dropY[i] - dropSpeed[i] * delta
        let z = dropZ[i] + 0.28 * delta
        x = wrapRange(x, bounds.minX, bounds.maxX)
        z = wrapRange(z, bounds.minZ, bounds.maxZ)
        if (y < bounds.groundY - 0.25) {
          y = bounds.topY + randomRange(rand, 0, 1.2)
          x = randomRange(rand, bounds.minX, bounds.maxX)
          z = randomRange(rand, bounds.minZ, bounds.maxZ)
        }
        dropX[i] = x
        dropY[i] = y
        dropZ[i] = z
      }
      syncPositions()
    },
  }
}
