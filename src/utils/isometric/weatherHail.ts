import * as THREE from 'three'
import {
  getWeatherBounds,
  randomRange,
  seededWeatherRandom,
  wrapRange,
  type WeatherEffectRendererInput,
} from './weatherMath'
import { hailParticleCountForDimensions } from './weatherVisualConfig'
import type { WeatherVisual } from './weatherVisualTypes'

export const makeHailWeatherVisual = (
  input: WeatherEffectRendererInput,
  seed: string,
  index: number,
  total: number,
): WeatherVisual => {
  const rand = seededWeatherRandom(seed)
  const bounds = getWeatherBounds(input)
  const group = new THREE.Group()
  group.name = 'weather-hail'

  const count = hailParticleCountForDimensions(input.dimensions, total)
  const geometry = new THREE.OctahedronGeometry(1, 0)
  const material = new THREE.MeshBasicMaterial({
    // Keep this a fixed icy color; enabling vertexColors on an
    // InstancedMesh without per-vertex color data renders black on
    // some three.js/WebGL paths.
    color: 0xeafaff,
    transparent: true,
    opacity: total > 1 ? 0.72 : 0.88,
    depthTest: false,
    depthWrite: false,
  })
  const mesh = new THREE.InstancedMesh(geometry, material, count)
  mesh.renderOrder = 27 + index
  mesh.frustumCulled = false
  group.add(mesh)

  const particleX = new Float64Array(count)
  const particleY = new Float64Array(count)
  const particleZ = new Float64Array(count)
  const particleSpeed = new Float64Array(count)
  const particleDriftX = new Float64Array(count)
  const particleDriftZ = new Float64Array(count)
  const particleScale = new Float64Array(count)
  const particlePhase = new Float64Array(count)
  const particleSpin = new Float64Array(count)

  for (let i = 0; i < count; i += 1) {
    particleX[i] = randomRange(rand, bounds.minX, bounds.maxX)
    particleY[i] = randomRange(rand, bounds.groundY, bounds.topY)
    particleZ[i] = randomRange(rand, bounds.minZ, bounds.maxZ)
    particleSpeed[i] = randomRange(rand, 2.4, 4.6)
    particleDriftX[i] = randomRange(rand, -0.18, 0.34)
    particleDriftZ[i] = randomRange(rand, -0.08, 0.24)
    particleScale[i] = randomRange(rand, 0.045, 0.09)
    particlePhase[i] = randomRange(rand, 0, Math.PI * 2)
    particleSpin[i] = randomRange(rand, 1.8, 4.2)
  }

  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const rotation = new THREE.Euler()
  const scale = new THREE.Vector3()

  const syncInstances = (elapsed: number) => {
    for (let i = 0; i < count; i += 1) {
      const phase = particlePhase[i]!
      const spin = particleSpin[i]!
      const baseScale = particleScale[i]!
      const pulse = 1 + Math.sin(elapsed * 5.2 + phase) * 0.08
      position.set(particleX[i]!, particleY[i]!, particleZ[i]!)
      rotation.set(
        phase + elapsed * spin,
        phase * 0.7 + elapsed * spin * 0.8,
        phase * 1.3,
      )
      quaternion.setFromEuler(rotation)
      scale.set(baseScale * pulse, baseScale * 1.35 * pulse, baseScale * pulse)
      matrix.compose(position, quaternion, scale)
      mesh.setMatrixAt(i, matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }
  syncInstances(0)

  return {
    group,
    update: (delta, elapsed) => {
      for (let i = 0; i < count; i += 1) {
        let x = particleX[i]! + particleDriftX[i]! * delta
        let y = particleY[i]! - particleSpeed[i]! * delta
        let z = particleZ[i]! + particleDriftZ[i]! * delta
        x = wrapRange(x, bounds.minX, bounds.maxX)
        z = wrapRange(z, bounds.minZ, bounds.maxZ)
        if (y < bounds.groundY + 0.02) {
          y = bounds.topY + randomRange(rand, 0, 0.8)
          x = randomRange(rand, bounds.minX, bounds.maxX)
          z = randomRange(rand, bounds.minZ, bounds.maxZ)
        }
        particleX[i] = x
        particleY[i] = y
        particleZ[i] = z
      }
      syncInstances(elapsed)
    },
  }
}
