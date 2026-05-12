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

  const particles = Array.from({ length: count }, () => ({
    x: randomRange(rand, bounds.minX, bounds.maxX),
    y: randomRange(rand, bounds.groundY, bounds.topY),
    z: randomRange(rand, bounds.minZ, bounds.maxZ),
    speed: randomRange(rand, 2.4, 4.6),
    driftX: randomRange(rand, -0.18, 0.34),
    driftZ: randomRange(rand, -0.08, 0.24),
    scale: randomRange(rand, 0.045, 0.09),
    phase: randomRange(rand, 0, Math.PI * 2),
    spin: randomRange(rand, 1.8, 4.2),
  }))

  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const rotation = new THREE.Euler()
  const scale = new THREE.Vector3()

  const syncInstances = (elapsed: number) => {
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i]
      const pulse = 1 + Math.sin(elapsed * 5.2 + p.phase) * 0.08
      position.set(p.x, p.y, p.z)
      rotation.set(
        p.phase + elapsed * p.spin,
        p.phase * 0.7 + elapsed * p.spin * 0.8,
        p.phase * 1.3,
      )
      quaternion.setFromEuler(rotation)
      scale.set(p.scale * pulse, p.scale * 1.35 * pulse, p.scale * pulse)
      matrix.compose(position, quaternion, scale)
      mesh.setMatrixAt(i, matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }
  syncInstances(0)

  return {
    group,
    update: (delta, elapsed) => {
      for (const p of particles) {
        p.y -= p.speed * delta
        p.x += p.driftX * delta
        p.z += p.driftZ * delta
        p.x = wrapRange(p.x, bounds.minX, bounds.maxX)
        p.z = wrapRange(p.z, bounds.minZ, bounds.maxZ)
        if (p.y < bounds.groundY + 0.02) {
          p.y = bounds.topY + randomRange(rand, 0, 0.8)
          p.x = randomRange(rand, bounds.minX, bounds.maxX)
          p.z = randomRange(rand, bounds.minZ, bounds.maxZ)
        }
      }
      syncInstances(elapsed)
    },
  }
}
