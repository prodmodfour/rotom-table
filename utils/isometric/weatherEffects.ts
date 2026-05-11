import * as THREE from 'three'
import type { MapWeatherKind } from '~/types/map'
import {
  getWeatherBounds,
  randomRange,
  seededWeatherRandom,
  wrapRange,
  type WeatherEffectRendererInput,
} from './weatherMath'
import {
  SAND_RIBBON_COUNT,
  hailParticleCountForDimensions,
  layeredSandRibbonOpacityScale,
  layeredSunRayOpacityScale,
  rainDropCountForDimensions,
  sandMoteCountForDimensions,
  sunRayCountForDimensions,
} from './weatherVisualConfig'
import { createWeatherTextureCache } from './weatherTextures'

export {
  getWeatherBounds,
  randomRange,
  seededWeatherRandom,
  wrapRange,
} from './weatherMath'
export type { WeatherBounds, WeatherEffectRendererInput } from './weatherMath'

export interface WeatherVisual {
  group: THREE.Group
  update: (delta: number, elapsed: number) => void
}

export interface WeatherVisualFactory {
  makeWeatherVisual(
    input: WeatherEffectRendererInput,
    kind: MapWeatherKind,
    index: number,
    total: number,
  ): WeatherVisual
  disposeTextureCache(): void
}

export const createWeatherVisualFactory = (): WeatherVisualFactory => {
  const weatherTextures = createWeatherTextureCache()

  const makeSunnyWeatherVisual = (
    input: WeatherEffectRendererInput,
    seed: string,
    index: number,
    total: number,
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
        for (const ray of rays) {
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

  const makeRainyWeatherVisual = (
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

  const makeHailWeatherVisual = (
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

  const makeSandstormWeatherVisual = (
    input: WeatherEffectRendererInput,
    seed: string,
    index: number,
    total: number,
  ): WeatherVisual => {
    const rand = seededWeatherRandom(seed)
    const bounds = getWeatherBounds(input)
    const group = new THREE.Group()
    group.name = 'weather-sandstream'

    const streamTexture = weatherTextures.getSandstreamTexture()
    const planeWidth =
      Math.hypot(bounds.width, bounds.depth) + bounds.height + 4
    const planeHeight = Math.max(2.2, bounds.height * 0.72)
    const opacityScale = layeredSandRibbonOpacityScale(total)
    const ribbons: Array<{
      sprite: THREE.Sprite
      baseY: number
      baseOpacity: number
      phase: number
    }> = []

    for (let i = 0; i < SAND_RIBBON_COUNT; i += 1) {
      const material = new THREE.SpriteMaterial({
        map: streamTexture,
        color: 0xffddb1,
        transparent: true,
        opacity: randomRange(rand, 0.2, 0.34) * opacityScale,
        depthTest: false,
        depthWrite: false,
      })
      material.rotation = THREE.MathUtils.degToRad(randomRange(rand, -10, -5))
      const sprite = new THREE.Sprite(material)
      const baseY =
        bounds.groundY + planeHeight * randomRange(rand, 0.34, 0.58) + i * 0.18
      sprite.position.set(
        bounds.centerX + randomRange(rand, -0.4, 0.4),
        baseY,
        bounds.minZ +
          ((i + 0.5) / SAND_RIBBON_COUNT) * bounds.depth +
          randomRange(rand, -0.4, 0.4),
      )
      sprite.scale.set(planeWidth, planeHeight, 1)
      sprite.renderOrder = 25 + index
      sprite.frustumCulled = false
      group.add(sprite)
      ribbons.push({
        sprite,
        baseY,
        baseOpacity: material.opacity,
        phase: randomRange(rand, 0, Math.PI * 2),
      })
    }

    const moteCount = sandMoteCountForDimensions(input.dimensions, total)
    const motePositions = new Float32Array(moteCount * 3)
    const motes = Array.from({ length: moteCount }, () => ({
      x: randomRange(rand, bounds.minX, bounds.maxX),
      y: randomRange(
        rand,
        bounds.groundY + 0.12,
        bounds.groundY + bounds.height * 0.78,
      ),
      z: randomRange(rand, bounds.minZ, bounds.maxZ),
      speedX: randomRange(rand, 0.85, 1.85),
      speedZ: randomRange(rand, 0.18, 0.65),
      bob: randomRange(rand, 0.015, 0.055),
      phase: randomRange(rand, 0, Math.PI * 2),
    }))
    const moteGeometry = new THREE.BufferGeometry()
    const moteAttribute = new THREE.BufferAttribute(motePositions, 3)
    moteGeometry.setAttribute('position', moteAttribute)
    const moteMaterial = new THREE.PointsMaterial({
      color: 0xf2c46d,
      transparent: true,
      opacity: total > 1 ? 0.34 : 0.48,
      size: 0.075,
      sizeAttenuation: true,
      depthTest: false,
      depthWrite: false,
    })
    const motePoints = new THREE.Points(moteGeometry, moteMaterial)
    motePoints.renderOrder = 28 + index
    motePoints.frustumCulled = false
    group.add(motePoints)

    const syncMotes = (elapsed: number) => {
      for (let i = 0; i < motes.length; i += 1) {
        const mote = motes[i]
        const offset = i * 3
        motePositions[offset] = mote.x
        motePositions[offset + 1] =
          mote.y + Math.sin(elapsed * 3.4 + mote.phase) * mote.bob
        motePositions[offset + 2] = mote.z
      }
      moteAttribute.needsUpdate = true
    }
    syncMotes(0)

    return {
      group,
      update: (delta, elapsed) => {
        streamTexture.offset.x = (streamTexture.offset.x + delta * 0.18) % 1
        streamTexture.offset.y = (streamTexture.offset.y + delta * 0.012) % 1
        for (const ribbon of ribbons) {
          ribbon.sprite.position.y =
            ribbon.baseY + Math.sin(elapsed * 0.42 + ribbon.phase) * 0.1
          ribbon.sprite.material.opacity =
            ribbon.baseOpacity *
            (0.92 + Math.sin(elapsed * 0.55 + ribbon.phase) * 0.08)
        }
        for (const mote of motes) {
          mote.x = wrapRange(
            mote.x + mote.speedX * delta,
            bounds.minX,
            bounds.maxX,
          )
          mote.z = wrapRange(
            mote.z + mote.speedZ * delta,
            bounds.minZ,
            bounds.maxZ,
          )
        }
        syncMotes(elapsed)
      },
    }
  }

  const makeWeatherVisual = (
    input: WeatherEffectRendererInput,
    kind: MapWeatherKind,
    index: number,
    total: number,
  ): WeatherVisual => {
    const seed = `${kind}:${input.dimensions.x}x${input.dimensions.y}x${input.dimensions.z}:${index}`
    switch (kind) {
      case 'sunny':
        return makeSunnyWeatherVisual(input, seed, index, total)
      case 'rainy':
        return makeRainyWeatherVisual(input, seed, index, total)
      case 'hail':
        return makeHailWeatherVisual(input, seed, index, total)
      case 'sandstorm':
        return makeSandstormWeatherVisual(input, seed, index, total)
    }
  }

  return {
    makeWeatherVisual,
    disposeTextureCache: weatherTextures.disposeTextureCache,
  }
}
